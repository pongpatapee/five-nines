/**
 * The napkin-math step: the working behind each level's estimate question, from the level's own numbers. The
 * working carries every number in it, so the mentor can show the arithmetic after the player answers.
 */
import {
  APP_SERVER_SIZES,
  CACHE_SIZES,
  CACHE_TTLS,
  CLIENTS_ID,
  DATABASE_SIZES,
  type AppServerSize,
  type CacheSize,
  type DatabaseSize,
} from './catalog.ts';
import { interpolate } from './math.ts';
import { popularity, type Popularity } from './numbers.ts';
import { COMFORTABLE_UTILIZATION, HOT_UTILIZATION, peakLoad, peakRps } from './peak-load.ts';
import type { ComponentKind, Design, Estimate, Level } from './schema.ts';

/** An estimate within this share of the answer, either side, earns the bonus mark. */
export const ESTIMATE_TOLERANCE = 0.1;

export type EstimateWorking =
  | { quantity: 'busyVcpusAtPeak'; peakRps: number; cpuMsPerRequest: number; result: number }
  | {
      quantity: 'serversWithSpare';
      size: AppServerSize;
      peakRps: number;
      vcpu: number;
      cpuMsPerRequest: number;
      /** Requests per second one server handles flat out. */
      perServerRps: number;
      /** Servers needed to carry the peak, before the spare. */
      needed: number;
      result: number;
    }
  | {
      quantity: 'cacheHitRateNeeded';
      databaseSize: DatabaseSize;
      peakRps: number;
      readsPerSec: number;
      writesPerSec: number;
      databaseReadsPerSec: number;
      /** How many reads one write costs the database. */
      writeCost: number;
      /** Reads the database has room for once the writes are paid for. */
      readsLeft: number;
      /** Percent. */
      result: number;
    }
  | {
      quantity: 'secondsBetweenKeyReads';
      peakRps: number;
      readShare: number;
      readsPerSec: number;
      /** Keys the reads spread evenly over, and what they are ("profiles"). */
      keys: number;
      keyLabel: string;
      keysPopularity: Popularity;
      /** Seconds. */
      result: number;
    }
  | {
      quantity: 'pinnedPrimaryLoad';
      databaseSize: DatabaseSize;
      peakRps: number;
      readShare: number;
      readsPerSec: number;
      writesPerSec: number;
      readAfterWriteShare: number;
      /** Reads of the reader's own fresh write: all pinned to the primary. */
      freshReadsPerSec: number;
      writeCost: number;
      databaseReadsPerSec: number;
      /** Percent. */
      result: number;
    }
  | {
      quantity: 'shardsAtFullLoad';
      size: DatabaseSize;
      peakRps: number;
      readsPerSec: number;
      writesPerSec: number;
      /** One shard's capacity. */
      shardReadsPerSec: number;
      shardWritesPerSec: number;
      writeCost: number;
      /** Shards' worth of work, before headroom. */
      result: number;
    }
  | {
      quantity: 'coldCacheOverload';
      databaseSize: DatabaseSize;
      /** When the cache restarts, and the request rate then. */
      atSec: number;
      rps: number;
      readShare: number;
      readsPerSec: number;
      databaseReadsPerSec: number;
      /** Times the database's read capacity. */
      result: number;
    }
  | {
      quantity: 'queueDrainRateNeeded';
      peakRps: number;
      /** How long the traffic stays at its peak. */
      spikeSec: number;
      deadlineSec: number;
      /** Orders per second. */
      result: number;
    };

/** Works out the level's estimate question from its workload. Null when the level has no estimate. */
export function estimateWorking(level: Level): EstimateWorking | null {
  const estimate = level.estimate;
  return estimate ? workEstimate(level, estimate) : null;
}

