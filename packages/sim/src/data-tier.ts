/**
 * The data tier: caches, the primary database and read replicas behind the app servers.
 *
 * Every request that an app server finishes then does one data operation, a read or a write of a key (the level's
 * `workload.data`). Each app server routes its operations by what it is connected to:
 *
 * - Writes go to the primary.
 * - Read-after-write reads within the replicas' read-your-writes window go to the primary ("pinned").
 * - Other reads check the cache first, if there is one (look-aside). Hits are served from memory.
 * - Misses, and every read when there is no cache, go to the read replicas if connected, otherwise to the primary.
 *
 * Replicas replay every write the primary accepts and lag behind it by an amount that grows with how busy they are
 * (`stepLag`). A read is stale, and fails, when it misses a write it should have seen: a read-after-write read that
 * misses the reader's own write, or any read that misses a change older than the level's staleness limit. Cached
 * values are as old as the time since they were fetched, plus the lag of wherever they were fetched from.
 */
import {
  CACHE,
  CACHE_SIZES,
  DATABASE_SIZES,
  HOP_LATENCY_MS,
  REPLICATION,
  TICK_SEC,
} from './catalog.ts';
import {
  cacheAges,
  cacheCapacityKeys,
  cacheHitRate,
  keyChangedProbability,
  keyHitProbability,
  readAfterWriteStaleProbability,
  stepLag,
  ZipfKeys,
  type LagState,
} from './data-model.ts';
import type { Graph } from './graph.ts';
import { sampleExponential, type Rng } from './math.ts';
import { IDLE_TICK, newStation, probeWait, stepStation, type StationState, type StationTick } from './queue.ts';
import type { CacheSpec, DatabaseSpec, DataWorkload, Level, ReadReplicasSpec } from './schema.ts';
import type { EdgeFrame, FailureReason, InstanceFrame, NodeFrame, SimEvent } from './simulate.ts';

/** Where the data tier reports what happened, so the simulation keeps a single set of books. */
export interface DataTierSink {
  fail(nodeId: string, reason: FailureReason, requests: number, atSec: number): void;
  log(event: SimEvent): void;
}

interface CacheNode {
  spec: CacheSpec;
  station: StationState;
  tick: StationTick;
  capacityKeys: number;
  /** Lookups that have reached the cache since it started empty. */
  readsSoFar: number;
  lookupRps: number;
  hitRate: number;
  /** Per-key hit chance this tick, by the key's share of reads. */
  hitProbability: (share: number) => number;
  servedLookups: number;
  servedHits: number;
}

interface PrimaryNode {
  spec: DatabaseSpec;
  station: StationState;
  tick: StationTick;
  readRps: number;
  writeRps: number;
  /** Writes the primary accepted this tick: what the replicas must replay. */
  acceptedWriteRps: number;
}

interface ReplicaGroup {
  spec: ReadReplicasSpec;
  /** The database the group copies. Validation guarantees there is one. */
  primary: PrimaryNode | null;
  stations: StationState[];
  ticks: StationTick[];
  lag: LagState;
  readRps: number;
  replayRps: number;
  peakLagSec: number;
  lagAlert: boolean;
}

/** One app server's way to its data, and what its reads met this tick (for probes). */
interface Route {
  appId: string;
  cache: CacheNode | null;
  primary: PrimaryNode;
  replicas: ReplicaGroup | null;
  /** Read-after-write reads are pinned to the primary for this long after the write. */
  pinnedSec: number;
  /** Share of read-after-write reads that are pinned. */
  pinnedShare: number;
  /** Per-tick flows, requests per second. */
  flow: { writes: number; pinned: number; normalLookups: number; rawLookups: number; normalMisses: number; rawMisses: number };
  /** Chances that a served read is stale, by where it was served and whether it is read-after-write. */
  stale: { normalHit: number; rawHit: number; normalReplica: number; rawReplica: number };
}

export interface DataTierSummary {
  /** Per cache: hits ÷ lookups it served, over the run. */
  cacheHitRate: Record<string, number>;
  /** Per replica group: the highest replication lag, seconds. */
  peakReplicationLagSec: Record<string, number>;
}

/** Lag above which replicas are reported as falling behind, and the level they must get back under to recover. */
const LAG_ALERT_SEC = REPLICATION.alertLagSec;
const LAG_RECOVERED_SEC = LAG_ALERT_SEC * 0.8;

