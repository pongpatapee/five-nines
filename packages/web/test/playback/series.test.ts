import type { TimelineFrame } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import {
  availabilityUpTo,
  budgetUsage,
  failedUpTo,
  locate,
  offeredUpTo,
  prepareSeries,
  sampleFrame,
} from '../../src/playback/series.ts';
import { graded, LEVEL3_NO_RETRIES, syntheticSimulation } from './fixtures.ts';

describe('locate', () => {
  it('splits a playhead into the second it is in and the fraction through it', () => {
    expect(locate(10, 3.25)).toEqual({ index: 3, fraction: 0.25 });
    expect(locate(10, -1)).toEqual({ index: 0, fraction: 0 });
    expect(locate(10, 10)).toEqual({ index: 9, fraction: 1 });
    expect(locate(10, 99)).toEqual({ index: 9, fraction: 1 });
  });
});

describe('cumulative totals', () => {
  // 1000 req/s for 4 s; 0, 2, 4, 0 failures.
  const series = prepareSeries(syntheticSimulation([1000, 1000, 1000, 1000], [0, 2, 4, 0]), null);

  it('grows linearly within a second, since frame values are totals over the second', () => {
    expect(failedUpTo(series, 0)).toBe(0);
    expect(failedUpTo(series, 1)).toBe(0);
    expect(failedUpTo(series, 1.5)).toBe(1);
    expect(failedUpTo(series, 2)).toBe(2);
    expect(failedUpTo(series, 2.25)).toBe(3);
    expect(failedUpTo(series, 4)).toBe(6);
    expect(offeredUpTo(series, 2.5)).toBe(2500);
  });

  it('computes availability so far, 1 before any traffic', () => {
    expect(availabilityUpTo(series, 0)).toBe(1);
    expect(availabilityUpTo(series, 4)).toBeCloseTo(1 - 6 / 4000);
  });

  it('sets the budget to 0.1% of all requests and reports usage', () => {
    expect(series.errorBudget).toBeCloseTo(4);
    const usage = budgetUsage(series, 2);
    expect(usage.used).toBe(2);
    expect(usage.fraction).toBeCloseTo(0.5);
    expect(usage.exhausted).toBe(false);
  });
});

describe('exhaustion instant', () => {
  it('lands inside the engine second where cumulative failures reach the budget', () => {
    // Budget 4: cumulative is 2 after second 1, and reaches 4 halfway through second 2 (4 failures in it).
    const series = prepareSeries(syntheticSimulation([1000, 1000, 1000, 1000], [0, 2, 4, 0]), 2);
    expect(series.exhaustedAt).toBeCloseTo(2.5);
    expect(budgetUsage(series, 2.49).exhausted).toBe(false);
    expect(budgetUsage(series, series.exhaustedAt!).exhausted).toBe(true);
    expect(budgetUsage(series, series.exhaustedAt!).fraction).toBeCloseTo(1);
  });

  it('is null when the budget holds', () => {
    expect(prepareSeries(syntheticSimulation([1000], [0]), null).exhaustedAt).toBeNull();
  });

  it('matches the engine on a real failing run (level 3, no retries)', () => {
    const evaluation = graded('03-pull-the-plug', LEVEL3_NO_RETRIES);
    const at = evaluation.errorBudgetExhaustedAtSec!;
    expect(at).toBeGreaterThanOrEqual(61);
    expect(at).toBeLessThanOrEqual(70);
    const series = prepareSeries(evaluation.simulation, at);
    expect(series.exhaustedAt).toBeGreaterThanOrEqual(at);
    expect(series.exhaustedAt).toBeLessThanOrEqual(at + 1);
    expect(failedUpTo(series, series.exhaustedAt!)).toBeCloseTo(series.errorBudget, 6);
    // The engine's total and the timeline's totals agree.
    expect(offeredUpTo(series, series.durationSec)).toBeCloseTo(evaluation.simulation.totalRequests, 3);
  });
});

describe('sampleFrame', () => {
  const timeline = syntheticSimulation([100, 300, 300], [0, 10, 0]).timeline;

  it('returns null for an empty timeline', () => {
    expect(sampleFrame([], 1)).toBeNull();
  });

  it('places each frame at the middle of its second and blends linearly between them', () => {
    expect(sampleFrame(timeline, 0.5)!.offeredRps).toBe(100);
    expect(sampleFrame(timeline, 1)!.offeredRps).toBe(200);
    expect(sampleFrame(timeline, 1.5)!.offeredRps).toBe(300);
    expect(sampleFrame(timeline, 1.25)!.nodes.app!.failedRps).toBeCloseTo(7.5);
  });

  it('holds the end values outside the frame centres', () => {
    expect(sampleFrame(timeline, 0)!.offeredRps).toBe(100);
    expect(sampleFrame(timeline, 3)!.offeredRps).toBe(300);
    expect(sampleFrame(timeline, 3)!.atSec).toBe(3);
  });

  it('takes discrete state from the current second rather than blending it', () => {
    const crash = syntheticSimulation([100, 100], [0, 0]).timeline;
    crash[1]!.nodes.app!.instances[0]!.up = false;
    expect(sampleFrame(crash, 0.9)!.nodes.app!.instances[0]!.up).toBe(true);
    expect(sampleFrame(crash, 1.1)!.nodes.app!.instances[0]!.up).toBe(false);
  });
});

describe('sampleFrame: data tier', () => {
  const frame = (atSec: number, value: number): TimelineFrame => ({
    atSec,
    offeredRps: 1000,
    failedRps: 0,
    p99Ms: 5,
    nodes: {
      cache: { arrivalRps: 900, failedRps: 0, instances: [], hitRate: value },
      replicas: { arrivalRps: 100, failedRps: 0, instances: [], replicationLagSec: value * 10, readRps: 100, writeRps: 10 },
    },
    edges: { 'db->replicas': { rps: value * 100, writeRps: value * 100 } },
  });

  it('blends hit rate, lag and edge flows between seconds', () => {
    const live = sampleFrame([frame(0, 0.2), frame(1, 0.6)], 1)!;
    expect(live.nodes['cache']!.hitRate).toBeCloseTo(0.4, 12);
    expect(live.nodes['replicas']!.replicationLagSec).toBeCloseTo(4, 12);
    expect(live.nodes['replicas']!.readRps).toBe(100);
    expect(live.edges['db->replicas']).toEqual({ rps: expect.closeTo(40, 12), writeRps: expect.closeTo(40, 12) });
    expect(live.nodes['cache']!.replicationLagSec).toBeUndefined();
  });
});

