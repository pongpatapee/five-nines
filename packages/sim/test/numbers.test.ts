/**
 * "The numbers" box: read from each level's data, with everything the level's math needs and nothing it doesn't.
 */
import { describe, expect, it } from 'vitest';
import { AVAILABILITY_TIERS } from '../src/catalog.ts';
import { getLevel, LEVELS } from '../src/levels/index.ts';
import { levelNumbers, popularity, trafficShape } from '../src/numbers.ts';

const CASES = LEVELS.map((level) => [level.id, level] as const);

describe('the numbers box', () => {
  it.each(CASES)('%s has the traffic, CPU per request, timeout, requirements and budget', (_, level) => {
    const numbers = levelNumbers(level);
    expect(numbers.cpuMsPerRequest).toBe(level.workload.cpuMsPerRequest);
    expect(numbers.timeoutMs).toBe(level.workload.timeoutMs);
    expect(numbers.traffic.startRps).toBe(level.workload.traffic[0]!.rps);
    const peak = Math.max(numbers.traffic.sustainedRps, ...numbers.traffic.spikes.map((spike) => spike.rps));
    expect(peak).toBe(Math.max(...level.workload.traffic.map((point) => point.rps)));
    expect(numbers.requirements).toMatchObject({
      availability: AVAILABILITY_TIERS.pass,
      p99Ms: level.requirements.p99Ms,
      budgetUsdPerMonth: level.requirements.budgetUsdPerMonth,
      maxStalenessSec: level.requirements.maxStalenessSec ?? null,
      processWithinSec: level.requirements.processWithinSec ?? null,
    });
  });

  it.each(CASES)('%s has its data and payments numbers exactly where the level uses them', (_, level) => {
    const numbers = levelNumbers(level);
    const data = level.workload.data;
    expect(numbers.data === null).toBe(data === undefined);
    expect(numbers.payments).toEqual(level.workload.payments ?? null);
    if (!data || !numbers.data) return;
    expect(numbers.data.readShare).toBe(data.readShare);
    expect(numbers.data.readAfterWrite).toEqual(data.readAfterWrite ?? null);
    const cache = level.components.includes('cache');
    expect(numbers.data.keys !== null).toBe(cache);
    expect(numbers.data.itemKb).toBe(cache ? data.keys.valueKb : null);
    expect(numbers.data.shardKeys !== null).toBe(level.components.includes('shards'));
    if (cache) expect(data.keys.label, 'a cache level names its keys').toBeDefined();
  });

  it('reads spikes off the traffic chart, and the rate the traffic settles at', () => {
    expect(levelNumbers(getLevel('04-read-all-about-it')!).traffic).toEqual({
      startRps: 6_000,
      sustainedRps: 20_000,
      spikes: [{ rps: 26_000, durationSec: 25 }],
    });
    expect(levelNumbers(getLevel('10-flash-sale')!).traffic).toEqual({
      startRps: 1_000,
      sustainedRps: 1_000,
      spikes: [{ rps: 10_000, durationSec: 30 }],
    });
    expect(trafficShape([{ atSec: 0, rps: 5 }])).toEqual({ startRps: 5, sustainedRps: 5, spikes: [] });
    // A climb that ends at the top isn't a spike.
    expect(trafficShape([{ atSec: 0, rps: 1 }, { atSec: 9, rps: 7 }]).spikes).toEqual([]);
  });

  it('names what happens during the run, without saying when', () => {
    const surprises = LEVELS.map((level) => levelNumbers(level).surprises.map((surprise) => surprise.kind));
    expect(surprises).toEqual([[], [], ['crash'], [], [], [], ['hotKey'], ['cacheRestart'], [], ['rateLimit']]);
    for (const level of LEVELS) {
      for (const surprise of levelNumbers(level).surprises) expect(surprise).not.toHaveProperty('atSec');
    }
  });

  it('says how popular the keys are in three plain steps', () => {
    expect(popularity(0)).toBe('uniform');
    expect(popularity(0.6)).toBe('mild');
    expect(popularity(1)).toBe('skewed');
    expect(levelNumbers(getLevel('05-cache-miss')!).data!.keys).toEqual({ count: 100_000_000, label: 'profiles', popularity: 'uniform' });
  });
});
