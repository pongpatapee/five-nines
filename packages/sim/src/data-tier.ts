/**
 * The data tier: caches, the primary database and read replicas behind the app servers.
 *
 * Every request that an app server finishes then does one data operation, a read or a write of a key (the level's
 * `workload.data`). Each app server routes its operations by what it is connected to:
 *
 * - Writes go to the primary: a single database, or the shard that owns the key in a sharded one.
 * - Read-after-write reads within the replicas' read-your-writes window go to the primary ("pinned").
 * - Other reads check the cache first, if there is one (look-aside). Hits are served from memory.
 * - Misses, and every read when there is no cache, go to the read replicas if connected, otherwise to the primary.
 *
 * A cache can delete each written key (invalidation on write), and coalesce misses: a read of a key whose fetch is
 * already in flight waits for it rather than reading the database too. Fetches take as long as the database's queue,
 * so when it backs up (a restarted, empty cache sends it everything) the cache fills late and more reads miss: the
 * stampede that coalescing stops.
 *
 * Replicas replay every write the primary accepts and lag behind it by an amount that grows with how busy they are
 * (`stepLag`). A read is stale, and fails, when it misses a write it should have seen: a read-after-write read that
 * misses the reader's own write, or any read that misses a change older than the level's staleness limit. Cached
 * values are as old as the time since they were fetched, plus the lag of wherever they were fetched from.
 */
import { CACHE, CACHE_SIZES, DATABASE_SIZES, HOP_LATENCY_MS, REPLICATION, TICK_SEC } from './catalog.ts';
import {
  cacheAges,
  cacheCapacityKeys,
  cacheHitRate,
  cacheInFlightRate,
  keyChangedProbability,
  keyHitFunction,
  readAfterWriteStaleProbability,
  shardShares,
  stepLag,
  ZipfKeys,
  type CacheConditions,
  type LagState,
} from './data-model.ts';
import type { Graph } from './graph.ts';
import { sampleExponential, type Rng } from './math.ts';
import { IDLE_TICK, newStation, probeWait, stepStation, type StationState, type StationTick } from './queue.ts';
import type {
  CacheSpec,
  DatabaseSpec,
  DataWorkload,
  Level,
  ReadReplicasSpec,
  ScenarioEvent,
  ShardKey,
  ShardsSpec,
} from './schema.ts';
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
  /** Lookups that have reached the cache since it last started empty. */
  readsSoFar: number;
  lookupRps: number;
  /** Writes this tick that delete their key (when the cache invalidates on write). */
  invalidationRps: number;
  hitRate: number;
  /** Share of lookups that waited for a fetch already in flight (request coalescing). */
  coalescedRate: number;
  /** How long a fetch to the database takes this tick: its queue, as of the last tick. */
  fillDelaySec: number;
  /** Per-key hit chance this tick, by the key's share of reads. */
  hitProbability: (share: number) => number;
  /** Stale reads it served this tick, per second. */
  staleRps: number;
  servedLookups: number;
  servedHits: number;
}

/** Where writes go: a single primary database, or a sharded one with one primary per shard. */
interface StoreNode {
  spec: DatabaseSpec | ShardsSpec;
  /** One per shard; a plain database has one. */
  stations: StationState[];
  ticks: StationTick[];
  /** Each shard's share of the reads and writes. [1] for a plain database. */
  shares: number[];
  /** The shard key, for a sharded database. */
  shardKey: ShardKey | null;
  readRps: number;
  writeRps: number;
  /** Writes the primary accepted this tick: what the replicas must replay. */
  acceptedWriteRps: number;
}

interface ReplicaGroup {
  spec: ReadReplicasSpec;
  /** The database the group copies. Validation guarantees there is one, and that it isn't sharded. */
  primary: StoreNode | null;
  stations: StationState[];
  ticks: StationTick[];
  lag: LagState;
  readRps: number;
  replayRps: number;
  peakLagSec: number;
  lagAlert: boolean;
  /** Stale reads it served this tick, per second. */
  staleRps: number;
}

