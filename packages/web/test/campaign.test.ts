import { LEVELS } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import {
  campaignProgress,
  FUTURE_CHAPTERS,
  LEVEL_SLOTS,
  LOCKED_CHAPTER_LAYOUT,
  nextUpIndex,
  ninesForGrade,
  TRAIL_SEGMENTS,
} from '../src/screens/campaign.ts';

const ids = ['a', 'b', 'c'];

describe('campaign map', () => {
  it('counts one nine per tier reached', () => {
    expect([undefined, 'fail', 'pass', 'star', 'mastered'].map((g) => ninesForGrade(g as never))).toEqual([0, 0, 1, 2, 3]);
  });

  it('totals nines across levels', () => {
    expect(campaignProgress(ids, {})).toEqual({ earned: 0, total: 9 });
    expect(campaignProgress(ids, { a: 'mastered', b: 'star', c: 'fail' })).toEqual({ earned: 5, total: 9 });
  });

  it('points at the first page not yet passed, or none when all pass', () => {
    expect(nextUpIndex(ids, {})).toBe(0);
    expect(nextUpIndex(ids, { a: 'pass', b: 'fail' })).toBe(1);
    expect(nextUpIndex(ids, { a: 'pass', c: 'star' })).toBe(1);
    expect(nextUpIndex(ids, { a: 'pass', b: 'star', c: 'mastered' })).toBeNull();
  });

  it('has a slot and a trail segment for every real level', () => {
    expect(LEVEL_SLOTS.length).toBeGreaterThanOrEqual(LEVELS.length);
    expect(TRAIL_SEGMENTS.length).toBeGreaterThanOrEqual(LEVELS.length);
    expect(LOCKED_CHAPTER_LAYOUT).toHaveLength(FUTURE_CHAPTERS.length);
  });
});
