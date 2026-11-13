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
 * - A sharded database splits that work by the shard key's spread (`shardShares`); its busiest shard is the reading.
 *   During a hot key event the reading is taken again with the hot value on its shard.
 * - A cache that invalidates on write keeps values only until their key is next written.
 * - Payments go to the provider directly or through a queue. A queue's reading is the part of the deadline its oldest
 *   order uses, or of its room the backlog fills, whichever is more: the backlog is worked out over the whole run's
 *   traffic, drained at what the workers (and the provider's limit) allow.
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
  QUEUE_SIZES,
  REPLICATION,
} from './catalog.ts';
import { cacheCapacityKeys, cacheHitRate, shardShares, ZipfKeys } from './data-model.ts';
import { interpolate } from './math.ts';
import { workerThroughput } from './payments.ts';
import type {
  CacheSpec,
  ComponentKind,
  DatabaseSpec,
  Design,
  Level,
  NodeSpec,
  QueueSpec,
  ReadReplicasSpec,
  ShardsSpec,
} from './schema.ts';

/**
 * What a node's load is counted in: requests, cache lookups, database read-equivalents, payment calls, or (for a
 * queue) seconds of the deadline.
 */
export type LoadUnit = 'requests' | 'lookups' | 'reads' | 'calls' | 'seconds';

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
  /** Sharded databases: each shard's share of the work, and which shard is busiest. */
  shardShares?: number[];
  hottestShard?: number;
  /** Queues: the backlog over the run, drained at `drainRps`. */
  queue?: {
    /** Orders per second arriving at the peak. */
    peakArrivalRps: number;
    /** What the workers can charge per second, capped by the provider's limit. */
    drainRps: number;
    peakBacklog: number;
    maxDepth: number;
    /** The longest wait of an order, and the deadline (Infinity when there is none). */
    maxWaitSec: number;
    deadlineSec: number;
  };
  /** Payment providers: the rate limit. */
  rateLimitRps?: number;
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
  /** The same, while the level's hot key event has one value taking its share. Null in levels without one. */
  duringHotKey: Record<string, NodeLoad> | null;
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
  const hotKey = level.events.find((event) => event.kind === 'hotKey') ?? null;
  const nodes = loadsAt(level, design, peak, null, null);
  return {
    peakRps: peak,
    nodes,
    afterCrash: crashes ? loadsAt(level, design, peak, busiestInstance(design, nodes), null) : null,
    duringHotKey: hotKey ? loadsAt(level, design, peak, null, hotKey) : null,
  };
}

type HotKey = Extract<Level['events'][number], { kind: 'hotKey' }>;

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