export function workEstimate(level: Level, estimate: Estimate): EstimateWorking {
  const peak = peakRps(level);
  const { cpuMsPerRequest, data } = level.workload;
  const readShare = data?.readShare ?? 0;
  switch (estimate.quantity) {
    case 'busyVcpusAtPeak':
      return { quantity: estimate.quantity, peakRps: peak, cpuMsPerRequest, result: (peak * cpuMsPerRequest) / 1000 };
    case 'serversWithSpare': {
      const { vcpu } = APP_SERVER_SIZES[estimate.size];
      const perServerRps = (vcpu * 1000) / cpuMsPerRequest;
      const needed = Math.ceil(peak / perServerRps);
      return {
        quantity: estimate.quantity,
        size: estimate.size,
        peakRps: peak,
        vcpu,
        cpuMsPerRequest,
        perServerRps,
        needed,
        result: needed + 1,
      };
    }
    case 'cacheHitRateNeeded': {
      const db = DATABASE_SIZES[estimate.databaseSize];
      const readsPerSec = peak * readShare;
      const writesPerSec = peak - readsPerSec;
      const writeCost = db.readsPerSec / db.writesPerSec;
      const readsLeft = db.readsPerSec - writesPerSec * writeCost;
      const hitRate = readsPerSec > 0 ? Math.min(1, Math.max(0, 1 - readsLeft / readsPerSec)) : 0;
      return {
        quantity: estimate.quantity,
        databaseSize: estimate.databaseSize,
        peakRps: peak,
        readsPerSec,
        writesPerSec,
        databaseReadsPerSec: db.readsPerSec,
        writeCost,
        readsLeft,
        result: hitRate * 100,
      };
    }
    case 'secondsBetweenKeyReads': {
      const readsPerSec = peak * readShare;
      const keys = data?.keys.count ?? 0;
      return {
        quantity: estimate.quantity,
        peakRps: peak,
        readShare,
        readsPerSec,
        keys,
        keyLabel: data?.keys.label ?? 'items',
        keysPopularity: popularity(data?.keys.zipf ?? 0),
        result: readsPerSec > 0 ? keys / readsPerSec : Infinity,
      };
    }
    case 'pinnedPrimaryLoad': {
      const db = DATABASE_SIZES[estimate.databaseSize];
      const readsPerSec = peak * readShare;
      const writesPerSec = peak - readsPerSec;
      const share = data?.readAfterWrite?.share ?? 0;
      const freshReadsPerSec = readsPerSec * share;
      const writeCost = db.readsPerSec / db.writesPerSec;
      return {
        quantity: estimate.quantity,
        databaseSize: estimate.databaseSize,
        peakRps: peak,
        readShare,
        readsPerSec,
        writesPerSec,
        readAfterWriteShare: share,
        freshReadsPerSec,
        writeCost,
        databaseReadsPerSec: db.readsPerSec,
        result: ((freshReadsPerSec + writesPerSec * writeCost) / db.readsPerSec) * 100,
      };
    }
    case 'shardsAtFullLoad': {
      const db = DATABASE_SIZES[estimate.size];
      const readsPerSec = peak * readShare;
      const writesPerSec = peak - readsPerSec;
      const writeCost = db.readsPerSec / db.writesPerSec;
      return {
        quantity: estimate.quantity,
        size: estimate.size,
        peakRps: peak,
        readsPerSec,
        writesPerSec,
        shardReadsPerSec: db.readsPerSec,
        shardWritesPerSec: db.writesPerSec,
        writeCost,
        result: (readsPerSec + writesPerSec * writeCost) / db.readsPerSec,
      };
    }
    case 'coldCacheOverload': {
      const db = DATABASE_SIZES[estimate.databaseSize];
      const restart = level.events.find((event) => event.kind === 'cacheRestart');
      const atSec = restart?.atSec ?? 0;
      const rps = restart ? interpolate(level.workload.traffic, atSec) : peak;
      const readsPerSec = rps * readShare;
      return {
        quantity: estimate.quantity,
        databaseSize: estimate.databaseSize,
        atSec,
        rps,
        readShare,
        readsPerSec,
        databaseReadsPerSec: db.readsPerSec,
        result: readsPerSec / db.readsPerSec,
      };
    }
    case 'queueDrainRateNeeded': {
      const atPeak = level.workload.traffic.filter((point) => point.rps === peak);
      const spikeSec = atPeak.length > 0 ? atPeak[atPeak.length - 1]!.atSec - atPeak[0]!.atSec : 0;
      const deadlineSec = level.requirements.processWithinSec ?? Infinity;
      return {
        quantity: estimate.quantity,
        peakRps: peak,
        spikeSec,
        deadlineSec,
        result: (peak * spikeSec) / (deadlineSec + spikeSec),
      };
    }
  }
}