export class DataTier {
  private readonly data: DataWorkload;
  private readonly keys: ZipfKeys;
  private readonly timeoutSec: number;
  private readonly maxStalenessSec: number;
  private readonly sink: DataTierSink;

  private readonly caches = new Map<string, CacheNode>();
  private readonly primaries = new Map<string, PrimaryNode>();
  private readonly replicaGroups = new Map<string, ReplicaGroup>();
  private readonly routes = new Map<string, Route>();
  private readonly edgeFlows = new Map<string, EdgeFrame>();

  constructor(level: Level, data: DataWorkload, graph: Graph, sink: DataTierSink) {
    this.data = data;
    this.keys = new ZipfKeys(data.keys.count, data.keys.zipf);
    this.timeoutSec = level.workload.timeoutMs / 1000;
    this.maxStalenessSec = level.requirements.maxStalenessSec ?? Infinity;
    this.sink = sink;

    for (const node of graph.nodes.values()) {
      switch (node.kind) {
        case 'cache':
          this.caches.set(node.id, {
            spec: node,
            station: newStation(),
            tick: IDLE_TICK,
            capacityKeys: cacheCapacityKeys(CACHE_SIZES[node.size].memoryGb, data.keys.valueKb),
            readsSoFar: 0,
            lookupRps: 0,
            hitRate: 0,
            hitProbability: () => 0,
            servedLookups: 0,
            servedHits: 0,
          });
          break;
        case 'database':
          this.primaries.set(node.id, {
            spec: node,
            station: newStation(),
            tick: IDLE_TICK,
            readRps: 0,
            writeRps: 0,
            acceptedWriteRps: 0,
          });
          break;
        case 'readReplicas':
          this.replicaGroups.set(node.id, {
            spec: node,
            stations: Array.from({ length: node.count }, newStation),
            ticks: Array.from({ length: node.count }, () => IDLE_TICK),
            primary: null,
            lag: { backlogSec: 0, lagSec: REPLICATION.baseLagSec },
            readRps: 0,
            replayRps: 0,
            peakLagSec: 0,
            lagAlert: false,
          });
          break;
        default:
          break;
      }
    }

    for (const [id, primary] of this.primaries) {
      for (const childId of graph.children.get(id)!) {
        const group = this.replicaGroups.get(childId);
        if (group) group.primary = primary;
      }
    }

    const raw = data.readAfterWrite;
    for (const node of graph.nodes.values()) {
      if (node.kind !== 'appServer') continue;
      const children = graph.children.get(node.id)!;
      const find = <T>(map: Map<string, T>) => children.map((id) => map.get(id)).find((x) => x !== undefined) ?? null;
      const primary = find(this.primaries);
      // Validation guarantees every app server in a level with data reaches a primary.
      if (primary === null) continue;
      const replicas = find(this.replicaGroups);
      const pinnedSec = replicas?.spec.readYourWritesSec ?? 0;
      this.routes.set(node.id, {
        appId: node.id,
        cache: find(this.caches),
        primary,
        replicas,
        pinnedSec,
        pinnedShare: raw && pinnedSec > 0 ? -Math.expm1(-pinnedSec / raw.meanGapSec) : 0,
        flow: { writes: 0, pinned: 0, normalLookups: 0, rawLookups: 0, normalMisses: 0, rawMisses: 0 },
        stale: { normalHit: 0, rawHit: 0, normalReplica: 0, rawReplica: 0 },
      });
    }
  }

  /** Whether requests finishing on this app server go on to the data tier. */
  serves(appId: string): boolean {
    return this.routes.has(appId);
  }

