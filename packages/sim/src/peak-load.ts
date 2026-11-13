/**
 * Expected load at the level's peak traffic, worked out on paper rather than simulated: what the player could compute
 * with a napkin from the capacity numbers. The inspector shows it as a utilization gauge, so the arithmetic is visible
 * while building.
 *
 * It follows the engine's routing (`simulate.ts`, `data-tier.ts`) but in steady state and without failures:
 *
 * - A load balancer splits its traffic evenly across every instance in rotation (round robin, whatever their size).
 * - An app server instance's capacity is vCPUs ÷ CPU time per request.
 * - Each request an app server finishes makes one data operation: writes and pinned read-after-write reads go to the
 *   primary; other reads check the cache, and misses go to the read replicas if connected, otherwise the primary.
 * - A cache's hit rate is the best it reaches in the run: every lookup of the run already made (so it has learned what
 *   it can about the keys), and values expiring at the peak lookup rate.
 * - The database is costed in read-equivalents; replicas also replay every write at `REPLICATION.replayCost`.
 *
 * It deliberately says nothing about latency: utilization is the number to reason with, and p99 is the result.
 */
import {
  APP_SERVER_SIZES,
  CACHE,
  CACHE_SIZES,
  CLIENTS_ID,
  DATABASE_SIZES,
  LOAD_BALANCER,
  REPLICATION,
} from './catalog.ts';
import { cacheCapacityKeys, cacheHitRate, ZipfKeys } from './data-model.ts';
import type { CacheSpec, ComponentKind, DatabaseSpec, Design, Level, NodeSpec, ReadReplicasSpec } from './schema.ts';

/** What a node's load is counted in: requests, cache lookups, or database read-equivalents. */
export type LoadUnit = 'requests' | 'lookups' | 'reads';

export interface NodeLoad {
  kind: ComponentKind;
  /**
   * The busiest machine's load ÷ its capacity. Above 1 is overloaded. `Infinity` when the node gets traffic but
   * has no machine left to serve it (every instance crashed).
   */
  utilization: number;
  /** Machines sharing the node's load: app-server instances in rotation, replicas, or 1. */
  machines: number;
  /** The busiest machine's load per second, in `unit`s. */
  load: number;
  /** One machine's capacity per second, in `unit`s. */
  capacity: number;
  unit: LoadUnit;
  /** Databases: reads arriving per second. Read replicas: reads served by the group. Caches: lookups. */
  readRps?: number;
  /** Databases: writes arriving per second. Read replicas: writes each replays. */
  writeRps?: number;
  /** Databases and read replicas: how many reads one write costs on this machine. */
  writeCost?: number;
  /** Caches: the share of lookups served from memory once warm. */
  hitRate?: number;
}

export interface PeakLoad {
  /** The highest request rate in the level's traffic. */
  peakRps: number;
  /** Every node that traffic reaches. Nodes nothing reaches are absent. */
  nodes: Record<string, NodeLoad>;
  /**
   * The same, after the level's scripted crash takes out the busiest app-server instance and the load balancer stops
   * sending it traffic. Null in levels without a crash.
   */
  afterCrash: Record<string, NodeLoad> | null;
}

/** Utilization below this is comfortable. */
export const COMFORTABLE_UTILIZATION = 0.7;
/** Utilization above this is hot: requests queue and p99 climbs fast. */
export const HOT_UTILIZATION = 0.85;

/** Comfortable below 70%, busy from 70% to 85%, hot above 85%, overloaded above 100%. */
export type UtilizationZone = 'comfortable' | 'busy' | 'hot' | 'overloaded';

export function utilizationZone(utilization: number): UtilizationZone {
  if (utilization > 1) return 'overloaded';
  if (utilization > HOT_UTILIZATION) return 'hot';
  if (utilization >= COMFORTABLE_UTILIZATION) return 'busy';
  return 'comfortable';
}

/** The highest request rate in a level's traffic (traffic is linear between points, so it peaks at a point). */
export function peakRps(level: Level): number {
  return Math.max(0, ...level.workload.traffic.map((point) => point.rps));
}

/**
 * Expected utilization of every node at the level's peak. Works on any design, valid or not: it follows the
 * connections that make sense and ignores the rest, so the editor can show it while the player builds.
 */
export function peakLoad(level: Level, design: Design): PeakLoad {
  const peak = peakRps(level);
  const crashes = level.events.some((event) => event.kind === 'instanceFailure');
  const nodes = loadsAt(level, design, peak, null);
  return { peakRps: peak, nodes, afterCrash: crashes ? loadsAt(level, design, peak, busiestInstance(design, nodes)) : null };
}

// ---------------------------------------------------------------------------