/** Whether a guess is close enough for the bonus mark: within `ESTIMATE_TOLERANCE` of the answer. */
export function isCloseEstimate(guess: number, answer: number): boolean {
  if (!Number.isFinite(guess)) return false;
  return Math.abs(guess - answer) <= ESTIMATE_TOLERANCE * Math.abs(answer) + 1e-9;
}


// ---------------------------------------------------------------------------- the worked solution

/**
 * One line of the worked solution, in the order the mentor works it. Each step carries the numbers it uses and its
 * `result`; the theme says why the step is taken and writes the arithmetic. The last step's result is the answer.
 */
export type NapkinStep =
  /** Size for the busiest moment: the top of the traffic chart. */
  | { kind: 'peak'; atSec: number; result: number }
  /** The traffic the moment a scripted event strikes, rather than at the peak. */
  | { kind: 'trafficAtEvent'; event: 'cacheRestart'; atSec: number; result: number }
  /** Requests × CPU time each: milliseconds of CPU work arriving every second. */
  | { kind: 'cpuWork'; rps: number; cpuMsPerRequest: number; result: number }
  /** One vCPU does 1,000 ms of work a second: the vCPUs that work keeps busy. */
  | { kind: 'vcpusBusy'; cpuMsPerSec: number; result: number }
  /** What one server handles flat out: per vCPU, then for all of them. */
  | {
      kind: 'serverCapacity';
      size: AppServerSize;
      vcpu: number;
      cpuMsPerRequest: number;
      perVcpuRps: number;
      result: number;
    }
  /** Servers to carry the peak: peak ÷ one server, rounded up to whole servers. */
  | { kind: 'serversNeeded'; rps: number; perServerRps: number; exact: number; result: number }
  /** One more than needed, so losing any one still carries the peak. */
  | { kind: 'spareServer'; needed: number; result: number }
  /** Every request is a read or a write: reads are `readShare` of them. `result` is the reads. */
  | { kind: 'splitTraffic'; rps: number; readShare: number; writes: number; result: number }
  /** A write is more work for a database than a read: how many reads' worth of work one write is. */
  | {
      kind: 'writeCost';
      databaseSize: DatabaseSize;
      databaseReadsPerSec: number;
      databaseWritesPerSec: number;
      result: number;
    }
  /** Writes always reach the database, so they use its capacity first; `result` is the room left for reads. */
  | {
      kind: 'writesFirst';
      writes: number;
      writeCost: number;
      writeWork: number;
      databaseReadsPerSec: number;
      result: number;
    }
  /** The share of the reads the database has room for (a fraction). */
  | { kind: 'databaseShare'; readsLeft: number; reads: number; result: number }
  /** The rest is the cache's job: the hit rate, in percent. */
  | { kind: 'cacheHitRate'; databaseShare: number; result: number }
  /** Reads spread evenly over the keys: on average, the seconds between two reads of one key. */
  | { kind: 'keyReadGap'; keys: number; keyLabel: string; reads: number; result: number }
  /** The reads that come from a user checking their own fresh write. */
  | { kind: 'ownWriteReads'; reads: number; share: number; result: number }
  /** Reads plus each write's reads' worth of work: a database's whole load, in reads' worth. */
  | {
      kind: 'totalWork';
      reads: number;
      writes: number;
      writeCost: number;
      writeWork: number;
      /** What the work is for: one shard among many, or a primary that also takes the pinned reads. */
      context: 'shards' | 'pinnedPrimary';
      result: number;
    }
  /** Work ÷ one shard's capacity, if the work spreads evenly over the shards. */
  | { kind: 'shardsOfWork'; work: number; shardCapacity: number; unit: 'reads' | 'writes'; result: number }
  /** Work ÷ the database's capacity: how busy it is, in percent. */
  | { kind: 'databaseBusy'; work: number; databaseReadsPerSec: number; result: number }
  /** Reads ÷ the database's read capacity: how many times what it can do, all at once. */
  | { kind: 'timesCapacity'; reads: number; databaseReadsPerSec: number; result: number }
  /** Orders the spike brings: rate × how long it lasts. */
  | { kind: 'spikeOrders'; rps: number; spikeSec: number; result: number }
  /** The last order arrives at the end of the spike and has the deadline after that: the time to charge them all. */
  | { kind: 'drainWindow'; spikeSec: number; deadlineSec: number; result: number }
  /** Orders ÷ time: the drain rate. */
  | { kind: 'drainRate'; orders: number; windowSec: number; result: number };