  /** Pushes this tick's data operations through the tier. `outflows` is the requests each app server finished. */
  step(outflows: ReadonlyMap<string, number>, atSec: number): void {
    this.edgeFlows.clear();
    for (const cache of this.caches.values()) cache.lookupRps = 0;
    for (const primary of this.primaries.values()) {
      primary.readRps = 0;
      primary.writeRps = 0;
    }
    for (const group of this.replicaGroups.values()) group.readRps = 0;

    // 1. Split each app server's requests into writes, pinned reads and cache lookups.
    const rawShare = this.data.readAfterWrite?.share ?? 0;
    for (const route of this.routes.values()) {
      const requests = outflows.get(route.appId) ?? 0;
      const reads = requests * this.data.readShare;
      const raw = reads * rawShare;
      const pinned = raw * route.pinnedShare;
      const flow = route.flow;
      flow.writes = requests - reads;
      flow.pinned = pinned;
      flow.normalLookups = reads - raw;
      flow.rawLookups = raw - pinned;
      route.primary.writeRps += flow.writes;
      route.primary.readRps += pinned;
      if (route.cache) route.cache.lookupRps += flow.normalLookups + flow.rawLookups;
    }

    // 2. Caches: lookups that don't time out either hit, or miss and go on to the database.
    const cacheServed = new Map<CacheNode, number>();
    for (const [id, cache] of this.caches) {
      const { tick, failed } = stepStation(cache.station, cache.lookupRps, CACHE.workers, CACHE.workers / CACHE.opsPerSec, this.timeoutSec);
      cache.tick = tick;
      this.sink.fail(id, 'timeout', failed, atSec);
      const conditions = {
        keys: this.keys,
        capacityKeys: cache.capacityKeys,
        readsSoFar: cache.readsSoFar,
        readRps: cache.lookupRps,
        ttlSec: cache.spec.ttlSec,
      };
      cache.hitRate = cacheHitRate(conditions);
      cache.hitProbability = (p) => keyHitProbability(p, conditions.readsSoFar, conditions.readRps, conditions.ttlSec);
      cache.readsSoFar += cache.lookupRps * TICK_SEC;
      const arriving = cache.lookupRps * TICK_SEC;
      const served = arriving > 0 ? 1 - failed / arriving : 1;
      cacheServed.set(cache, served);
      cache.servedLookups += arriving - failed;
      cache.servedHits += (arriving - failed) * cache.hitRate;
    }

    for (const route of this.routes.values()) {
      const flow = route.flow;
      const missShare = route.cache ? cacheServed.get(route.cache)! * (1 - route.cache.hitRate) : 1;
      flow.normalMisses = flow.normalLookups * missShare;
      flow.rawMisses = flow.rawLookups * missShare;
      const misses = flow.normalMisses + flow.rawMisses;
      if (route.replicas) route.replicas.readRps += misses;
      else route.primary.readRps += misses;

      if (route.cache) this.addEdge(route.appId, route.cache.spec.id, flow.normalLookups + flow.rawLookups, 0);
      this.addEdge(
        route.appId,
        route.primary.spec.id,
        flow.writes + flow.pinned + (route.replicas ? 0 : misses),
        flow.writes,
      );
      if (route.replicas) this.addEdge(route.appId, route.replicas.spec.id, misses, 0);
    }

    // 3. The primary: reads and writes share the machine, a write costing readsPerSec / writesPerSec reads.
    const primaryServed = new Map<PrimaryNode, number>();
    for (const [id, primary] of this.primaries) {
      const size = DATABASE_SIZES[primary.spec.size];
      const work = primary.readRps + primary.writeRps * (size.readsPerSec / size.writesPerSec);
      const { tick, failed } = stepStation(primary.station, work, size.vcpu, size.vcpu / size.readsPerSec, this.timeoutSec);
      primary.tick = tick;
      const failedShare = work > 0 ? failed / (work * TICK_SEC) : 0;
      this.sink.fail(id, 'timeout', (primary.readRps + primary.writeRps) * TICK_SEC * failedShare, atSec);
      primary.acceptedWriteRps = primary.writeRps * (1 - failedShare);
      primaryServed.set(primary, 1 - failedShare);
    }

    // 4. Replicas: each serves its share of the reads and replays every accepted write, which sets its lag.
    const replicaServed = new Map<ReplicaGroup, number>();
    for (const [id, group] of this.replicaGroups) {
      const size = DATABASE_SIZES[group.spec.size];
      const primary = group.primary;
      group.replayRps = primary?.acceptedWriteRps ?? 0;
      if (primary) this.addEdge(primary.spec.id, id, group.replayRps, group.replayRps);
      const readsEach = group.readRps / group.spec.count;
      const work = readsEach + group.replayRps * REPLICATION.replayCost * (size.readsPerSec / size.writesPerSec);
      let failedReads = 0;
      group.stations.forEach((station, i) => {
        const { tick, failed } = stepStation(station, work, size.vcpu, size.vcpu / size.readsPerSec, this.timeoutSec);
        group.ticks[i] = tick;
        // Only reads can fail; replayed writes that can't be applied yet show up as lag instead.
        failedReads += work > 0 ? (failed / (work * TICK_SEC)) * readsEach * TICK_SEC : 0;
      });
      this.sink.fail(id, 'timeout', failedReads, atSec);
      const readsArriving = group.readRps * TICK_SEC;
      replicaServed.set(group, readsArriving > 0 ? 1 - failedReads / readsArriving : 1);

      stepLag(group.lag, group.stations[0]!.utilization, TICK_SEC);
      group.peakLagSec = Math.max(group.peakLagSec, group.lag.lagSec);
      this.watchLag(id, group, atSec);
    }

    // 5. Stale reads, among the reads that were served.
    const raw = this.data.readAfterWrite;
    const staleByNode = new Map<string, number>();
    const addStale = (nodeId: string, requests: number) =>
      staleByNode.set(nodeId, (staleByNode.get(nodeId) ?? 0) + requests);
    for (const route of this.routes.values()) {
      const { flow, stale } = route;
      const writeRps = route.primary.acceptedWriteRps;
      const sourceLag = route.replicas?.lag.lagSec ?? 0;

      if (route.cache) {
        const cache = route.cache;
        const served = cacheServed.get(cache)! * cache.hitRate;
        stale.normalHit = this.hitStaleShare(cache, writeRps, sourceLag);
        stale.rawHit = raw
          ? average(cacheAges(cache.spec.ttlSec).map((age) =>
              readAfterWriteStaleProbability(age + sourceLag, raw.meanGapSec, route.pinnedSec),
            ))
          : 0;
        addStale(cache.spec.id, (flow.normalLookups * stale.normalHit + flow.rawLookups * stale.rawHit) * served * TICK_SEC);
      }

      if (route.replicas) {
        const group = route.replicas;
        const lag = group.lag.lagSec;
        stale.normalReplica = this.missStaleShare(route.cache, writeRps, lag - this.maxStalenessSec);
        stale.rawReplica = raw ? readAfterWriteStaleProbability(lag, raw.meanGapSec, route.pinnedSec) : 0;
        const served = replicaServed.get(group)!;
        addStale(group.spec.id, (flow.normalMisses * stale.normalReplica + flow.rawMisses * stale.rawReplica) * served * TICK_SEC);
      }
    }
    for (const [nodeId, requests] of staleByNode) this.sink.fail(nodeId, 'stale_read', requests, atSec);
  }

