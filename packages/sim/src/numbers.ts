/**
 * "The numbers": every figure a level gives the player to reason with, read straight from the level's data so it can
 * never disagree with what the simulation runs. The briefing and the napkin-maths card show it; a theme words it.
 *
 * Only what the level uses is included: key counts and item sizes only where a cache or shards make them matter, the
 * provider's limits only where there are payments. Scheduled events are named, never timed: the player learns that a
 * server will crash, not when. Component specs are not level numbers; they live in the catalog.
 */
import { AVAILABILITY_TIERS } from './catalog.ts';
import type { Level } from './schema.ts';

/** How the request rate moves over the run. */
export interface TrafficShape {
  /** The rate at the start of the run. */
  startRps: number;
  /** The highest rate outside spikes: what the traffic climbs to and stays at, or the steady rate. */
  sustainedRps: number;
  /** Bursts above the sustained rate that fall back again, each at its top for `durationSec`. */
  spikes: readonly { rps: number; durationSec: number }[];
}

/** How a level's reads spread over its keys: every key equally likely, a gentle lean, or a few very popular keys. */
export type Popularity = 'uniform' | 'mild' | 'skewed';

/** Zipf exponents from here up read as "a few are very popular". */
const SKEWED_ZIPF = 0.75;

export function popularity(zipf: number): Popularity {
  if (zipf === 0) return 'uniform';
  return zipf < SKEWED_ZIPF ? 'mild' : 'skewed';
}

/** Something the level does to the design during the run, named without its time. */
export type RunSurprise =
  | { kind: 'crash' }
  | { kind: 'cacheRestart' }
  | { kind: 'hotKey'; label: string }
  /** The payment provider refuses calls over its limit. */
  | { kind: 'rateLimit' };

export interface LevelNumbers {
  /** What one request is to the player: an order in a level with payments, a request otherwise. */
  unit: 'requests' | 'orders';
  traffic: TrafficShape;
  cpuMsPerRequest: number;
  timeoutMs: number;
  /** Null in a level without a data tier. */
  data: {
    readShare: number;
    /** Reads of the reader's own fresh write: their share of reads, and the mean gap since the write. */
    readAfterWrite: { share: number; meanGapSec: number } | null;
    /** The keys, where a cache makes their number and popularity matter. */
    keys: { count: number; label: string; popularity: Popularity } | null;
    /** One cached value's size, where a cache makes it matter. */
    itemKb: number | null;
    /** The shard keys on offer, where shards make them matter. */
    shardKeys: readonly ShardKeyNumbers[] | null;
  } | null;
  /** The external provider's limits, in a level with payments. */
  payments: { rateLimitRps: number; latencyMs: number } | null;
  requirements: {
    /** The availability a pass needs, as a fraction. */
    availability: number;
    p99Ms: number;
    budgetUsdPerMonth: number;
    maxStalenessSec: number | null;
    /** Readers must always see their own writes. */
    ownWrites: boolean;
    /** Queued work must be done within this long of being accepted. */
    processWithinSec: number | null;
  };
  durationSec: number;
  surprises: readonly RunSurprise[];
}

export type ShardKeyNumbers =
  | { label: string; spread: 'sequential' }
  | { label: string; spread: 'hash'; count: number; popularity: Popularity };

export function levelNumbers(level: Level): LevelNumbers {
  const { workload, requirements, components } = level;
  const data = workload.data;
  const hasCache = components.includes('cache');
  return {
    unit: workload.payments ? 'orders' : 'requests',
    traffic: trafficShape(workload.traffic),
    cpuMsPerRequest: workload.cpuMsPerRequest,
    timeoutMs: workload.timeoutMs,
    data: data
      ? {
          readShare: data.readShare,
          readAfterWrite: data.readAfterWrite ? { ...data.readAfterWrite } : null,
          keys: hasCache ? { count: data.keys.count, label: data.keys.label ?? 'items', popularity: popularity(data.keys.zipf) } : null,
          itemKb: hasCache ? data.keys.valueKb : null,
          shardKeys:
            components.includes('shards') && data.shardKeys
              ? data.shardKeys.map((key) =>
                  key.spread.kind === 'sequential'
                    ? { label: key.label, spread: 'sequential' as const }
                    : { label: key.label, spread: 'hash' as const, count: key.spread.count, popularity: popularity(key.spread.zipf) },
                )
              : null,
        }
      : null,
    payments: workload.payments ? { ...workload.payments } : null,
    requirements: {
      availability: AVAILABILITY_TIERS.pass,
      p99Ms: requirements.p99Ms,
      budgetUsdPerMonth: requirements.budgetUsdPerMonth,
      maxStalenessSec: requirements.maxStalenessSec ?? null,
      ownWrites: data?.readAfterWrite !== undefined,
      processWithinSec: requirements.processWithinSec ?? null,
    },
    durationSec: level.durationSec,
    surprises: runSurprises(level),
  };
}

/**
 * Reads the traffic curve as a player would: where it starts, where it settles, and any spike that falls back. A
 * spike is a run of points at one rate, above the points either side of it, that isn't the end of the run.
 */
export function trafficShape(points: readonly { atSec: number; rps: number }[]): TrafficShape {
  const spikes: { rps: number; durationSec: number }[] = [];
  const inSpike = new Set<number>();
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && points[j + 1]!.rps === points[i]!.rps) j += 1;
    const before = points[i - 1];
    const after = points[j + 1];
    if (before && after && points[i]!.rps > before.rps && points[i]!.rps > after.rps) {
      spikes.push({ rps: points[i]!.rps, durationSec: points[j]!.atSec - points[i]!.atSec });
      for (let k = i; k <= j; k++) inSpike.add(k);
    }
    i = j + 1;
  }
  const outside = points.filter((_, k) => !inSpike.has(k)).map((point) => point.rps);
  return { startRps: points[0]?.rps ?? 0, sustainedRps: Math.max(0, ...outside), spikes };
}

function runSurprises(level: Level): RunSurprise[] {
  const surprises: RunSurprise[] = [];
  const seen = new Set<string>();
  const add = (surprise: RunSurprise) => {
    const key = surprise.kind === 'hotKey' ? `hotKey:${surprise.label}` : surprise.kind;
    if (seen.has(key)) return;
    seen.add(key);
    surprises.push(surprise);
  };
  for (const event of level.events) {
    switch (event.kind) {
      case 'instanceFailure':
        add({ kind: 'crash' });
        break;
      case 'cacheRestart':
        add({ kind: 'cacheRestart' });
        break;
      case 'hotKey':
        add({ kind: 'hotKey', label: event.label });
        break;
    }
  }
  if (level.workload.payments) add({ kind: 'rateLimit' });
  return surprises;
}