/** What the answer means for the design, with the numbers that say so. */
export type NapkinTakeaway =
  /** Work is not capacity: provision for it to sit under the hot line, nearer the comfortable one. */
  | { kind: 'vcpuHeadroom'; vcpus: number; atHot: number; atComfortable: number }
  /** How busy each server is with all of them up, and after one is lost. */
  | { kind: 'survivors'; servers: number; allUp: number; oneDown: number }
  /** The answer leaves the database exactly full; the hit rates that keep it at the hot and comfortable lines. */
  | { kind: 'hitRateHeadroom'; atHot: number; atComfortable: number }
  /**
   * Fresh data needs a TTL no longer than the staleness limit, and that TTL can't reach the hit rate needed: `hitRate`
   * is the best a cache with that TTL manages at the peak.
   */
  | { kind: 'ttlCeiling'; needed: number; ttlSec: number; hitRate: number }
  /**
   * The gap between reads of a key against the longest cache expiry on offer: a cached copy is gone before it's read
   * again. `hitRate` is the best a cache manages at the peak, with the most memory and the longest expiry.
   */
  | { kind: 'cacheExpiry'; gapSec: number; longestTtlSec: number; hitRate: number }
  /** How busy the primary is against the comfortable line, and the next size down. */
  | {
      kind: 'primaryHeadroom';
      size: DatabaseSize;
      utilization: number;
      smaller: { size: DatabaseSize; utilization: number } | null;
    }
  /** Whole shards with headroom: the fewest at or under the hot line, and how busy each is. */
  | { kind: 'wholeShards'; atFullLoad: number; roundedUp: number; roundedUpUtilization: number; shards: number; utilization: number }
  /** Several databases' worth of reads at once, the moment the cache empties: the stampede. */
  | { kind: 'stampede'; times: number }
  /** Normal traffic keeps arriving on top of the spike. */
  | { kind: 'normalTraffic'; drainRate: number; normalRps: number };

/** How a number the working starts from is written, so it can be found in the question or the level's numbers. */
export type NapkinGivenUnit = 'count' | 'percent' | 'ms' | 'seconds' | 'clock' | 'ratio';

/**
 * A number the working starts from rather than works out. Each one must be in front of the player when they're
 * asked: in the question, or in the level's numbers. A `spec` is a component's catalog figure, which the question
 * may leave to the component it names ("a large database").
 */
export interface NapkinGiven {
  value: number;
  unit: NapkinGivenUnit;
  spec?: { kind: ComponentKind; size: string };
}

export interface NapkinSolution {
  working: EstimateWorking;
  /** The numbers the steps start from. Every other number in them is worked out from these. */
  givens: readonly NapkinGiven[];
  steps: readonly NapkinStep[];
  takeaway: NapkinTakeaway;
}

/** The level's estimate worked step by step, from its own numbers. Null when the level has no estimate. */
export function napkinSolution(level: Level): NapkinSolution | null {
  const estimate = level.estimate;
  return estimate ? solveEstimate(level, estimate) : null;
}

const ORDERED_DATABASE_SIZES = Object.keys(DATABASE_SIZES) as DatabaseSize[];

