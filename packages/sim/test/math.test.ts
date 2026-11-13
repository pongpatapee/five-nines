import { describe, expect, it } from 'vitest';
import { createRng, erlangB, interpolate, queueDelay, sampleTruncatedExponential, WeightedSamples } from '../src/math.ts';

describe('erlangB', () => {
  it('matches textbook values', () => {
    expect(erlangB(0, 3)).toBe(1);
    expect(erlangB(1, 1)).toBeCloseTo(0.5, 12);
    expect(erlangB(2, 1)).toBeCloseTo(0.2, 12);
  });
});

describe('queueDelay (M/M/c with a timeout)', () => {
  // 8 workers at 100 req/s each: 800 req/s capacity, 1 s timeout.
  const at = (utilization: number, timeoutSec = 1) => queueDelay(8, 800 * utilization, 100, timeoutSec);

  it('matches Erlang C when the timeout is long, below capacity', () => {
    // M/M/1: the chance of waiting equals utilization. M/M/2 at 1 erlang: 1/3.
    expect(queueDelay(1, 50, 100, 1e6).waitProbability).toBeCloseTo(0.5, 9);
    expect(queueDelay(1, 90, 100, 1e6).waitProbability).toBeCloseTo(0.9, 9);
    expect(queueDelay(2, 100, 100, 1e6).waitProbability).toBeCloseTo(1 / 3, 9);
  });

  it('conserves work: what is served equals what the busy servers get done', () => {
    // M/M/1: the server is busy exactly when an arrival would wait, so λ·(1 − late) = μ·P(wait).
    for (const [rps, timeoutSec] of [[50, 0.02], [90, 0.1], [100, 0.5]] as const) {
      const delay = queueDelay(1, rps, 100, timeoutSec);
      expect(rps * (1 - delay.lateProbability)).toBeCloseTo(100 * delay.waitProbability, 9);
    }
  });

  it('is 0 with no load', () => {
    expect(queueDelay(4, 0, 100, 1)).toEqual({ waitProbability: 0, lateProbability: 0, decayRate: 400 });
  });

  it('stays finite at full load, where waits are uniform over the timeout', () => {
    const full = at(1);
    expect(full.decayRate).toBe(0);
    expect(full.waitProbability).toBeGreaterThan(0.99);
    expect(full.waitProbability).toBeLessThan(1);
    // Roughly one request per λ·T times out: the queue holds about a timeout's worth of work.
    expect(full.lateProbability).toBeGreaterThan(0.0005);
    expect(full.lateProbability).toBeLessThan(0.005);
  });

  it('is continuous and increasing as utilization approaches 100%', () => {
    const full = at(1);
    for (const gap of [1e-3, 1e-6, 1e-9]) {
      const near = at(1 - gap);
      expect(near.waitProbability).toBeLessThan(full.waitProbability);
      expect(near.lateProbability).toBeLessThan(full.lateProbability);
    }
    expect(at(1 - 1e-9).lateProbability).toBeCloseTo(full.lateProbability, 6);
    expect(at(1 - 1e-9).waitProbability).toBeCloseTo(full.waitProbability, 6);
    const curve = [0.5, 0.7, 0.9, 0.95, 0.99, 0.999, 1].map((u) => at(u).lateProbability);
    expect(curve).toEqual([...curve].sort((a, b) => a - b));
  });

  it('times out more requests with a shorter timeout', () => {
    expect(at(1, 0.1).lateProbability).toBeGreaterThan(at(1, 1).lateProbability);
  });
});

describe('sampleTruncatedExponential', () => {
  it('stays within the range and is uniform at rate 0', () => {
    const rng = createRng(3);
    const samples = Array.from({ length: 20_000 }, () => sampleTruncatedExponential(rng, 0, 2));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(2);
    expect(samples.reduce((a, b) => a + b, 0) / samples.length).toBeCloseTo(1, 1);
  });

  it('approaches the uniform as the rate goes to 0, and the exponential for a high rate', () => {
    const mean = (rate: number) => {
      const rng = createRng(4);
      return Array.from({ length: 20_000 }, () => sampleTruncatedExponential(rng, rate, 1)).reduce((a, b) => a + b, 0) / 20_000;
    };
    expect(mean(1e-12)).toBeCloseTo(mean(0), 9);
    expect(mean(100)).toBeCloseTo(0.01, 2);
  });
});

describe('createRng', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it('stays in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('interpolate', () => {
  const points = [
    { atSec: 10, rps: 100 },
    { atSec: 20, rps: 300 },
  ];

  it('interpolates linearly and clamps at both ends', () => {
    expect(interpolate(points, 0)).toBe(100);
    expect(interpolate(points, 15)).toBe(200);
    expect(interpolate(points, 99)).toBe(300);
  });
});

describe('WeightedSamples', () => {
  it('respects weights when computing quantiles', () => {
    const samples = new WeightedSamples();
    samples.add(10, 98);
    samples.add(1000, 2);
    expect(samples.quantile(0.5)).toBe(10);
    expect(samples.quantile(0.99)).toBe(1000);
  });

  it('returns null when empty', () => {
    expect(new WeightedSamples().quantile(0.99)).toBeNull();
  });
});
