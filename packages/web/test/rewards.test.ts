/** The results payout reveal, the playback juice, the savings and lock situations, and their notebook copy. */
import { CHAPTERS, LEVELS, type SimEvent } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { strikesPlayed } from '../src/playback/juice.ts';
import { BADGE_IDS, type RunReward } from '../src/progression/index.ts';
import { REVEAL_TIMING, revealAt, revealBeats } from '../src/results/reveal.ts';
import { cast, theme } from '../src/theme/index.ts';
import { lockSituation, savingsSituation } from '../src/theme/situations.ts';

const reward: RunReward = {
  levelId: 'x',
  levelNines: { before: 3, after: 5 },
  totalNines: { before: 10, after: 12, total: 50 },
  newBadges: ['rightSized', 'pennyPincher'],
  openedChapterIds: [],
  capped: false,
};

describe('payout reveal', () => {
  it('stamps the grade, chimes a win, ticks each nine, then stamps each badge', () => {
    const beats = revealBeats(reward, true, false);
    expect(beats.map((beat) => beat.kind)).toEqual(['grade', 'win', 'nine', 'nine', 'badge', 'badge']);
    const times = beats.map((beat) => beat.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(beats[2]).toEqual({ kind: 'nine', atMs: REVEAL_TIMING.ninesStartMs, total: 11 });
    expect(revealBeats(reward, false, false).some((beat) => beat.kind === 'win')).toBe(false);
  });

  it('shows the counter and the level filling in step', () => {
    const beats = revealBeats(reward, true, false);
    expect(revealAt(reward, beats, -1)).toEqual({ total: 10, level: 3, badges: [], done: false });
    expect(revealAt(reward, beats, REVEAL_TIMING.ninesStartMs)).toMatchObject({ total: 11, level: 4, badges: [] });
    const end = revealAt(reward, beats, Infinity);
    expect(end).toEqual({ total: 12, level: 5, badges: ['rightSized', 'pennyPincher'], done: true });
  });

  it('happens all at once with reduced motion', () => {
    const beats = revealBeats(reward, true, true);
    expect(beats.every((beat) => beat.atMs === 0)).toBe(true);
    expect(revealAt(reward, beats, 0).done).toBe(true);
  });

  it('pays nothing visible when nothing was earned', () => {
    const nothing = { ...reward, levelNines: { before: 5, after: 5 }, totalNines: { before: 12, after: 12, total: 50 }, newBadges: [] };
    const beats = revealBeats(nothing, true, false);
    expect(beats.map((beat) => beat.kind)).toEqual(['grade', 'win']);
    expect(revealAt(nothing, beats, Infinity)).toEqual({ total: 12, level: 5, badges: [], done: true });
  });
});

describe('playback juice', () => {
  const crash: SimEvent = { atSec: 61, kind: 'instanceFailed', nodeId: 'app', instance: 0, message: '' };
  const restart: SimEvent = { atSec: 90, kind: 'cacheRestarted', nodeId: 'cache', message: '' };
  const hot: SimEvent = { atSec: 100, kind: 'hotKeyStarted', nodeId: 's', shardKey: 'k', label: 'a post', message: '' };
  const rotation: SimEvent = { ...crash, atSec: 62, kind: 'removedFromRotation', balancerId: 'lb' };
  const events = [crash, rotation, restart, hot];

  it('buzzes for every strike played through, and shakes for broken machines', () => {
    expect(strikesPlayed(events, 60.9, 61.2)).toEqual([{ event: crash, shake: true }]);
    expect(strikesPlayed(events, 89.5, 90)).toEqual([{ event: restart, shake: true }]);
    expect(strikesPlayed(events, 99.9, 100.1)).toEqual([{ event: hot, shake: false }]);
    // The load balancer's reaction is the game's, not the troublemaker's.
    expect(strikesPlayed(events, 61.5, 62.5)).toEqual([]);
  });

  it('stays still when scrubbing, skipping or going backwards across a strike', () => {
    expect(strikesPlayed(events, 10, 120)).toEqual([]);
    expect(strikesPlayed(events, 62, 60)).toEqual([]);
    expect(strikesPlayed(events, 61, 61)).toEqual([]);
  });
});

describe('cost as a second score', () => {
  const checks = (cost: number, budget: number) => ({
    availability: { value: 1, required: 0.999, ok: true },
    latency: { p99Ms: 10, requiredMs: 50, ok: true },
    budget: { costUsdPerMonth: cost, budgetUsdPerMonth: budget, ok: cost <= budget },
  });

  it('works out the money left under budget, and nothing when over', () => {
    expect(savingsSituation({ grade: 'mastered', checks: checks(1105, 2000) })).toEqual({
      savedUsdPerMonth: 895,
      costUsdPerMonth: 1105,
      budgetUsdPerMonth: 2000,
      share: 0.4475,
      grade: 'mastered',
    });
    expect(savingsSituation({ grade: 'fail', checks: checks(2100, 2000) })).toBeNull();
  });

  it('gives Ms. Tally a reaction to every amount', () => {
    const line = (cost: number, grade: 'fail' | 'pass' = 'pass') => cast.bossSavings(savingsSituation({ grade, checks: checks(cost, 1000) })!);
    expect(line(500)).toBe("$500 a month to spare. Now that's engineering.");
    expect(line(900)).toBe("$100 a month under budget. I'll take it.");
    expect(line(990)).toBe('$10 under. Cutting it fine, but under.');
    expect(line(1000)).toMatch(/Every last cent/);
    expect(line(700, 'fail')).toBe('At least it was cheap: $300 a month under budget.');
  });
});

describe('locks and badges in the notebook', () => {
  it('says why a level is closed', () => {
    const previous = lockSituation({ kind: 'previousLevel', levelId: LEVELS[1]!.id }, LEVELS, CHAPTERS)!;
    expect(previous).toEqual({ kind: 'previousLevel', levelNumber: 2, title: 'Scale Out' });
    expect(cast.lockedLevel(previous)).toEqual({ role: 'mentor', line: 'One page at a time, kid. Pass p.2, Scale Out, first.' });
    const chapter = lockSituation({ kind: 'chapter', chapterId: 'hypergrowth', needed: 22, have: 18 }, LEVELS, CHAPTERS)!;
    expect(cast.lockedLevel(chapter).line).toBe('Chapter 3 costs 22 nines. You have 18: earn 4 more. Stars on earlier pages count.');
    expect(lockSituation({ kind: 'open' }, LEVELS, CHAPTERS)).toBeNull();
  });

  it('names every badge, says how to earn it, and has someone hand it over', () => {
    for (const id of BADGE_IDS) {
      const copy = cast.badges[id];
      expect(copy.name && copy.how && copy.line, id).toBeTruthy();
      expect(cast.members[copy.role], id).toBeDefined();
    }
    expect(cast.badges.rightSized.how).toMatch(/cheapest reference design/);
    expect(cast.badges.pennyPincher.how).toContain('80%');
  });

  it('shows earned and unearned badges on the shelf', () => {
    const html = renderToStaticMarkup(
      createElement(theme.BadgeShelf, { earned: { nPlusOne: { levelId: '03' } }, levelLabel: (id: string) => `page ${id}` }),
    );
    expect(html).toContain('1 / 5');
    expect(html).toContain('Earned on page 03.');
    expect(html).toContain(cast.badges.rightSized.how);
    expect(html.match(/data-earned="true"/g)?.length).toBe(2); // the list item and its seal
  });

  it('draws locked stops on the map with why they are locked', () => {
    const html = renderToStaticMarkup(
      createElement(theme.CampaignMap, {
        chapters: CHAPTERS,
        levels: LEVELS,
        best: {},
        nextUp: 0,
        access: { [LEVELS[1]!.id]: { kind: 'previousLevel', levelId: LEVELS[0]!.id } },
        chapterAccess: { 'growing-pains': { kind: 'locked', needed: 10, have: 0 } },
      }),
    );
    expect(html).toContain('Locked: pass page 1 first.');
    expect(html).toContain('needs 10 nines');
  });
});
