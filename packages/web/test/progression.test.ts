import { CHAPTERS, designCostUsdPerMonth, evaluateDesign, getLevel, isWritten, LEVELS, type Chapter, type Design, type Evaluation, type Grade } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import {
  awardBadges,
  bestOf,
  CHAPTER_UNLOCK_NINES,
  chapterAccess,
  devUnlockAll,
  isPennyPincher,
  isRightSized,
  rightSizedCost,
  keptSpareThroughCrash,
  levelAccess,
  masteredChapterIds,
  MAX_NINES_PER_LEVEL,
  nextUpLevelId,
  ninesForGrade,
  ninesTotal,
  progressBadges,
  runBadges,
  runReward,
} from '../src/progression/index.ts';

type Graded = Extract<Evaluation, { status: 'graded' }>;

const CAMPAIGN: Chapter[] = [
  { id: 'getting-online', title: 'One', levelIds: ['a', 'b', 'c'] },
  { id: 'growing-pains', title: 'Two', levelIds: ['d', 'e'] },
  { id: 'worldwide', title: 'Later', levelIds: [] },
];

function graded(levelId: string, which: 'solution' | 'anti', name?: string): { design: Design; evaluation: Graded } {
  const level = getLevel(levelId)!;
  const list = which === 'solution' ? level.solutions : level.antiSolutions;
  const entry = name ? list.find((item) => item.name === name)! : list[0]!;
  const evaluation = evaluateDesign(level, entry.design);
  if (evaluation.status !== 'graded') throw new Error(`${levelId} ${entry.name} did not grade`);
  return { design: entry.design, evaluation };
}

describe('nines', () => {
  it('pays 3, 4 and 5 nines for pass, star and mastered', () => {
    expect([undefined, 'fail', 'pass', 'star', 'mastered'].map((g) => ninesForGrade(g as Grade | undefined))).toEqual([
      0, 0, 3, 4, 5,
    ]);
    expect(MAX_NINES_PER_LEVEL).toBe(5);
  });

  it('totals the best grades across levels', () => {
    expect(ninesTotal(['a', 'b', 'c'], {})).toEqual({ earned: 0, total: 15 });
    expect(ninesTotal(['a', 'b', 'c'], { a: 'mastered', b: 'star', c: 'fail', other: 'mastered' })).toEqual({
      earned: 9,
      total: 15,
    });
  });

  it('gives the built campaign 5 nines a level', () => {
    const levels = CHAPTERS.filter(isWritten).flatMap((c) => c.levelIds);
    expect(ninesTotal(levels, {}).total).toBe(levels.length * 5);
  });
});

describe('unlocks', () => {
  it('has a threshold for every chapter, rising, with the first chapter open', () => {
    const thresholds = CHAPTERS.map((chapter) => CHAPTER_UNLOCK_NINES[chapter.id]);
    expect(thresholds.every((n) => typeof n === 'number')).toBe(true);
    expect(thresholds[0]).toBe(0);
    for (let i = 1; i < thresholds.length; i++) expect(thresholds[i]!).toBeGreaterThan(thresholds[i - 1]!);
  });

  it('asks for more than passes alone, but less than everything, before each chapter', () => {
    let passes = 0;
    let most = 0;
    for (const chapter of CHAPTERS) {
      const needed = CHAPTER_UNLOCK_NINES[chapter.id]!;
      if (needed > 0) {
        expect(needed, chapter.id).toBeGreaterThan(passes);
        expect(needed, chapter.id).toBeLessThan(most);
      }
      passes += chapter.levelIds.length * 3;
      most += chapter.levelIds.length * 5;
    }
  });

  it('opens only the first level of a fresh save', () => {
    const open = ['a', 'b', 'c', 'd', 'e'].filter((id) => levelAccess(CAMPAIGN, { best: {} }, id).kind === 'open');
    expect(open).toEqual(['a']);
    expect(levelAccess(CAMPAIGN, { best: {} }, 'b')).toEqual({ kind: 'previousLevel', levelId: 'a' });
  });

  it('opens a level once the one before it passes, not when it fails', () => {
    expect(levelAccess(CAMPAIGN, { best: { a: 'fail' } }, 'b').kind).toBe('previousLevel');
    expect(levelAccess(CAMPAIGN, { best: { a: 'pass' } }, 'b').kind).toBe('open');
    expect(levelAccess(CAMPAIGN, { best: { a: 'pass' } }, 'c').kind).toBe('previousLevel');
  });

  it("opens a chapter's first level only with the previous level passed and enough nines", () => {
    const stars = { a: 'star', b: 'star', c: 'star' } as const;
    // 12 nines: one short of chapter 2's 13.
    expect(levelAccess(CAMPAIGN, { best: stars }, 'd')).toEqual({ kind: 'chapter', chapterId: 'growing-pains', needed: 13, have: 12 });
    expect(chapterAccess(CAMPAIGN, { best: stars }, 'growing-pains')).toEqual({ kind: 'locked', needed: 13, have: 12 });
    expect(levelAccess(CAMPAIGN, { best: { ...stars, a: 'mastered' } }, 'd').kind).toBe('open');
    // Enough nines, but the level before it isn't passed.
    expect(levelAccess(CAMPAIGN, { best: { a: 'mastered', b: 'mastered', c: 'fail' } }, 'd')).toEqual({
      kind: 'previousLevel',
      levelId: 'c',
    });
  });

  it('keeps every level the player has a grade on open, so old saves lose nothing', () => {
    expect(levelAccess(CAMPAIGN, { best: { e: 'fail' } }, 'e').kind).toBe('open');
    expect(levelAccess(CAMPAIGN, { best: { e: 'fail' } }, 'd').kind).toBe('previousLevel');
  });

  it('opens everything with the developer escape hatch', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(levelAccess(CAMPAIGN, { best: {}, unlockAll: true }, id).kind).toBe('open');
    expect(devUnlockAll('?unlock=all')).toBe(true);
    expect(devUnlockAll('?x=1&unlock=all')).toBe(true);
    expect(devUnlockAll('')).toBe(false);
    expect(devUnlockAll('?unlock=some')).toBe(false);
  });

  it('points at the first level not passed', () => {
    expect(nextUpLevelId(CAMPAIGN, {})).toBe('a');
    expect(nextUpLevelId(CAMPAIGN, { a: 'pass', b: 'fail' })).toBe('b');
    expect(nextUpLevelId(CAMPAIGN, { a: 'pass', c: 'star' })).toBe('b');
    expect(nextUpLevelId(CAMPAIGN, { a: 'pass', b: 'star', c: 'mastered', d: 'pass', e: 'pass' })).toBeNull();
  });
});

