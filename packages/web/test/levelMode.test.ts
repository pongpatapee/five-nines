import { evaluateDesign, LEVELS } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import { draftFromDesign } from '../src/canvas/layout.ts';
import { emptyDraft } from '../src/canvas/draft.ts';
import { INITIAL_MODE, levelModeReducer, type LevelMode } from '../src/screens/levelMode.ts';

const level = LEVELS[0]!;
const draft = draftFromDesign(level.solutions[0]!.design);
const graded = evaluateDesign(level, draft.design);
const invalid = evaluateDesign(level, emptyDraft().design);

function evaluating(): LevelMode {
  return levelModeReducer(INITIAL_MODE, { type: 'run', runId: 1, draft });
}

describe('level mode state machine', () => {
  it('goes build → evaluating → run → result', () => {
    const e = evaluating();
    expect(e).toEqual({ kind: 'evaluating', runId: 1, draft });
    const run = levelModeReducer(e, { type: 'evaluated', runId: 1, evaluation: graded });
    expect(run).toMatchObject({ kind: 'run', runId: 1, draft, replay: 0 });
    const result = levelModeReducer(run, { type: 'finished' });
    expect(result).toMatchObject({ kind: 'result', view: 'grade', evaluation: graded });
  });

  it('ignores results of stale runs', () => {
    const e = evaluating();
    expect(levelModeReducer(e, { type: 'evaluated', runId: 99, evaluation: graded })).toBe(e);
    expect(levelModeReducer(e, { type: 'evaluationFailed', runId: 99, message: 'x' })).toBe(e);
  });

  it('returns to build with a notice when the design is invalid or the worker fails', () => {
    const fromInvalid = levelModeReducer(evaluating(), { type: 'evaluated', runId: 1, evaluation: invalid });
    expect(fromInvalid.kind).toBe('build');
    expect(fromInvalid.kind === 'build' && fromInvalid.notice).toMatch(/^Can't run yet/);
    const fromCrash = levelModeReducer(evaluating(), { type: 'evaluationFailed', runId: 1, message: 'boom' });
    expect(fromCrash).toEqual({ kind: 'build', notice: 'The simulation failed: boom' });
    expect(levelModeReducer(fromCrash, { type: 'edit' })).toEqual(INITIAL_MODE);
  });

  it('replays the same evaluation with a new replay number', () => {
    let mode = levelModeReducer(evaluating(), { type: 'evaluated', runId: 1, evaluation: graded });
    mode = levelModeReducer(mode, { type: 'finished' });
    mode = levelModeReducer(mode, { type: 'showView', view: 'debrief' });
    expect(mode).toMatchObject({ kind: 'result', view: 'debrief' });
    mode = levelModeReducer(mode, { type: 'replay' });
    expect(mode).toMatchObject({ kind: 'run', replay: 1, evaluation: graded });
  });

  it('goes back to build from any mode, and ignores events that do not apply', () => {
    const run = levelModeReducer(evaluating(), { type: 'evaluated', runId: 1, evaluation: graded });
    expect(levelModeReducer(run, { type: 'edit' })).toEqual(INITIAL_MODE);
    expect(levelModeReducer(INITIAL_MODE, { type: 'edit' })).toBe(INITIAL_MODE);
    expect(levelModeReducer(INITIAL_MODE, { type: 'finished' })).toBe(INITIAL_MODE);
    expect(levelModeReducer(run, { type: 'run', runId: 2, draft })).toBe(run);
  });
});