interface Instance {
  nodeId: string;
  index: number;
}

/** The instance the engine's "busiest" crash would pick: the most traffic, first in design order on ties. */
function busiestInstance(design: Design, nodes: Record<string, NodeLoad>): Instance | null {
  let best: { instance: Instance; load: number } | null = null;
  for (const node of design.nodes) {
    const load = nodes[node.id];
    if (node.kind !== 'appServer' || !load || load.machines === 0) continue;
    if (best === null || load.load > best.load) best = { instance: { nodeId: node.id, index: 0 }, load: load.load };
  }
  return best?.instance ?? null;
}

function loadsAt(level: Level, design: Design, peak: number, down: Instance | null): Record<string, NodeLoad> {
  const byId = new Map(design.nodes.map((node) => [node.id, node]));
  const children = new Map<string, NodeSpec[]>();
  const parents = new Map<string, NodeSpec[]>();
  for (const { from, to } of design.edges) {
    const target = byId.get(to);
    const source = byId.get(from);
    if (!target || !source || from === to) continue;
    children.set(from, [...(children.get(from) ?? []), target]);
    parents.set(to, [...(parents.get(to) ?? []), source]);
  }
  const childOf = <K extends ComponentKind>(id: string, kind: K) =>
    (children.get(id) ?? []).find((node): node is Extract<NodeSpec, { kind: K }> => node.kind === kind);
  const isDown = (nodeId: string, index: number) => down !== null && down.nodeId === nodeId && down.index === index;

  const result: Record<string, NodeLoad> = {};
  const entryId = design.edges.find((edge) => edge.from === CLIENTS_ID && byId.has(edge.to))?.to;
  const entry = entryId === undefined ? undefined : byId.get(entryId)!;

  // 1. The request tier: requests per second arriving at each app server instance.
  const arrivals = new Map<string, number[]>();
  const app = (id: string) => {
    const node = byId.get(id);
    if (node?.kind !== 'appServer') return null;
    if (!arrivals.has(id)) arrivals.set(id, new Array<number>(node.instances).fill(0));
    return { node, perInstance: arrivals.get(id)! };
  };
  if (entry?.kind === 'loadBalancer') {
    const forwarded = Math.min(peak, LOAD_BALANCER.maxRps);
    result[entry.id] = machineLoad('loadBalancer', peak, LOAD_BALANCER.maxRps, 1, 'requests');
    const rotation: Instance[] = [];
    for (const child of children.get(entry.id) ?? []) {
      const target = app(child.id);
      if (!target) continue;
      for (let index = 0; index < target.node.instances; index++) {
        if (!isDown(child.id, index)) rotation.push({ nodeId: child.id, index });
      }
    }
    for (const { nodeId, index } of rotation) arrivals.get(nodeId)![index]! += forwarded / rotation.length;
  } else if (entry?.kind === 'appServer') {
    const target = app(entry.id)!;
    // One address for the clients: a lone server takes it all. (Several instances need a load balancer; the design
    // checks say so, and an even split is the most useful number to show meanwhile.)
    const up = target.perInstance.map((_, index) => !isDown(entry.id, index));
    const upCount = up.filter(Boolean).length;
    target.perInstance.forEach((_, index) => {
      if (up[index]) target.perInstance[index] = peak / upCount;
    });
    if (upCount === 0) target.perInstance[0] = peak;
  }

  const served = new Map<string, number>();
  for (const [id, perInstance] of arrivals) {
    const node = byId.get(id)!;
    if (node.kind !== 'appServer') continue;
    const capacity = (APP_SERVER_SIZES[node.size].vcpu * 1000) / level.workload.cpuMsPerRequest;
    const upLoads = perInstance.filter((_, index) => !isDown(id, index));
    const total = perInstance.reduce((sum, rps) => sum + rps, 0);
    if (upLoads.length === 0) {
      result[id] = { ...machineLoad('appServer', total, capacity, 0, 'requests'), utilization: total > 0 ? Infinity : 0 };
    } else {
      result[id] = machineLoad('appServer', Math.max(...upLoads), capacity, upLoads.length, 'requests');
    }
    served.set(id, upLoads.reduce((sum, rps) => sum + rps, 0));
  }

  // 2. The data tier.
  const data = level.workload.data;
  if (!data) return result;
  const keys = lazy(() => new ZipfKeys(data.keys.count, data.keys.zipf));
  const caches = new Map<string, { spec: CacheSpec; lookups: number; misses: Map<string, number> }>();
  const primaries = new Map<string, { spec: DatabaseSpec; reads: number; writes: number }>();
  const replicaGroups = new Map<string, { spec: ReadReplicasSpec; reads: number }>();
  const primary = (spec: DatabaseSpec) => primaries.get(spec.id) ?? primaries.set(spec.id, { spec, reads: 0, writes: 0 }).get(spec.id)!;
  const group = (spec: ReadReplicasSpec) => replicaGroups.get(spec.id) ?? replicaGroups.set(spec.id, { spec, reads: 0 }).get(spec.id)!;

  const runRequests = totalRequests(level);
  const rawShare = data.readAfterWrite?.share ?? 0;
  const missTargets: { cacheId: string | null; lookups: number; to: { kind: 'db'; spec: DatabaseSpec } | { kind: 'replicas'; spec: ReadReplicasSpec } }[] = [];
  for (const [appId, requests] of served) {
    const database = childOf(appId, 'database');
    if (!database) continue;
    const cache = childOf(appId, 'cache');
    const replicas = childOf(appId, 'readReplicas');
    const reads = requests * data.readShare;
    const raw = reads * rawShare;
    const window = replicas?.readYourWritesSec ?? 0;
    const pinned = data.readAfterWrite && window > 0 ? raw * -Math.expm1(-window / data.readAfterWrite.meanGapSec) : 0;
    const lookups = reads - pinned;
    const db = primary(database);
    db.writes += requests - reads;
    db.reads += pinned;
    if (cache) {
      const entry = caches.get(cache.id) ?? caches.set(cache.id, { spec: cache, lookups: 0, misses: new Map() }).get(cache.id)!;
      entry.lookups += lookups;
    }
    missTargets.push({
      cacheId: cache?.id ?? null,
      lookups,
      to: replicas ? { kind: 'replicas', spec: replicas } : { kind: 'db', spec: database },
    });
  }

  const hitRates = new Map<string, number>();
  for (const [id, cache] of caches) {
    const hitRate =
      cache.lookups > 0
        ? cacheHitRate({
            keys: keys(),
            capacityKeys: cacheCapacityKeys(CACHE_SIZES[cache.spec.size].memoryGb, data.keys.valueKb),
            readsSoFar: cache.lookups * (runRequests / peak),
            readRps: cache.lookups,
            ttlSec: cache.spec.ttlSec,
          })
        : 0;
    hitRates.set(id, hitRate);
    result[id] = { ...machineLoad('cache', cache.lookups, CACHE.opsPerSec, 1, 'lookups'), readRps: cache.lookups, hitRate };
  }

  for (const target of missTargets) {
    const misses = target.lookups * (target.cacheId === null ? 1 : 1 - hitRates.get(target.cacheId)!);
    if (target.to.kind === 'replicas') group(target.to.spec).reads += misses;
    else primary(target.to.spec).reads += misses;
  }

  for (const [id, db] of primaries) {
    const size = DATABASE_SIZES[db.spec.size];
    const writeCost = size.readsPerSec / size.writesPerSec;
    result[id] = {
      ...machineLoad('database', db.reads + db.writes * writeCost, size.readsPerSec, 1, 'reads'),
      readRps: db.reads,
      writeRps: db.writes,
      writeCost,
    };
  }

  for (const [id, replicas] of replicaGroups) {
    const size = DATABASE_SIZES[replicas.spec.size];
    const source = (parents.get(id) ?? []).find((node) => node.kind === 'database');
    const replay = source ? (primaries.get(source.id)?.writes ?? 0) : 0;
    const writeCost = (size.readsPerSec / size.writesPerSec) * REPLICATION.replayCost;
    const count = replicas.spec.count;
    result[id] = {
      ...machineLoad('readReplicas', replicas.reads / count + replay * writeCost, size.readsPerSec, count, 'reads'),
      readRps: replicas.reads,
      writeRps: replay,
      writeCost,
    };
  }
  return result;
}

/** Requests in the whole run: the traffic curve integrated over the level's duration. */
export function totalRequests(level: Level): number {
  const points = level.workload.traffic;
  const end = level.durationSec;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1] ?? { atSec: Math.max(end, a.atSec), rps: a.rps };
    const from = Math.min(a.atSec, end);
    const to = Math.min(b.atSec, end);
    if (to <= from) continue;
    // Linear between the points; clipped at the end of the run.
    const rpsAt = (t: number) => a.rps + ((b.rps - a.rps) * (t - a.atSec)) / Math.max(1e-9, b.atSec - a.atSec);
    total += ((rpsAt(from) + rpsAt(to)) / 2) * (to - from);
  }
  return total;
}

function machineLoad(kind: ComponentKind, load: number, capacity: number, machines: number, unit: LoadUnit): NodeLoad {
  return { kind, utilization: capacity > 0 ? load / capacity : Infinity, machines, load, capacity, unit };
}

function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}
