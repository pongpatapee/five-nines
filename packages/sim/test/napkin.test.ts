import { describe, expect, it } from 'vitest';
import { napkinSolution } from '../src/estimate.ts';
import { getLevel, LEVELS } from '../src/levels/index.ts';
import type { Level } from '../src/schema.ts';

const level = (id: string): Level => getLevel(id)!;

describe('the worked napkin solution', () => {
  it.each(LEVELS.map((lvl) => [lvl.id, lvl] as const))('%s works step by step to its recorded answer', (_, lvl) => {
    const solution = napkinSolution(lvl)!;
    expect(solution.steps.length).toBeGreaterThanOrEqual(2);
    expect(solution.steps.at(-1)!.result).toBeCloseTo(lvl.estimate!.answer, 1);
    expect(solution.steps.at(-1)!.result).toBe(solution.working.result);
    for (const step of solution.steps) expect(Number.isFinite(step.result), step.kind).toBe(true);
  });

  it('works level 4 the way a player would on paper', () => {
    const { steps, takeaway } = napkinSolution(level('04-read-all-about-it'))!;
    expect(steps.map((step) => step.kind)).toEqual([
      'peak',
      'splitTraffic',
      'writeCost',
      'writesFirst',
      'databaseShare',
      'cacheHitRate',
    ]);
    expect(steps[0]).toMatchObject({ atSec: 125, result: 26_000 });
    expect(steps[1]).toMatchObject({ readShare: 0.95, writes: 1_300, result: 24_700 });
    expect(steps[2]).toMatchObject({ databaseReadsPerSec: 10_000, databaseWritesPerSec: 4_000, result: 2.5 });
    expect(steps[3]).toMatchObject({ writeWork: 3_250, result: 6_750 });
    expect(steps[4]!.result).toBeCloseTo(0.273, 3);
    expect(steps[5]!.result).toBeCloseTo(72.7, 1);
    // Exactly full at 72.7%; the hot line and the comfortable one need more.
    expect(takeaway).toMatchObject({ kind: 'hitRateHeadroom' });
    if (takeaway.kind !== 'hitRateHeadroom') throw new Error('unexpected takeaway');
    expect(takeaway.atHot).toBeCloseTo(78.7, 1);
    expect(takeaway.atComfortable).toBeCloseTo(84.8, 1);
  });

  it('adds headroom in whole machines', () => {
    expect(napkinSolution(level('01-hello-traffic'))!.takeaway).toMatchObject({ atComfortable: 5 });
    expect(napkinSolution(level('03-pull-the-plug'))!.takeaway).toMatchObject({ servers: 5 });
    expect(napkinSolution(level('07-the-write-wall'))!.takeaway).toMatchObject({
      roundedUp: 4,
      roundedUpUtilization: 0.9375,
      shards: 5,
      utilization: 0.75,
    });
  });

  it('works the cold cache at the moment it restarts, and the queue over its deadline', () => {
    const herd = napkinSolution(level('08-thundering-herd'))!;
    expect(herd.steps.map((step) => step.kind)).toEqual(['trafficAtEvent', 'splitTraffic', 'timesCapacity']);
    expect(herd.steps[0]).toMatchObject({ atSec: 90, result: 30_000 });
    expect(herd.steps[1]).toMatchObject({ result: 29_700, writes: 300 });
    expect(herd.steps[2]).toMatchObject({ databaseReadsPerSec: 10_000, result: 2.97 });
    expect(herd.takeaway).toEqual({ kind: 'stampede', times: 2.97 });
    const sale = napkinSolution(level('10-flash-sale'))!;
    expect(sale.steps.map((step) => step.result)).toEqual([10_000, 300_000, 150, 2_000]);
    expect(sale.takeaway).toMatchObject({ normalRps: 1_000 });
  });

  it('works the gap between reads of one profile, against the longest cache expiry (level 5)', () => {
    const { steps, takeaway } = napkinSolution(level('05-cache-miss'))!;
    expect(steps.map((step) => step.kind)).toEqual(['peak', 'splitTraffic', 'keyReadGap']);
    expect(steps[1]).toMatchObject({ result: 19_200 });
    expect(steps[2]).toMatchObject({ keys: 100_000_000, keyLabel: 'profiles', reads: 19_200 });
    expect(steps[2]!.result).toBeCloseTo(5_208.3, 1);
    if (takeaway.kind !== 'cacheExpiry') throw new Error('unexpected takeaway');
    expect(takeaway.longestTtlSec).toBe(3_600);
    expect(takeaway.gapSec).toBeGreaterThan(takeaway.longestTtlSec);
    // Even the biggest cache with the longest expiry catches almost nothing: about 2%.
    expect(takeaway.hitRate).toBeGreaterThan(0.005);
    expect(takeaway.hitRate).toBeLessThan(0.03);
  });

  it('works how busy the primary is with the pinned reads and the writes (level 6)', () => {
    const { steps, takeaway } = napkinSolution(level('06-bank-balance'))!;
    expect(steps.map((step) => step.kind)).toEqual(['peak', 'splitTraffic', 'ownWriteReads', 'totalWork', 'databaseBusy']);
    expect(steps[2]).toMatchObject({ result: 3_800 });
    expect(steps[3]).toMatchObject({ reads: 3_800, writes: 1_000, writeCost: 2.5, writeWork: 2_500, result: 6_300 });
    expect(steps[4]).toMatchObject({ result: 63 });
    expect(takeaway).toEqual({ kind: 'primaryHeadroom', size: 'large', utilization: 0.63, smaller: { size: 'medium', utilization: 1.26 } });
  });

  it("says a TTL short enough for fresh prices can't reach the hit rate (level 9)", () => {
    const { takeaway } = napkinSolution(level('09-stale-prices'))!;
    if (takeaway.kind !== 'ttlCeiling') throw new Error('unexpected takeaway');
    expect(takeaway.ttlSec).toBe(5);
    expect(takeaway.needed).toBeCloseTo(79.6, 1);
    expect(takeaway.hitRate).toBeLessThan(takeaway.needed);
    expect(takeaway.hitRate).toBeCloseTo(67, 0);
  });
});

