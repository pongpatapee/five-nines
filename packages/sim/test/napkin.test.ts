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
    expect(herd.steps[0]).toMatchObject({ kind: 'trafficAtEvent', atSec: 90, result: 30_000 });
    expect(herd.steps.find((step) => step.kind === 'totalWork')).toMatchObject({ writeWork: 750, result: 30_450 });
    const sale = napkinSolution(level('10-flash-sale'))!;
    expect(sale.steps.map((step) => step.result)).toEqual([10_000, 300_000, 150, 2_000]);
    expect(sale.takeaway).toMatchObject({ normalRps: 1_000 });
  });
});
