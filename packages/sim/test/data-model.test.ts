import { describe, expect, it } from 'vitest';
import { REPLICATION } from '../src/catalog.ts';
import {
  busyLag,
  cacheCapacityKeys,
  cacheHitRate,
  keyChangedProbability,
  keyHitProbability,
  readAfterWriteStaleProbability,
  stepLag,
  ZipfKeys,
  type LagState,
} from '../src/data-model.ts';

/** Σ over every key, the slow way. */
function bruteForce(count: number, exponent: number, f: (share: number) => number, top = count): number {
  let norm = 0;
  for (let k = 1; k <= count; k++) norm += k ** -exponent;
  let total = 0;
  for (let k = 1; k <= top; k++) {
    const p = k ** -exponent / norm;
    total += p * f(p);
  }
  return total;
}

describe('ZipfKeys', () => {
  it.each([
    [200_000, 1],
    [200_000, 0.8],
    [50_000, 1.3],
  ])('matches a brute-force sum over %i keys with exponent %d', (count, exponent) => {
    const keys = new ZipfKeys(count, exponent);
    for (const top of [10, 1_000, 30_000, count]) {
      expect(keys.topShare(top)).toBeCloseTo(bruteForce(count, exponent, () => 1, top), 5);
    }
    const reads = 50_000;
    const seen = (p: number) => -Math.expm1(-p * reads);
    expect(keys.expect(seen, 20_000) / bruteForce(count, exponent, seen, 20_000)).toBeCloseTo(1, 4);
  });

  it('gives every key the same share when uniform', () => {
    const keys = new ZipfKeys(1e9, 0);
    expect(keys.share(1)).toBeCloseTo(1e-9, 15);
    expect(keys.topShare(4e7)).toBeCloseTo(0.04, 7);
  });

  it('concentrates traffic in the top keys as skew grows', () => {
    const top = (exponent: number) => new ZipfKeys(1e6, exponent).topShare(1_000);
    expect(top(0)).toBeCloseTo(0.001, 9);
    expect(top(1)).toBeGreaterThan(0.5);
    expect(top(1.2)).toBeGreaterThan(top(1));
  });
});

describe('cache hit rate', () => {
  const keys = new ZipfKeys(2e6, 1);
  const warm = { keys, readsSoFar: 1e15, readRps: 20_000, ttlSec: 1e9 };

  it('is the top-C share for a warm cache with no expiry', () => {
    expect(cacheHitRate({ ...warm, capacityKeys: 80_000 })).toBeCloseTo(keys.topShare(80_000), 6);
  });

  it('grows with memory', () => {
    const at = (capacityKeys: number) => cacheHitRate({ ...warm, capacityKeys });
    expect(at(80_000)).toBeGreaterThan(at(20_000));
    expect(at(2e6)).toBeCloseTo(1, 6);
  });

  it('starts cold and warms up as keys are read', () => {
    const at = (readsSoFar: number) => cacheHitRate({ ...warm, capacityKeys: 80_000, readsSoFar });
    expect(at(0)).toBe(0);
    expect(at(20_000)).toBeGreaterThan(0.3);
    expect(at(20_000 * 60)).toBeGreaterThan(at(20_000));
    expect(at(20_000 * 60)).toBeLessThan(at(1e15));
  });

  it('loses keys that expire before they are read again', () => {
    const at = (ttlSec: number) => cacheHitRate({ ...warm, capacityKeys: 80_000, ttlSec });
    expect(at(10)).toBeLessThan(at(300));
    expect(at(300)).toBeLessThan(at(1e9));
  });

  it('hits a key read r times a second with TTL T a share rT / (1 + rT) of the time', () => {
    // r·T = 0.01 × 100 = 1: half the reads find a live value.
    expect(keyHitProbability(0.01, 1e12, 1, 100)).toBeCloseTo(0.5, 9);
  });

  it('fits memory ÷ value size keys', () => {
    expect(cacheCapacityKeys(8, 100)).toBe(80_000);
  });
});

describe('replication lag', () => {
  const lagAfter = (utilization: number, seconds: number, start: LagState = { backlogSec: 0, lagSec: 0 }) => {
    const state = { ...start };
    for (let t = 0; t < seconds * 10; t++) stepLag(state, utilization, 0.1);
    return state;
  };

  it('is base ÷ (1 − utilization) while the replica keeps up', () => {
    expect(busyLag(0)).toBeCloseTo(REPLICATION.baseLagSec, 12);
    expect(busyLag(0.5)).toBeCloseTo(REPLICATION.baseLagSec * 2, 12);
    expect(busyLag(0.9)).toBeCloseTo(REPLICATION.baseLagSec * 10, 9);
    expect(lagAfter(0.5, 30).lagSec).toBeCloseTo(REPLICATION.baseLagSec * 2, 12);
  });

  it('caps the busy lag near full load', () => {
    expect(busyLag(0.999)).toBeCloseTo(busyLag(REPLICATION.maxLagUtilization), 12);
  });

  it('grows without limit while overloaded, then catches up', () => {
    // At 125% the replica replays 80% of the writes: 0.2 s further behind every second.
    const behind = lagAfter(1.25, 20);
    expect(behind.backlogSec).toBeCloseTo(4, 6);
    expect(behind.lagSec).toBeCloseTo(busyLag(1) + 4, 6);
    // At 50% it replays twice as fast as writes arrive: 1 s caught up per second.
    const recovering = lagAfter(0.5, 2, behind);
    expect(recovering.backlogSec).toBeCloseTo(2, 6);
    expect(lagAfter(0.5, 10, behind).backlogSec).toBe(0);
  });
});

describe('staleness', () => {
  it('misses a write when the gap since it is shorter than the delay', () => {
    // Gap ~ Exp(mean 1.5 s), delay 0.5 s: P(gap < 0.5) = 1 − e^(−1/3).
    expect(readAfterWriteStaleProbability(0.5, 1.5)).toBeCloseTo(1 - Math.exp(-1 / 3), 12);
    expect(readAfterWriteStaleProbability(0, 1.5)).toBe(0);
  });

  it('never misses when pinning covers the delay, and counts only the uncovered part otherwise', () => {
    expect(readAfterWriteStaleProbability(1.8, 1.5, 5)).toBe(0);
    // Pinned reads have gap < 1; the rest have gap = 1 + Exp(1.5), stale if that is under 1.8.
    expect(readAfterWriteStaleProbability(1.8, 1.5, 1)).toBeCloseTo(1 - Math.exp(-0.8 / 1.5), 12);
  });

  it('counts a key as changed when a write landed within the window', () => {
    expect(keyChangedProbability(0.001, 1000, 1)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(keyChangedProbability(0.001, 1000, -1)).toBe(0);
  });
});