/**
 * Every number a step uses is a given (in front of the player when asked), a constant of arithmetic, an earlier step's
 * result, or worked out from those in one operation (a percent counting as its fraction). So the givens list can't miss a number the working leans on.
 */
describe('the numbers the napkin working uses', () => {
  const CONSTANTS = [0, 1, 100, 1000];
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const derivable = (value: number, known: readonly number[]): boolean =>
    // A percent is the same number as a fraction.
    [value, value / 100].some((v) => oneStep(v, known));
  const oneStep = (value: number, known: readonly number[]) =>
    known.some((k) => close(k, value) || close(Math.ceil(k - 1e-9), value)) ||
    known.some((a) =>
      known.some((b) => close(a + b, value) || close(a - b, value) || close(a * b, value) || (b !== 0 && close(a / b, value))),
    );

  it.each(LEVELS.map((lvl) => [lvl.id, lvl] as const))('%s starts only from its givens', (_, lvl) => {
    const solution = napkinSolution(lvl)!;
    const known = [...CONSTANTS, ...solution.givens.map((given) => given.value)];
    for (const step of solution.steps) {
      // A step's numbers may lean on each other in any order, so resolve them until nothing more can be.
      let open = Object.entries(step).filter(
        // The peak step's time is a note on where to read the chart, not a number the arithmetic uses.
        ([field, value]) => typeof value === 'number' && !(step.kind === 'peak' && field === 'atSec'),
      ) as [string, number][];
      for (let progress = true; progress && open.length > 0; ) {
        const resolved = open.filter(([, value]) => derivable(value, known));
        known.push(...resolved.map(([, value]) => value));
        progress = resolved.length > 0;
        open = open.filter((entry) => !resolved.includes(entry));
      }
      expect(open.map(([field, value]) => `${step.kind}.${field} = ${value}`)).toEqual([]);
    }
  });
});