describe('run badges', () => {
  it('Right-sized: passed for no more than the cheapest reference solution', () => {
    const level2 = getLevel('02-scale-out')!;
    expect(rightSizedCost(level2)).toBe(1945);
    const four = graded('02-scale-out', 'solution', 'Four xlarge servers');
    expect(isRightSized(level2, four.evaluation)).toBe(true);
    // A dollar over the cheapest reference is not right-sized, even on a mastered run.
    const pricier = { ...four.evaluation, checks: { ...four.evaluation.checks, budget: { ...four.evaluation.checks.budget, costUsdPerMonth: 1946 } } };
    expect(isRightSized(level2, pricier)).toBe(false);
    // Cheaper but failed earns nothing.
    expect(isRightSized(level2, graded('02-scale-out', 'anti', 'Three xlarge servers').evaluation)).toBe(false);
    // Level 3 offers a $1,945 design with exactly enough servers, but it fails; the cheapest passing reference is the bar.
    expect(rightSizedCost(getLevel('03-pull-the-plug')!)).toBe(2425);
  });

  it("is earnable on every built level: each level's cheapest reference solution earns it", () => {
    for (const level of LEVELS) {
      const cheapest = [...level.solutions].sort((a, b) => designCostUsdPerMonth(a.design) - designCostUsdPerMonth(b.design))[0]!;
      const evaluation = evaluateDesign(level, cheapest.design);
      if (evaluation.status !== 'graded') throw new Error(`${level.id} did not grade`);
      expect(isRightSized(level, evaluation), `${level.id}: ${cheapest.name}`).toBe(true);
      expect(runBadges(level, evaluation), level.id).toContain('rightSized');
    }
  });

  it('teaches comfort, not heat: level 1 at 44% busy is right-sized, the oversized server is not', () => {
    const level1 = getLevel('01-hello-traffic')!;
    expect(isRightSized(level1, graded('01-hello-traffic', 'solution').evaluation)).toBe(true);
    const xlarge = graded('01-hello-traffic', 'anti', 'One xlarge server').evaluation;
    expect(isRightSized(level1, xlarge)).toBe(false);
  });

  it('N+1: passed through the crash with the survivors out of the hot zone', () => {
    const nPlusOne = graded('03-pull-the-plug', 'solution');
    expect(keptSpareThroughCrash(nPlusOne.evaluation)).toBe(true);
    // Exactly enough servers: the survivors overload after the crash (and the run fails).
    expect(keptSpareThroughCrash(graded('03-pull-the-plug', 'anti', 'Exactly enough servers, with retries').evaluation)).toBe(false);
    // Levels without a crash never award it.
    expect(keptSpareThroughCrash(graded('02-scale-out', 'solution').evaluation)).toBe(false);
  });

  it('N+1 is lost when the survivors run hot, even on a pass', () => {
    const { evaluation } = graded('03-pull-the-plug', 'solution');
    const crash = evaluation.simulation.events.find((event) => event.kind === 'instanceFailed')!;
    const timeline = evaluation.simulation.timeline.map((frame) =>
      frame.atSec < crash.atSec + 10
        ? frame
        : {
            ...frame,
            nodes: {
              ...frame.nodes,
              [crash.nodeId]: {
                ...frame.nodes[crash.nodeId]!,
                instances: frame.nodes[crash.nodeId]!.instances.map((inst) => ({ ...inst, utilization: 0.9 })),
              },
            },
          },
    );
    expect(keptSpareThroughCrash({ ...evaluation, simulation: { ...evaluation.simulation, timeline } })).toBe(false);
  });

  it('Penny Pincher: mastered for at most 80% of the budget', () => {
    expect(isPennyPincher(graded('08-thundering-herd', 'solution', 'A replicated cache').evaluation)).toBe(true);
    expect(isPennyPincher(graded('08-thundering-herd', 'solution', 'A database big enough for the burst').evaluation)).toBe(false);
    const cheapButStar = graded('08-thundering-herd', 'solution', 'A replicated cache').evaluation;
    expect(isPennyPincher({ ...cheapButStar, grade: 'star' })).toBe(false);
  });

  it('lists a run\'s badges in a fixed order', () => {
    const { evaluation } = graded('03-pull-the-plug', 'solution');
    expect(runBadges(getLevel('03-pull-the-plug')!, evaluation)).toEqual(['rightSized', 'nPlusOne']);
    const cheap = graded('08-thundering-herd', 'solution', 'A replicated cache');
    expect(runBadges(getLevel('08-thundering-herd')!, cheap.evaluation)).toEqual(['rightSized', 'pennyPincher']);
    // The xlarge database masters level 8 but costs more than the cheapest reference.
    const big = graded('08-thundering-herd', 'solution', 'A database big enough for the burst');
    expect(runBadges(getLevel('08-thundering-herd')!, big.evaluation)).toEqual([]);
  });
});