  /**
   * Walks a sampled request's data operation from an app server. Returns the latency it adds in ms, or null if it
   * failed (timed out, or read stale data).
   */
  probe(appId: string, rng: Rng): number | null {
    const route = this.routes.get(appId)!;
    const db = DATABASE_SIZES[route.primary.spec.size];
    const readServiceSec = db.vcpu / db.readsPerSec;
    let latencyMs = 0;
    const visit = (tick: StationTick, meanServiceSec: number): boolean => {
      latencyMs += HOP_LATENCY_MS;
      const waitSec = probeWait(tick, rng, this.timeoutSec);
      if (waitSec === null) return false;
      latencyMs += (waitSec + sampleExponential(rng, 1 / meanServiceSec)) * 1000;
      return true;
    };
    const result = (ok: boolean) => (ok ? latencyMs : null);

    if (rng() >= this.data.readShare) return result(visit(route.primary.tick, db.vcpu / db.writesPerSec));

    const rawShare = this.data.readAfterWrite?.share ?? 0;
    const raw = rawShare > 0 && rng() < rawShare;
    if (raw && route.pinnedShare > 0 && rng() < route.pinnedShare) {
      return result(visit(route.primary.tick, readServiceSec));
    }
    if (route.cache) {
      if (!visit(route.cache.tick, CACHE.workers / CACHE.opsPerSec)) return null;
      if (rng() < route.cache.hitRate) return result(rng() >= (raw ? route.stale.rawHit : route.stale.normalHit));
    }
    if (route.replicas) {
      const group = route.replicas;
      const size = DATABASE_SIZES[group.spec.size];
      const tick = group.ticks[Math.floor(rng() * group.ticks.length)]!;
      if (!visit(tick, size.vcpu / size.readsPerSec)) return null;
      return result(rng() >= (raw ? route.stale.rawReplica : route.stale.normalReplica));
    }
    return result(visit(route.primary.tick, readServiceSec));
  }