/** One app server's way to its data, and what its reads met this tick (for probes). */
interface Route {
  appId: string;
  cache: CacheNode | null;
  primary: StoreNode;
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
  private readonly primaries = new Map<string, StoreNode>();
  private readonly replicaGroups = new Map<string, ReplicaGroup>();
  private readonly routes = new Map<string, Route>();
  private readonly edgeFlows = new Map<string, EdgeFrame>();
  /** The hot key event under way, if any. */
  private hotKey: Extract<ScenarioEvent, { kind: 'hotKey' }> | null = null;

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
            invalidationRps: 0,
            hitRate: 0,
            coalescedRate: 0,
            fillDelaySec: 0,
            hitProbability: () => 0,
            staleRps: 0,
            servedLookups: 0,
            servedHits: 0,
          });
          break;
        case 'database':
        case 'shards': {
          const count = node.kind === 'shards' ? node.count : 1;
          const shardKey = node.kind === 'shards' ? (data.shardKeys?.find((key) => key.id === node.shardKey) ?? null) : null;
          this.primaries.set(node.id, {
            spec: node,
            stations: Array.from({ length: count }, newStation),
            ticks: Array.from({ length: count }, () => IDLE_TICK),
            shares: shardKey ? shardShares(shardKey, count) : evenShares(count),
            shardKey,
            readRps: 0,
            writeRps: 0,
            acceptedWriteRps: 0,
          });
          break;
        }
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
            staleRps: 0,
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

  /**
   * A cache node restarts: the one with the most lookups (first in design order on ties). Unless it's replicated, it
   * comes back empty and has to warm up again.
   */
  restartBusiestCache(atSec: number): void {
    let busiest: [string, CacheNode] | null = null;
    for (const entry of this.caches) if (busiest === null || entry[1].lookupRps > busiest[1].lookupRps) busiest = entry;
    if (busiest === null) return;
    const [id, cache] = busiest;
    if (!cache.spec.replicated) cache.readsSoFar = 0;
    this.sink.log({
      atSec,
      kind: 'cacheRestarted',
      nodeId: id,
      message: cache.spec.replicated
        ? `${id} restarted; its replica took over with every value still cached.`
        : `${id} restarted and came back empty.`,
    });
  }

  /** One value of a shard key starts taking a share of all data operations, until the event's `untilSec`. */
  startHotKey(event: Extract<ScenarioEvent, { kind: 'hotKey' }>, atSec: number): void {
    this.hotKey = event;
    this.updateShares();
    const key = this.data.shardKeys?.find((k) => k.id === event.shardKey);
    this.sink.log({
      atSec,
      kind: 'hotKeyStarted',
      nodeId: '',
      shardKey: event.shardKey,
      label: event.label,
      message: `Hot key: ${event.label} takes ${Math.round(event.share * 100)}% of all writes, every one with the same ${key?.label ?? event.shardKey}.`,
    });
  }

  /** Pushes this tick's data operations through the tier. `outflows` is the requests each app server finished. */
  step(outflows: ReadonlyMap<string, number>, atSec: number): void {
    if (this.hotKey && atSec >= this.hotKey.untilSec - 1e-9) {
      const ended = this.hotKey;
      this.hotKey = null;
      this.updateShares();
      this.sink.log({ atSec, kind: 'hotKeyEnded', nodeId: '', shardKey: ended.shardKey, label: ended.label, message: `The hot key cooled off: ${ended.label} is back to normal.` });
    }
    this.edgeFlows.clear();
    for (const cache of this.caches.values()) {
      cache.lookupRps = 0;
      cache.invalidationRps = 0;
      cache.fillDelaySec = 0;
    }
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
      if (route.cache) {
        route.cache.lookupRps += flow.normalLookups + flow.rawLookups;
        if (route.cache.spec.invalidateOnWrite) route.cache.invalidationRps += flow.writes;
        route.cache.fillDelaySec = Math.max(route.cache.fillDelaySec, missWaitSec(route));
      }
    }

    // 2. Caches: lookups that don't time out either hit, wait for a fetch already in flight (when coalescing), or
    //    miss and go on to the database. Invalidations are deletes: they load the cache like lookups.
    const cacheServed = new Map<CacheNode, number>();
    for (const [id, cache] of this.caches) {
      const ops = cache.lookupRps + cache.invalidationRps;
      const { tick, failed } = stepStation(cache.station, ops, CACHE.workers, CACHE.workers / CACHE.opsPerSec, this.timeoutSec);
      cache.tick = tick;
      const failedShare = ops > 0 ? failed / (ops * TICK_SEC) : 0;
      const failedLookups = cache.lookupRps * TICK_SEC * failedShare;
      this.sink.fail(id, 'timeout', failedLookups, atSec);
      const conditions: CacheConditions = {
        keys: this.keys,
        capacityKeys: cache.capacityKeys,
        readsSoFar: cache.readsSoFar,
        readRps: cache.lookupRps,
        ttlSec: cache.spec.ttlSec,
        fillLagReads: cache.lookupRps * cache.fillDelaySec,
        invalidationWriteRps: cache.invalidationRps,
      };
      cache.hitRate = cacheHitRate(conditions);
      cache.coalescedRate = cache.spec.coalesceMisses ? cacheInFlightRate(conditions) : 0;
      cache.hitProbability = keyHitFunction(conditions);
      cache.readsSoFar += cache.lookupRps * TICK_SEC;
      const arriving = cache.lookupRps * TICK_SEC;
      const served = 1 - failedShare;
      cacheServed.set(cache, served);
      cache.servedLookups += arriving - failedLookups;
      cache.servedHits += (arriving - failedLookups) * cache.hitRate;
    }

    for (const route of this.routes.values()) {
      const flow = route.flow;
      const missShare = route.cache
        ? cacheServed.get(route.cache)! * (1 - route.cache.hitRate - route.cache.coalescedRate)
        : 1;
      flow.normalMisses = flow.normalLookups * missShare;
      flow.rawMisses = flow.rawLookups * missShare;
      const misses = flow.normalMisses + flow.rawMisses;
      if (route.replicas) route.replicas.readRps += misses;
      else route.primary.readRps += misses;

      if (route.cache) {
        const invalidations = route.cache.spec.invalidateOnWrite ? flow.writes : 0;
        this.addEdge(route.appId, route.cache.spec.id, flow.normalLookups + flow.rawLookups + invalidations, invalidations);
      }
      this.addEdge(
        route.appId,
        route.primary.spec.id,
        flow.writes + flow.pinned + (route.replicas ? 0 : misses),
        flow.writes,
      );
      if (route.replicas) this.addEdge(route.appId, route.replicas.spec.id, misses, 0);
    }

    // 3. The primary: reads and writes share the machine, a write costing readsPerSec / writesPerSec reads. A
    //    sharded database is a primary per shard, each getting its share of both.
    for (const [id, primary] of this.primaries) {
      const size = DATABASE_SIZES[primary.spec.size];
      const writeCost = size.readsPerSec / size.writesPerSec;
      let failedRequests = 0;
      primary.acceptedWriteRps = 0;
      primary.stations.forEach((station, i) => {
        const share = primary.shares[i]!;
        const reads = primary.readRps * share;
        const writes = primary.writeRps * share;
        const work = reads + writes * writeCost;
        const { tick, failed } = stepStation(station, work, size.vcpu, size.vcpu / size.readsPerSec, this.timeoutSec);
        primary.ticks[i] = tick;
        const failedShare = work > 0 ? failed / (work * TICK_SEC) : 0;
        failedRequests += (reads + writes) * TICK_SEC * failedShare;
        primary.acceptedWriteRps += writes * (1 - failedShare);
      });
      this.sink.fail(id, 'timeout', failedRequests, atSec);
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
    for (const cache of this.caches.values()) cache.staleRps = 0;
    for (const group of this.replicaGroups.values()) group.staleRps = 0;
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
          ? average(cachedValueAges(cache.spec).map((age) =>
              readAfterWriteStaleProbability(age + sourceLag, raw.meanGapSec, route.pinnedSec),
            ))
          : 0;
        const staleRequests = (flow.normalLookups * stale.normalHit + flow.rawLookups * stale.rawHit) * served * TICK_SEC;
        cache.staleRps += staleRequests / TICK_SEC;
        addStale(cache.spec.id, staleRequests);
      }

      if (route.replicas) {
        const group = route.replicas;
        const lag = group.lag.lagSec;
        stale.normalReplica = this.missStaleShare(route.cache, writeRps, lag - this.maxStalenessSec);
        stale.rawReplica = raw ? readAfterWriteStaleProbability(lag, raw.meanGapSec, route.pinnedSec) : 0;
        const served = replicaServed.get(group)!;
        const staleRequests = (flow.normalMisses * stale.normalReplica + flow.rawMisses * stale.rawReplica) * served * TICK_SEC;
        group.staleRps += staleRequests / TICK_SEC;
        addStale(group.spec.id, staleRequests);
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
    // The shard that owns the key; a plain database has just the one, and draws no random number for it.
    const primaryTick = () => {
      const { ticks, shares } = route.primary;
      if (ticks.length === 1) return ticks[0]!;
      let u = rng();
      for (let i = 0; i < ticks.length; i++) {
        u -= shares[i]!;
        if (u < 0) return ticks[i]!;
      }
      return ticks[ticks.length - 1]!;
    };
    let latencyMs = 0;
    const visit = (tick: StationTick, meanServiceSec: number): boolean => {
      latencyMs += HOP_LATENCY_MS;
      const waitSec = probeWait(tick, rng, this.timeoutSec);
      if (waitSec === null) return false;
      latencyMs += (waitSec + sampleExponential(rng, 1 / meanServiceSec)) * 1000;
      return true;
    };
    const result = (ok: boolean) => (ok ? latencyMs : null);

    if (rng() >= this.data.readShare) return result(visit(primaryTick(), db.vcpu / db.writesPerSec));

    const rawShare = this.data.readAfterWrite?.share ?? 0;
    const raw = rawShare > 0 && rng() < rawShare;
    if (raw && route.pinnedShare > 0 && rng() < route.pinnedShare) {
      return result(visit(primaryTick(), readServiceSec));
    }
    if (route.cache) {
      const cache = route.cache;
      if (!visit(cache.tick, CACHE.workers / CACHE.opsPerSec)) return null;
      const u = rng();
      if (u < cache.hitRate) return result(rng() >= (raw ? route.stale.rawHit : route.stale.normalHit));
      if (u < cache.hitRate + cache.coalescedRate) {
        // Waits for the fetch already in flight, then gets its value.
        latencyMs += cache.fillDelaySec * 1000;
        return result(rng() >= (raw ? route.stale.rawHit : route.stale.normalHit));
      }
    }
    if (route.replicas) {
      const group = route.replicas;
      const size = DATABASE_SIZES[group.spec.size];
      const tick = group.ticks[Math.floor(rng() * group.ticks.length)]!;
      if (!visit(tick, size.vcpu / size.readsPerSec)) return null;
      return result(rng() >= (raw ? route.stale.rawReplica : route.stale.normalReplica));
    }
    return result(visit(primaryTick(), readServiceSec));
  }

  /** Live stats of a data-tier node for the timeline, without `failedRps` (the simulation keeps that). */
  frame(nodeId: string): Omit<NodeFrame, 'failedRps'> | null {
    const cache = this.caches.get(nodeId);
    if (cache) {
      return {
        arrivalRps: cache.lookupRps,
        instances: [instanceFrame(cache.station)],
        hitRate: cache.hitRate,
        coalescedRate: cache.coalescedRate,
        staleRps: cache.staleRps,
        ...(cache.spec.invalidateOnWrite ? { writeRps: cache.invalidationRps } : {}),
      };
    }
    const primary = this.primaries.get(nodeId);
    if (primary) {
      return {
        arrivalRps: primary.readRps + primary.writeRps,
        readRps: primary.readRps,
        writeRps: primary.writeRps,
        instances: primary.stations.map(instanceFrame),
        ...(primary.spec.kind === 'shards' ? { shardShares: [...primary.shares] } : {}),
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
        staleRps: group.staleRps,
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

  /** Each store's shard shares, with the hot key under way (if any) on the stores sharded by its key. */
  private updateShares(): void {
    for (const store of this.primaries.values()) {
      const key = store.shardKey;
      if (!key) continue;
      const hot = this.hotKey?.shardKey === key.id ? this.hotKey.share : 0;
      store.shares = shardShares(key, store.stations.length, hot);
    }
  }

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
   * random time within the TTL ago, from a source `sourceLagSec` behind the primary. When writes invalidate, a write
   * deletes the cached value, so a hit can only miss a change its source hadn't replayed when it was fetched.
   */
  private hitStaleShare(cache: CacheNode, writeRps: number, sourceLagSec: number): number {
    if (!Number.isFinite(this.maxStalenessSec) || writeRps <= 0 || cache.hitRate <= 0) return 0;
    const windows = cachedValueAges(cache.spec).map((age) => age + sourceLagSec - this.maxStalenessSec);
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

/**
 * The ages at which a hit's value is sampled: uniform over the TTL, or just the moment of the fetch when writes
 * invalidate (any later change would have deleted it).
 */
function cachedValueAges(spec: CacheSpec): number[] {
  return spec.invalidateOnWrite ? [0] : cacheAges(spec.ttlSec);
}

/** How long a cache's fetch waits at the store its misses go to: the backlog there, as of the last tick. */
function missWaitSec(route: Route): number {
  if (route.replicas) return average(route.replicas.ticks.map((tick) => tick.backlogWaitSec));
  const { ticks, shares } = route.primary;
  return ticks.reduce((sum, tick, i) => sum + tick.backlogWaitSec * shares[i]!, 0);
}

function evenShares(count: number): number[] {
  return new Array<number>(count).fill(1 / count);
}

function instanceFrame(station: StationState): InstanceFrame {
  return { up: station.up, utilization: station.utilization, queued: station.backlog };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