export function solveEstimate(level: Level, estimate: Estimate): NapkinSolution {
  const working = workEstimate(level, estimate);
  const top = peakRps(level);
  const peak: NapkinStep = {
    kind: 'peak',
    atSec: level.workload.traffic.find((point) => point.rps === top)?.atSec ?? 0,
    result: top,
  };
  const readShare = level.workload.data?.readShare ?? 0;
  const split = (rps: number, reads: number, writes: number): NapkinStep => ({
    kind: 'splitTraffic',
    rps,
    readShare,
    writes,
    result: reads,
  });
  const writeCost = (databaseSize: DatabaseSize): NapkinStep => {
    const db = DATABASE_SIZES[databaseSize];
    return {
      kind: 'writeCost',
      databaseSize,
      databaseReadsPerSec: db.readsPerSec,
      databaseWritesPerSec: db.writesPerSec,
      result: db.readsPerSec / db.writesPerSec,
    };
  };
  const count = (value: number): NapkinGiven => ({ value, unit: 'count' });
  const percent = (value: number): NapkinGiven => ({ value, unit: 'percent' });
  const database = (size: DatabaseSize, value: number, unit: NapkinGivenUnit = 'count'): NapkinGiven => ({
    value,
    unit,
    spec: { kind: 'database', size },
  });

  switch (working.quantity) {
    case 'busyVcpusAtPeak': {
      const cpuMsPerSec = working.peakRps * working.cpuMsPerRequest;
      return {
        working,
        givens: [count(working.peakRps), { value: working.cpuMsPerRequest, unit: 'ms' }],
        steps: [
          peak,
          { kind: 'cpuWork', rps: working.peakRps, cpuMsPerRequest: working.cpuMsPerRequest, result: cpuMsPerSec },
          { kind: 'vcpusBusy', cpuMsPerSec, result: working.result },
        ],
        takeaway: {
          kind: 'vcpuHeadroom',
          vcpus: working.result,
          atHot: working.result / HOT_UTILIZATION,
          atComfortable: working.result / COMFORTABLE_UTILIZATION,
        },
      };
    }
    case 'serversWithSpare':
      return {
        working,
        givens: [
          count(working.peakRps),
          { value: working.cpuMsPerRequest, unit: 'ms' },
          { value: working.vcpu, unit: 'count', spec: { kind: 'appServer', size: working.size } },
        ],
        steps: [
          peak,
          {
            kind: 'serverCapacity',
            size: working.size,
            vcpu: working.vcpu,
            cpuMsPerRequest: working.cpuMsPerRequest,
            perVcpuRps: 1000 / working.cpuMsPerRequest,
            result: working.perServerRps,
          },
          {
            kind: 'serversNeeded',
            rps: working.peakRps,
            perServerRps: working.perServerRps,
            exact: working.peakRps / working.perServerRps,
            result: working.needed,
          },
          { kind: 'spareServer', needed: working.needed, result: working.result },
        ],
        takeaway: {
          kind: 'survivors',
          servers: working.result,
          allUp: working.peakRps / (working.result * working.perServerRps),
          oneDown: working.peakRps / ((working.result - 1) * working.perServerRps),
        },
      };
    case 'cacheHitRateNeeded': {
      const db = DATABASE_SIZES[working.databaseSize];
      const writeWork = working.writesPerSec * working.writeCost;
      const databaseShare = working.result === 0 ? 1 : 1 - working.result / 100;
      // The hit rate that leaves the database `utilization` busy instead of full.
      const hitRateAt = (utilization: number) =>
        Math.min(100, Math.max(0, (1 - (utilization * working.databaseReadsPerSec - writeWork) / working.readsPerSec) * 100));
      const staleness = level.requirements.maxStalenessSec;
      return {
        working,
        givens: [
          count(working.peakRps),
          percent(readShare),
          database(working.databaseSize, db.readsPerSec),
          database(working.databaseSize, db.writesPerSec),
        ],
        steps: [
          peak,
          split(working.peakRps, working.readsPerSec, working.writesPerSec),
          writeCost(working.databaseSize),
          {
            kind: 'writesFirst',
            writes: working.writesPerSec,
            writeCost: working.writeCost,
            writeWork,
            databaseReadsPerSec: working.databaseReadsPerSec,
            result: working.readsLeft,
          },
          { kind: 'databaseShare', readsLeft: working.readsLeft, reads: working.readsPerSec, result: databaseShare },
          { kind: 'cacheHitRate', databaseShare, result: working.result },
        ],
        takeaway:
          staleness === undefined
            ? { kind: 'hitRateHeadroom', atHot: hitRateAt(HOT_UTILIZATION), atComfortable: hitRateAt(COMFORTABLE_UTILIZATION) }
            : {
                kind: 'ttlCeiling',
                needed: working.result,
                ttlSec: freshTtl(staleness),
                hitRate: bestCacheHitRate(level, freshTtl(staleness)) * 100,
              },
      };
    }
    case 'secondsBetweenKeyReads': {
      const longestTtlSec = Math.max(...CACHE_TTLS);
      return {
        working,
        givens: [count(working.peakRps), percent(working.readShare), count(working.keys)],
        steps: [
          peak,
          split(working.peakRps, working.readsPerSec, working.peakRps - working.readsPerSec),
          { kind: 'keyReadGap', keys: working.keys, keyLabel: working.keyLabel, reads: working.readsPerSec, result: working.result },
        ],
        takeaway: {
          kind: 'cacheExpiry',
          gapSec: working.result,
          longestTtlSec,
          hitRate: bestCacheHitRate(level, longestTtlSec),
        },
      };
    }
    case 'pinnedPrimaryLoad': {
      const writeWork = working.writesPerSec * working.writeCost;
      const work = working.freshReadsPerSec + writeWork;
      const index = ORDERED_DATABASE_SIZES.indexOf(working.databaseSize);
      const smallerSize = index > 0 ? ORDERED_DATABASE_SIZES[index - 1]! : null;
      return {
        working,
        givens: [
          count(working.peakRps),
          percent(working.readShare),
          percent(working.readAfterWriteShare),
          database(working.databaseSize, working.databaseReadsPerSec),
          database(working.databaseSize, working.writeCost, 'ratio'),
        ],
        steps: [
          peak,
          split(working.peakRps, working.readsPerSec, working.writesPerSec),
          { kind: 'ownWriteReads', reads: working.readsPerSec, share: working.readAfterWriteShare, result: working.freshReadsPerSec },
          {
            kind: 'totalWork',
            reads: working.freshReadsPerSec,
            writes: working.writesPerSec,
            writeCost: working.writeCost,
            writeWork,
            context: 'pinnedPrimary',
            result: work,
          },
          { kind: 'databaseBusy', work, databaseReadsPerSec: working.databaseReadsPerSec, result: working.result },
        ],
        takeaway: {
          kind: 'primaryHeadroom',
          size: working.databaseSize,
          utilization: working.result / 100,
          smaller: smallerSize
            ? {
                size: smallerSize,
                utilization: (working.freshReadsPerSec + working.writesPerSec * writeCostOf(smallerSize)) / DATABASE_SIZES[smallerSize].readsPerSec,
              }
            : null,
        },
      };
    }
    case 'shardsAtFullLoad': {
      const writeWork = working.writesPerSec * working.writeCost;
      const work: NapkinStep[] =
        working.readsPerSec > 0
          ? [
              writeCost(working.size),
              {
                kind: 'totalWork',
                reads: working.readsPerSec,
                writes: working.writesPerSec,
                writeCost: working.writeCost,
                writeWork,
                context: 'shards',
                result: working.readsPerSec + writeWork,
              },
              {
                kind: 'shardsOfWork',
                work: working.readsPerSec + writeWork,
                shardCapacity: working.shardReadsPerSec,
                unit: 'reads',
                result: working.result,
              },
            ]
          : [
              {
                kind: 'shardsOfWork',
                work: working.writesPerSec,
                shardCapacity: working.shardWritesPerSec,
                unit: 'writes',
                result: working.result,
              },
            ];
      const roundedUp = Math.max(1, Math.ceil(working.result - 1e-9));
      let shards = roundedUp;
      while (working.result / shards > HOT_UTILIZATION) shards += 1;
      return {
        working,
        givens: [
          count(working.peakRps),
          ...(working.readsPerSec > 0 ? [percent(readShare), database(working.size, working.shardReadsPerSec)] : []),
          database(working.size, working.shardWritesPerSec),
        ],
        steps: [peak, split(working.peakRps, working.readsPerSec, working.writesPerSec), ...work],
        takeaway: {
          kind: 'wholeShards',
          atFullLoad: working.result,
          roundedUp,
          roundedUpUtilization: working.result / roundedUp,
          shards,
          utilization: working.result / shards,
        },
      };
    }
    case 'coldCacheOverload':
      return {
        working,
        givens: [
          // The restart's time is deliberately not a given: events are named up front, never timed.
          count(working.rps),
          percent(working.readShare),
          database(working.databaseSize, working.databaseReadsPerSec),
        ],
        steps: [
          { kind: 'trafficAtEvent', event: 'cacheRestart', atSec: working.atSec, result: working.rps },
          split(working.rps, working.readsPerSec, working.rps - working.readsPerSec),
          {
            kind: 'timesCapacity',
            reads: working.readsPerSec,
            databaseReadsPerSec: working.databaseReadsPerSec,
            result: working.result,
          },
        ],
        takeaway: { kind: 'stampede', times: working.result },
      };
    case 'queueDrainRateNeeded': {
      const orders = working.peakRps * working.spikeSec;
      const windowSec = working.spikeSec + working.deadlineSec;
      return {
        working,
        givens: [
          count(working.peakRps),
          { value: working.spikeSec, unit: 'seconds' },
          { value: working.deadlineSec, unit: 'seconds' },
        ],
        steps: [
          peak,
          { kind: 'spikeOrders', rps: working.peakRps, spikeSec: working.spikeSec, result: orders },
          { kind: 'drainWindow', spikeSec: working.spikeSec, deadlineSec: working.deadlineSec, result: windowSec },
          { kind: 'drainRate', orders, windowSec, result: working.result },
        ],
        takeaway: {
          kind: 'normalTraffic',
          drainRate: working.result,
          normalRps: Math.min(...level.workload.traffic.map((point) => point.rps)),
        },
      };
    }
  }
}