  /** Live stats of a data-tier node for the timeline, without `failedRps` (the simulation keeps that). */
  frame(nodeId: string): Omit<NodeFrame, 'failedRps'> | null {
    const cache = this.caches.get(nodeId);
    if (cache) return { arrivalRps: cache.lookupRps, instances: [instanceFrame(cache.station)], hitRate: cache.hitRate };
    const primary = this.primaries.get(nodeId);
    if (primary) {
      return {
        arrivalRps: primary.readRps + primary.writeRps,
        readRps: primary.readRps,
        writeRps: primary.writeRps,
        instances: [instanceFrame(primary.station)],
      };
    }
    const group = this.replicaGroups.get(nodeId);
    if (group) {
      return {
        arrivalRps: group.readRps,
        readRps: group.readRps,
        writeRps: group.replayRps,
        instances: group.stations.map(instanceFrame),
        replicationLagSec: group.lag.lagSec,
      };
    }
    return null;
  }

  /** This tick's flow on every data-tier edge. */
  edges(): ReadonlyMap<string, EdgeFrame> {
    return this.edgeFlows;
  }

  summary(): DataTierSummary {
    const cacheHitRate: Record<string, number> = {};
    for (const [id, cache] of this.caches) {
      cacheHitRate[id] = cache.servedLookups > 0 ? cache.servedHits / cache.servedLookups : 0;
    }
    const peakReplicationLagSec: Record<string, number> = {};
    for (const [id, group] of this.replicaGroups) peakReplicationLagSec[id] = group.peakLagSec;
    return { cacheHitRate, peakReplicationLagSec };
  }

  // -------------------------------------------------------------------------

  private addEdge(from: string, to: string, rps: number, writeRps: number): void {
    const key = `${from}->${to}`;
    const edge = this.edgeFlows.get(key);
    if (edge) {
      edge.rps += rps;
      edge.writeRps += writeRps;
    } else this.edgeFlows.set(key, { rps, writeRps });
  }

  /**
   * Share of cache hits that miss a change older than the staleness limit. A hit's value was fetched a uniformly
   * random time within the TTL ago, from a source `sourceLagSec` behind the primary.
   */
  private hitStaleShare(cache: CacheNode, writeRps: number, sourceLagSec: number): number {
    if (!Number.isFinite(this.maxStalenessSec) || writeRps <= 0 || cache.hitRate <= 0) return 0;
    const windows = cacheAges(cache.spec.ttlSec).map((age) => age + sourceLagSec - this.maxStalenessSec);
    if (windows.every((w) => w <= 0)) return 0;
    const staleHits = this.keys.expect(
      (p) => cache.hitProbability(p) * average(windows.map((w) => keyChangedProbability(p, writeRps, w))),
      cache.capacityKeys,
    );
    return staleHits / cache.hitRate;
  }

  /**
   * Share of reads reaching the database that miss a change made more than the staleness limit ago, when the data
   * they read is `windowSec` beyond that limit. Behind a cache, these are the misses, which lean towards less
   * popular (and so less often changed) keys.
   */
  private missStaleShare(cache: CacheNode | null, writeRps: number, windowSec: number): number {
    if (!(windowSec > 0) || writeRps <= 0) return 0;
    const changed = (p: number) => keyChangedProbability(p, writeRps, windowSec);
    const all = this.keys.expect(changed);
    if (!cache || cache.hitRate <= 0) return all;
    if (cache.hitRate >= 1) return 0;
    const hits = this.keys.expect((p) => cache.hitProbability(p) * changed(p), cache.capacityKeys);
    return Math.max(0, (all - hits) / (1 - cache.hitRate));
  }

  private watchLag(id: string, group: ReplicaGroup, atSec: number): void {
    const lag = group.lag.lagSec;
    if (!group.lagAlert && lag > LAG_ALERT_SEC) {
      group.lagAlert = true;
      const busy = Math.round(group.stations[0]!.utilization * 100);
      this.sink.log({
        atSec,
        kind: 'replicationLagHigh',
        nodeId: id,
        message: `${id} fell behind the primary: replication lag passed ${LAG_ALERT_SEC} s (replicas ${busy}% busy).`,
      });
    } else if (group.lagAlert && lag < LAG_RECOVERED_SEC) {
      group.lagAlert = false;
      this.sink.log({
        atSec,
        kind: 'replicationLagRecovered',
        nodeId: id,
        message: `${id} caught up: replication lag back under ${LAG_ALERT_SEC} s.`,
      });
    }
  }
}

function instanceFrame(station: StationState): InstanceFrame {
  return { up: station.up, utilization: station.utilization, queued: station.backlog };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
