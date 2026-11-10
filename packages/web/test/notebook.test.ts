import { evaluateDesign, LEVELS, type DesignIssue, type SimEvent } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import {
  bossBriefingLine,
  bossVerdict,
  eventCaption,
  MENTOR_HINTS,
  MENTOR_SIGN_OFF,
  mentorCheckLine,
  mentorHint,
  roughly,
  troublemakerTease,
} from '../src/notebook/cast.ts';
import { loopPath } from '../src/notebook/ink.tsx';
import { TALLY_STROKES, tallyState } from '../src/notebook/tally.ts';

const [level1, level2, level3] = LEVELS as [(typeof LEVELS)[number], (typeof LEVELS)[number], (typeof LEVELS)[number]];

describe('cast lines', () => {
  it("Ms. Tally quotes the level's real budget", () => {
    expect(bossBriefingLine(level3)).toBe('$2,600 a month. Not a cent over.');
  });

  it("Smudge teases the level's scripted crash, else its traffic surge", () => {
    expect(troublemakerTease(level3)).toBe('heh. about a minute in, I unplug your busiest app server.');
    expect(troublemakerTease(level1)).toBe('heh. traffic climbs from 100 to 350 req/s. hope you sized up.');
    expect(troublemakerTease(level2)).toMatch(/1,000 to 5,000 req\/s/);
  });

  it('says times the way a person would', () => {
    expect(roughly(30)).toBe('30 seconds');
    expect(roughly(61)).toBe('about a minute');
    expect(roughly(150)).toBe('about 3 minutes');
  });

  it('credits Smudge with crashes only', () => {
    const crash: SimEvent = { atSec: 61, kind: 'instanceFailed', nodeId: 'app', instance: 0, message: 'app #1 crashed.' };
    expect(eventCaption(crash)).toEqual({ text: 'Smudge pulls the plug on app instance 1', bySmudge: true });
    const rotation: SimEvent = { ...crash, kind: 'removedFromRotation', balancerId: 'lb', message: 'lb removed app #1.' };
    expect(eventCaption(rotation)).toEqual({ text: 'lb removed app #1.', bySmudge: false });
  });

  it('Erasmus has a hint for every failure reason and a sign-off otherwise', () => {
    for (const [reason, hint] of Object.entries(MENTOR_HINTS)) {
      expect(mentorHint(reason as keyof typeof MENTOR_HINTS)).toBe(hint);
    }
    expect(mentorHint(null)).toBe(MENTOR_SIGN_OFF);
  });

  it('Erasmus reacts to design checks by severity', () => {
    const error: DesignIssue = { code: 'x', severity: 'error', message: 'e' } as unknown as DesignIssue;
    const warning: DesignIssue = { code: 'y', severity: 'warning', message: 'w' } as unknown as DesignIssue;
    expect(mentorCheckLine([])).toMatch(/runnable/);
    expect(mentorCheckLine([warning])).toMatch(/Only warnings/);
    expect(mentorCheckLine([error, warning])).toMatch(/^One thing/);
    expect(mentorCheckLine([error, error])).toMatch(/^2 things/);
  });

  it('Ms. Tally judges the check that actually failed', () => {
    for (const anti of level3.antiSolutions) {
      const evaluation = evaluateDesign(level3, anti.design);
      if (evaluation.status !== 'graded') continue;
      const verdict = bossVerdict(evaluation);
      const first = evaluation.failedChecks[0];
      if (first === 'availability') expect(verdict.line).toBe('We promised 99.9%. See me after.');
      if (first === 'latency') expect(verdict.exclaim).toMatch(/^p99 of/);
      if (first === 'budget') expect(verdict.line).toMatch(/Not a cent over/);
    }
    const best = evaluateDesign(level3, level3.solutions[0]!.design);
    if (best.status !== 'graded') throw new Error('solution should grade');
    expect(bossVerdict(best).exclaim).toBe('Five nines.');
  });
});

describe('error budget tally', () => {
  it('crosses out a stroke only once its whole share is spent', () => {
    expect(tallyState(0, false)).toEqual({ total: TALLY_STROKES, spent: 0, left: TALLY_STROKES });
    expect(tallyState(0.019, false).spent).toBe(0);
    expect(tallyState(0.02, false).spent).toBe(1);
    expect(tallyState(0.5, false).spent).toBe(25);
  });

  it('never shows a held budget as fully spent, and always shows an exhausted one as fully spent', () => {
    expect(tallyState(0.9999, false).spent).toBe(TALLY_STROKES - 1);
    expect(tallyState(1.5, false).spent).toBe(TALLY_STROKES - 1);
    expect(tallyState(1, true)).toEqual({ total: TALLY_STROKES, spent: TALLY_STROKES, left: 0 });
    expect(tallyState(Infinity, true).spent).toBe(TALLY_STROKES);
    expect(tallyState(Number.NaN, false).spent).toBe(0);
  });
});

describe('ink loop', () => {
  it('is deterministic and starts with a move', () => {
    expect(loopPath(200, 100)).toBe(loopPath(200, 100));
    expect(loopPath(200, 100)).toMatch(/^M[\d.]+,[\d.]+ C/);
  });
});
