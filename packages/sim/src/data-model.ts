/**
 * The maths of the data tier: how reads spread over keys, what a cache of a given size hits, how far behind a
 * replica falls, and how often a read sees out-of-date data. Pure functions, so each can be tested on its own.
 *
 * Every result is an exact expected fraction rather than a sample, like the rest of the engine's failure
 * accounting.
 */
import { REPLICATION } from './catalog.ts';
import type { ShardKey } from './schema.ts';

/** Keys summed one by one before the tail is integrated. */
const EXACT_KEYS = 64;
/** Simpson intervals for the tail integral (even). */
const TAIL_INTERVALS = 256;

/**
 * A keyspace whose popularity follows Zipf's law: the key of popularity rank k gets a share of requests
 * proportional to k^−exponent. Exponent 0 is uniform.
 *
 * Sums over the keys are computed without visiting every key (datasets have billions): the most popular keys
 * exactly, and the long tail as an integral over log(rank), which is smooth there.
 */
export class ZipfKeys {
  readonly count: number;
  readonly exponent: number;
  private readonly norm: number;

  constructor(count: number, exponent: number) {
    this.count = count;
    this.exponent = exponent;
    this.norm = this.sum((k) => k ** -exponent, count);
  }

  /** Share of all requests that go to the key of popularity rank `rank` (1 is the most popular). */
  share(rank: number): number {
    return rank ** -this.exponent / this.norm;
  }

  /** Share of all requests that go to the `top` most popular keys. */
  topShare(top: number): number {
    return this.expect(() => 1, top);
  }

  /**
   * Σ p·f(p) over the `top` most popular keys (default all), where p is each key's share of requests: the
   * request-weighted total of a per-key quantity f.
   */
  expect(f: (share: number) => number, top = this.count): number {
    return this.sum((k) => {
      const p = this.share(k);
      return p * f(p);
    }, top);
  }

