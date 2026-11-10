/**
 * The maths of the data tier: how reads spread over keys, what a cache of a given size hits, how far behind a
 * replica falls, and how often a read sees out-of-date data. Pure functions, so each can be tested on its own.
 *
 * Every result is an exact expected fraction rather than a sample, like the rest of the engine's failure
 * accounting.
 */
import { REPLICATION } from './catalog.ts';

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
 * key getting share p of them): 1 − e^(−p·readsSoFar). And its last fetch must not have expired yet: with reads of
 * the key arriving at rate r = p·readRps and values living `ttlSec`, a fraction r·T / (1 + r·T) of reads land
 * inside a live value. The smaller of the two is the hit chance: early on the first term limits it (warm-up),
 * later the second.
 */
export function keyHitProbability(share: number, readsSoFar: number, readRps: number, ttlSec: number): number {
  const seen = -Math.expm1(-share * readsSoFar);
  const live = share * readRps * ttlSec;
  return Math.min(seen, live / (1 + live));
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
}

/** How many values of `valueKb` fit in `memoryGb`. */
export function cacheCapacityKeys(memoryGb: number, valueKb: number): number {
  return Math.floor((memoryGb * 1_000_000) / valueKb);
}

/** Share of reads the cache serves: Σ over the keys it has room for of p × the key's hit chance. */
export function cacheHitRate(c: CacheConditions): number {
  return c.keys.expect((p) => keyHitProbability(p, c.readsSoFar, c.readRps, c.ttlSec), c.capacityKeys);
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