describe('progress badges', () => {
  it('Five Nines Club: every level of a chapter mastered', () => {
    expect(masteredChapterIds(CAMPAIGN, { a: 'mastered', b: 'mastered', c: 'star' })).toEqual([]);
    expect(masteredChapterIds(CAMPAIGN, { d: 'mastered', e: 'mastered' })).toEqual(['growing-pains']);
    expect(progressBadges(CAMPAIGN, { best: { d: 'mastered', e: 'mastered' }, closeEstimates: [] })).toEqual(['fiveNinesClub']);
  });

  it('never counts an unwritten chapter as mastered', () => {
    expect(masteredChapterIds(CAMPAIGN, {})).toEqual([]);
  });

  it('Napkin Wizard: the estimate bonus on three levels', () => {
    expect(progressBadges(CAMPAIGN, { best: {}, closeEstimates: ['a', 'b'] })).toEqual([]);
    expect(progressBadges(CAMPAIGN, { best: {}, closeEstimates: ['a', 'b', 'b'] })).toEqual([]);
    expect(progressBadges(CAMPAIGN, { best: {}, closeEstimates: ['a', 'b', 'c'] })).toEqual(['napkinWizard']);
  });
});

describe('run rewards', () => {
  it('keeps the best grade', () => {
    expect(bestOf(undefined, 'fail')).toBe('fail');
    expect(bestOf('star', 'pass')).toBe('star');
    expect(bestOf('pass', 'mastered')).toBe('mastered');
  });

  it('awards only new badges, crediting the level, and keeps the object when nothing is new', () => {
    const held = { rightSized: { levelId: 'a' } };
    expect(awardBadges(held, ['rightSized'], 'b')).toBe(held);
    expect(awardBadges(held, ['rightSized', 'nPlusOne'], 'b')).toEqual({ rightSized: { levelId: 'a' }, nPlusOne: { levelId: 'b' } });
  });

  it('reports the nines, badges and chapters a run paid out', () => {
    const before = { best: { a: 'mastered', b: 'star' } as Record<string, Grade>, badges: {} };
    const after = { best: { a: 'mastered', b: 'star', c: 'mastered' } as Record<string, Grade>, badges: { rightSized: { levelId: 'c' } } };
    expect(runReward(CAMPAIGN, 'c', before, after)).toEqual({
      levelId: 'c',
      levelNines: { before: 0, after: 5 },
      totalNines: { before: 9, after: 14, total: 25 },
      newBadges: ['rightSized'],
      openedChapterIds: ['growing-pains'],
      capped: false,
    });
    expect(runReward(CAMPAIGN, 'c', after, after)).toMatchObject({ levelNines: { before: 5, after: 5 }, newBadges: [], openedChapterIds: [] });
  });
});