  /** Σ h(k) for k = 1…n. The tail uses Σ h(k) ≈ ∫ h(x) dx over [k − ½, k + ½], integrated in log space. */
  private sum(h: (rank: number) => number, upTo: number): number {
    const n = Math.floor(Math.min(upTo, this.count));
    let total = 0;
    const exact = Math.min(n, EXACT_KEYS);
    for (let k = 1; k <= exact; k++) total += h(k);
    if (n <= EXACT_KEYS) return total;

    // ∫ h(x) dx from a to b with x = e^u: ∫ h(e^u)·e^u du, by Simpson's rule.
    const a = Math.log(EXACT_KEYS + 0.5);
    const b = Math.log(n + 0.5);
    const step = (b - a) / TAIL_INTERVALS;
    let integral = 0;
    for (let i = 0; i <= TAIL_INTERVALS; i++) {
      const x = Math.exp(a + i * step);
      const weight = i === 0 || i === TAIL_INTERVALS ? 1 : i % 2 === 1 ? 4 : 2;
      integral += weight * h(x) * x;
    }
    return total + (integral * step) / 3;
  }
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/**
 * Chance that a read of one key finds it in the cache, for a key the cache has room for.
 *
 * Two things must hold. The key must have been read since the cache started empty (`readsSoFar` reads in all, this
 * key getting share p of them), and the fetch that read started must have finished: a fetch takes a while when the
 * database is backed up, and the cache only holds what was read `fillLagReads` reads ago. So it is cached with chance
 * 1 − e^(−p·(readsSoFar − fillLagReads)). And its last fetch must not have expired yet: with reads of the key arriving
 * at rate r = p·readRps and values living L seconds, a fraction r·L / (1 + r·L) of reads land inside a live value.
 * L is the TTL, or shorter when writes delete the key (`keyWriteRps`, see `cachedLifetimeSec`). The smaller of the
 * two is the hit chance: early on the first term limits it (warm-up), later the second.
 */
export function keyHitProbability(
  share: number,
  readsSoFar: number,
  readRps: number,
  ttlSec: number,
  fillLagReads = 0,
  keyWriteRps = 0,
): number {
  const cached = -Math.expm1(-share * Math.max(0, readsSoFar - fillLagReads));
  const live = share * readRps * cachedLifetimeSec(ttlSec, keyWriteRps);
  return Math.min(cached, live / (1 + live));
}

/**
 * How long a cached value lives on average: its TTL, or until the next write deletes it when writes invalidate. With
 * writes to the key at rate w, that's E[min(TTL, Exp(w))] = (1 − e^(−w·TTL)) ÷ w.
 */
export function cachedLifetimeSec(ttlSec: number, keyWriteRps: number): number {
  if (!(keyWriteRps > 0)) return ttlSec;
  return -Math.expm1(-keyWriteRps * ttlSec) / keyWriteRps;
}

export interface CacheConditions {
  keys: ZipfKeys;
  /** How many values fit in memory. The cache keeps the most popular keys. */
  capacityKeys: number;
  /** Reads that have reached the cache since it started empty. */
  readsSoFar: number;
  /** Reads reaching the cache now. */
  readRps: number;
  ttlSec: number;
  /** Reads that arrived while the fetches they started were still in flight (see `keyHitProbability`). Default 0. */
  fillLagReads?: number;
  /** Writes per second that delete their key from the cache (invalidation on write), spread like reads. Default 0. */
  invalidationWriteRps?: number;
}

/** Each key's hit chance under the conditions, by its share of reads. */
export function keyHitFunction(c: CacheConditions, lagged = true): (share: number) => number {
  const lag = lagged ? (c.fillLagReads ?? 0) : 0;
  const writes = c.invalidationWriteRps ?? 0;
  return (p) => keyHitProbability(p, c.readsSoFar, c.readRps, c.ttlSec, lag, p * writes);
}

/** How many values of `valueKb` fit in `memoryGb`. */
export function cacheCapacityKeys(memoryGb: number, valueKb: number): number {
  return Math.floor((memoryGb * 1_000_000) / valueKb);
}

/** Share of reads the cache serves: Σ over the keys it has room for of p × the key's hit chance. */
export function cacheHitRate(c: CacheConditions): number {
  return c.keys.expect(keyHitFunction(c), c.capacityKeys);
}

/**
 * Share of reads that miss only because their key's fetch is still in flight: they would hit if fetches were
 * instant. Without request coalescing each of them reads the database too (the stampede); with it, they wait for the
 * fetch already under way.
 */
export function cacheInFlightRate(c: CacheConditions): number {
  if (!((c.fillLagReads ?? 0) > 0)) return 0;
  const instant = keyHitFunction(c, false);
  const lagged = keyHitFunction(c);
  return c.keys.expect((p) => Math.max(0, instant(p) - lagged(p)), c.capacityKeys);
}

// ---------------------------------------------------------------------------
// Sharding
// ---------------------------------------------------------------------------

/**
 * Each shard's share of the data operations when they are split by `key` over `count` shards.
 *
 * - Sequential keys (timestamps, ever-growing ids) put all new data in the newest range: one shard takes everything.
 * - Hashed keys: the most popular values are placed one by one, by a fixed hash of their popularity rank, so two
 *   popular values can land on the same shard; the long tail spreads evenly.
 *
 * `hotShare` is the share of all operations that one value of this key takes during a hot key event (0 if none). It
 * is the most popular value, so it lands where rank 1 does; everything else shrinks to make room.
 */
export function shardShares(key: ShardKey, count: number, hotShare = 0): number[] {
  const shares = new Array<number>(count).fill(0);
  if (key.spread.kind === 'sequential') {
    shares[count - 1] = 1;
    return shares;
  }
  const keys = new ZipfKeys(key.spread.count, key.spread.zipf);
  const top = Math.min(EXACT_KEYS, keys.count);
  let placed = 0;
  for (let rank = 1; rank <= top; rank++) {
    const share = keys.share(rank);
    shares[shardOf(rank, count)]! += share;
    placed += share;
  }
  const tail = Math.max(0, 1 - placed) / count;
  for (let i = 0; i < count; i++) shares[i] = (shares[i]! + tail) * (1 - hotShare);
  shares[shardOf(1, count)]! += hotShare;
  return shares;
}

/** The shard a value of popularity rank `rank` hashes to: a fixed integer hash (a murmur3 finalizer), mod `count`. */
export function shardOf(rank: number, count: number): number {
  let h = Math.imul(rank ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % count;
}

// ---------------------------------------------------------------------------
// Replication lag
// ---------------------------------------------------------------------------

export interface LagState {
  /** Seconds of writes the replica has fallen behind by being overloaded. Grows without limit while it is. */
  backlogSec: number;
  /** The total lag: the busy lag plus the backlog. */
  lagSec: number;
}

/**
 * Advances a replica's lag by `dtSec` at `utilization` (reads plus replaying writes, against its capacity).
 *
 * - Below full load, lag is base ÷ (1 − utilization): a busy replica takes longer to get to each write, so 50%
 *   busy doubles the base lag and 90% busy multiplies it by ten (capped near full load).
 * - Above full load, the replica can't replay writes as fast as they arrive. It gets 1/utilization of the work
 *   done, so it falls behind by (1 − 1/utilization) seconds every second; once the load drops it catches up at
 *   (1/utilization − 1) seconds per second.
 */
export function stepLag(state: LagState, utilization: number, dtSec: number): void {
  if (utilization > 1) state.backlogSec += (1 - 1 / utilization) * dtSec;
  else if (state.backlogSec > 0) {
    const catchUp = utilization > 0 ? 1 / utilization - 1 : Infinity;
    state.backlogSec = Math.max(0, state.backlogSec - catchUp * dtSec);
  }
  state.lagSec = busyLag(utilization) + state.backlogSec;
}

/** The lag of a replica that is keeping up: base ÷ (1 − utilization), capped near full load. */
export function busyLag(utilization: number): number {
  const u = Math.min(Math.max(0, utilization), REPLICATION.maxLagUtilization);
  return REPLICATION.baseLagSec / (1 - u);
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/**
 * Chance that a read-after-write read misses the reader's own write, when the data it reads is `delaySec` behind
 * the primary. The gap between the write and the read is exponential with mean `meanGapSec`, and reads with a gap
 * under `pinnedSec` never get here (they were sent to the primary), so the gap is `pinnedSec` plus an exponential.
 * The read is stale if the gap is shorter than the delay.
 */
export function readAfterWriteStaleProbability(delaySec: number, meanGapSec: number, pinnedSec = 0): number {
  const exposed = delaySec - pinnedSec;
  return exposed > 0 ? -Math.expm1(-exposed / meanGapSec) : 0;
}

/**
 * Chance that one key changed within the last `windowSec`, when writes spread over keys like reads do and the key
 * gets share p of `writeRps`.
 */
export function keyChangedProbability(share: number, writeRps: number, windowSec: number): number {
  return windowSec > 0 ? -Math.expm1(-share * writeRps * windowSec) : 0;
}

/**
 * Ages at which cached values are sampled when averaging over them: a hit finds a value fetched uniformly at random
 * within the last TTL. Midpoints of equal slices of [0, TTL).
 */
export function cacheAges(ttlSec: number, slices = 8): number[] {
  return Array.from({ length: slices }, (_, i) => ((i + 0.5) * ttlSec) / slices);
}
