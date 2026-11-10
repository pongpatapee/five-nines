import { describe, expect, it } from 'vitest';
import { createRng, erlangC, interpolate, WeightedSamples } from '../src/math.ts';

describe('erlangC', () => {
  it('matches M/M/1, where the chance of waiting equals utilization', () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 12);
    expect(erlangC(1, 0.9)).toBeCloseTo(0.9, 12);
  });

  it('matches the textbook value for two servers', () => {
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 12);
  });

  it('is 0 with no load and 1 at or above capacity', () => {
    expect(erlangC(4, 0)).toBe(0);
    expect(erlangC(4, 4)).toBe(1);
    expect(erlangC(4, 5)).toBe(1);
  });

  it('makes waiting rarer as servers are added at the same utilization', () => {
    expect(erlangC(16, 12)).toBeLessThan(erlangC(4, 3));
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