function writeCostOf(size: DatabaseSize): number {
  return DATABASE_SIZES[size].readsPerSec / DATABASE_SIZES[size].writesPerSec;
}

/** The longest TTL on offer that keeps a cached value within the staleness limit (the shortest, if none does). */
function freshTtl(maxStalenessSec: number): number {
  const fresh = CACHE_TTLS.filter((ttl) => ttl <= maxStalenessSec);
  return fresh.length > 0 ? Math.max(...fresh) : Math.min(...CACHE_TTLS);
}

/**
 * The best hit rate a cache with this TTL reaches at the level's peak: the most memory on offer, worked out the way
 * the editor's gauges work it (`peakLoad`), on a design that is nothing but app servers, the cache and a database.
 */
export function bestCacheHitRate(level: Level, ttlSec: number): number {
  const biggest = (Object.keys(CACHE_SIZES) as CacheSize[]).reduce((a, b) =>
    CACHE_SIZES[b].memoryGb > CACHE_SIZES[a].memoryGb ? b : a,
  );
  const design: Design = {
    nodes: [
      { id: 'app', kind: 'appServer', size: 'xlarge', instances: 64 },
      { id: 'cache', kind: 'cache', size: biggest, ttlSec },
      { id: 'db', kind: 'database', size: 'xlarge' },
    ],
    edges: [
      { from: CLIENTS_ID, to: 'app' },
      { from: 'app', to: 'cache' },
      { from: 'app', to: 'db' },
    ],
  };
  return peakLoad(level, design).nodes.cache?.hitRate ?? 0;
}