function loadsAt(
  level: Level,
  design: Design,
  peak: number,
  down: Instance | null,
  hotKey: HotKey | null,
): Record<string, NodeLoad> {
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

  // 2. Payments.
  const payments = level.workload.payments;
  if (payments) paymentLoads(level, payments, served, peak, childOf, result);

  // 3. The data tier.
  const data = level.workload.data;
  if (!data) return result;
  const keys = lazy(() => new ZipfKeys(data.keys.count, data.keys.zipf));
  const caches = new Map<string, { spec: CacheSpec; lookups: number; misses: Map<string, number> }>();
  const primaries = new Map<string, { spec: DatabaseSpec | ShardsSpec; reads: number; writes: number }>();
  const replicaGroups = new Map<string, { spec: ReadReplicasSpec; reads: number }>();
  const primary = (spec: DatabaseSpec | ShardsSpec) =>
    primaries.get(spec.id) ?? primaries.set(spec.id, { spec, reads: 0, writes: 0 }).get(spec.id)!;
  const group = (spec: ReadReplicasSpec) => replicaGroups.get(spec.id) ?? replicaGroups.set(spec.id, { spec, reads: 0 }).get(spec.id)!;

  const runRequests = totalRequests(level);
  const rawShare = data.readAfterWrite?.share ?? 0;
  const missTargets: {
    cacheId: string | null;
    lookups: number;
    to: { kind: 'db'; spec: DatabaseSpec | ShardsSpec } | { kind: 'replicas'; spec: ReadReplicasSpec };
  }[] = [];
  const cacheWrites = new Map<string, number>();
  for (const [appId, requests] of served) {
    const database = childOf(appId, 'database') ?? childOf(appId, 'shards');
    if (!database) continue;
    const cache = childOf(appId, 'cache');
    const replicas = database.kind === 'database' ? childOf(appId, 'readReplicas') : undefined;
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
      if (cache.invalidateOnWrite) cacheWrites.set(cache.id, (cacheWrites.get(cache.id) ?? 0) + requests - reads);
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
            invalidationWriteRps: cacheWrites.get(id) ?? 0,
          })
        : 0;
    hitRates.set(id, hitRate);
    const ops = cache.lookups + (cacheWrites.get(id) ?? 0);
    result[id] = { ...machineLoad('cache', ops, CACHE.opsPerSec, 1, 'lookups'), readRps: cache.lookups, hitRate };
  }

  for (const target of missTargets) {
    const misses = target.lookups * (target.cacheId === null ? 1 : 1 - hitRates.get(target.cacheId)!);
    if (target.to.kind === 'replicas') group(target.to.spec).reads += misses;
    else primary(target.to.spec).reads += misses;
  }

  for (const [id, db] of primaries) {
    const size = DATABASE_SIZES[db.spec.size];
    const writeCost = size.readsPerSec / size.writesPerSec;
    const work = db.reads + db.writes * writeCost;
    if (db.spec.kind === 'database') {
      result[id] = { ...machineLoad('database', work, size.readsPerSec, 1, 'reads'), readRps: db.reads, writeRps: db.writes, writeCost };
      continue;
    }
    const spec = db.spec;
    const key = data.shardKeys?.find((k) => k.id === spec.shardKey);
    const shares = key
      ? shardShares(key, spec.count, hotKey?.shardKey === key.id ? hotKey.share : 0)
      : new Array<number>(spec.count).fill(1 / spec.count);
    const hottestShard = shares.indexOf(Math.max(...shares));
    result[id] = {
      ...machineLoad('shards', work * shares[hottestShard]!, size.readsPerSec, spec.count, 'reads'),
      readRps: db.reads,
      writeRps: db.writes,
      writeCost,
      shardShares: shares,
      hottestShard,
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

/**
 * Loads of the payment provider and the queues in front of it. Each queue's backlog is worked out over the run: the
 * traffic curve, scaled to the share of requests that reach the queue at the peak, against the queue's drain rate.
 */
function paymentLoads(
  level: Level,
  payments: NonNullable<Level['workload']['payments']>,
  served: ReadonlyMap<string, number>,
  peak: number,
  childOf: <K extends ComponentKind>(id: string, kind: K) => Extract<NodeSpec, { kind: K }> | undefined,
  result: Record<string, NodeLoad>,
): void {
  const queues = new Map<string, { spec: QueueSpec; arrivalRps: number; providerId: string | null }>();
  const providers = new Map<string, number>();
  for (const [appId, requests] of served) {
    const queue = childOf(appId, 'queue');
    if (queue) {
      const provider = childOf(queue.id, 'paymentProvider');
      const entry = queues.get(queue.id) ?? queues.set(queue.id, { spec: queue, arrivalRps: 0, providerId: provider?.id ?? null }).get(queue.id)!;
      entry.arrivalRps += requests;
      continue;
    }
    const provider = childOf(appId, 'paymentProvider');
    if (provider) providers.set(provider.id, (providers.get(provider.id) ?? 0) + requests);
  }

  // Direct calls first; queues share what the limit leaves, in proportion to their workers.
  const workerRps = (spec: QueueSpec) => spec.workers * workerThroughput(payments);
  const demand = new Map(providers);
  for (const queue of queues.values()) {
    if (queue.providerId) demand.set(queue.providerId, (demand.get(queue.providerId) ?? 0) + workerRps(queue.spec));
  }
  for (const [id, queue] of queues) {
    const workers = workerRps(queue.spec);
    const providerDemand = queue.providerId ? demand.get(queue.providerId)! : 0;
    const drainRps = queue.providerId
      ? providerDemand > payments.rateLimitRps
        ? workers * (payments.rateLimitRps / providerDemand)
        : workers
      : 0;
    if (queue.providerId) providers.set(queue.providerId, (providers.get(queue.providerId) ?? 0) + Math.min(drainRps, queue.arrivalRps));
    const backlog = projectBacklog(level, peak > 0 ? queue.arrivalRps / peak : 0, drainRps);
    const maxDepth = QUEUE_SIZES[queue.spec.size].maxDepth;
    const deadlineSec = level.requirements.processWithinSec ?? Infinity;
    const waitShare = Number.isFinite(deadlineSec) ? backlog.maxWaitSec / deadlineSec : 0;
    const depthShare = backlog.peakBacklog / maxDepth;
    const byDeadline = waitShare >= depthShare;
    result[id] = {
      kind: 'queue',
      utilization: Math.max(waitShare, depthShare),
      machines: queue.spec.workers,
      load: byDeadline ? backlog.maxWaitSec : backlog.peakBacklog,
      capacity: byDeadline ? deadlineSec : maxDepth,
      unit: 'seconds',
      queue: {
        peakArrivalRps: queue.arrivalRps,
        drainRps,
        peakBacklog: backlog.peakBacklog,
        maxDepth,
        maxWaitSec: backlog.maxWaitSec,
        deadlineSec,
      },
    };
  }
  for (const [id, calls] of providers) {
    result[id] = { ...machineLoad('paymentProvider', calls, payments.rateLimitRps, 1, 'calls'), rateLimitRps: payments.rateLimitRps };
  }
}

/**
 * The backlog of a queue over the run, second by second: orders arrive at `share` of the traffic and drain at
 * `drainRps`. An order waits for the backlog ahead of it, so the longest wait is the biggest backlog ÷ the drain rate
 * (Infinity when nothing drains and orders arrive).
 */
function projectBacklog(level: Level, share: number, drainRps: number): { peakBacklog: number; maxWaitSec: number } {
  let backlog = 0;
  let peakBacklog = 0;
  for (let t = 0; t < level.durationSec; t++) {
    const arriving = interpolate(level.workload.traffic, t + 0.5) * share;
    backlog = Math.max(0, backlog + arriving - drainRps);
    peakBacklog = Math.max(peakBacklog, backlog);
  }
  const maxWaitSec = peakBacklog > 0 ? (drainRps > 0 ? peakBacklog / drainRps : Infinity) : 0;
  return { peakBacklog, maxWaitSec };
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
