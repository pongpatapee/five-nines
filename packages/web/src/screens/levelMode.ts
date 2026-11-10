/**
 * The level screen's mode state machine.
 *
 *   build ──run──▶ evaluating ──evaluated(graded)──▶ run ──finished──▶ result
 *     ▲               │ evaluated(invalid) / failed                     │ │
 *     │               ▼                                                 │ │
 *     └──────────── build (with a notice) ◀──────────edit───────────────┘ │
 *                                         run ◀──────replay───────────────┘
 *
 * `edit` returns to build from any mode. The draft that was run is snapshotted into the mode, so playback and results
 * always show exactly what was simulated even though the store's draft is the editable one.
 */
import type { Evaluation } from '@five-nines/sim';
import type { Draft } from '../canvas/types.ts';
import type { GradedEvaluation } from '../engine/index.ts';

export type ResultView = 'grade' | 'debrief';

export type LevelMode =
  | {
      kind: 'build';
      /** Shown by the editor when the last run attempt couldn't start (e.g. the worker failed). */
      notice: string | null;
    }
  | { kind: 'evaluating'; runId: number; draft: Draft }
  | {
      kind: 'run';
      runId: number;
      draft: Draft;
      evaluation: GradedEvaluation;
      /** Bumped on every replay; use it as the playback component's key so it restarts. */
      replay: number;
    }
  | { kind: 'result'; runId: number; draft: Draft; evaluation: GradedEvaluation; replay: number; view: ResultView };

export type LevelModeEvent =
  /** Start a run of `draft`. `runId` must be unique per screen (a counter). Only valid in build mode. */
  | { type: 'run'; runId: number; draft: Draft }
  | { type: 'evaluated'; runId: number; evaluation: Evaluation }
  | { type: 'evaluationFailed'; runId: number; message: string }
  /** Playback ended (played to the end, or the player chose "See results"). */
  | { type: 'finished' }
  | { type: 'replay' }
  /** Back to the editor, keeping the draft and layout. In build mode, clears the notice. */
  | { type: 'edit' }
  | { type: 'showView'; view: ResultView };

export const INITIAL_MODE: LevelMode = { kind: 'build', notice: null };

export function levelModeReducer(mode: LevelMode, event: LevelModeEvent): LevelMode {
  switch (event.type) {
    case 'run':
      return mode.kind === 'build' ? { kind: 'evaluating', runId: event.runId, draft: event.draft } : mode;

    case 'evaluated':
      if (mode.kind !== 'evaluating' || mode.runId !== event.runId) return mode;
      if (event.evaluation.status === 'invalid') {
        const first = event.evaluation.issues.find((issue) => issue.severity === 'error');
        return { kind: 'build', notice: first ? `Can't run yet: ${first.message}` : "Can't run this design yet." };
      }
      return { kind: 'run', runId: mode.runId, draft: mode.draft, evaluation: event.evaluation, replay: 0 };

    case 'evaluationFailed':
      if (mode.kind !== 'evaluating' || mode.runId !== event.runId) return mode;
      return { kind: 'build', notice: `The simulation failed: ${event.message}` };

    case 'finished':
      return mode.kind === 'run' ? { ...mode, kind: 'result', view: 'grade' } : mode;

    case 'replay':
      if (mode.kind !== 'result') return mode;
      return { kind: 'run', runId: mode.runId, draft: mode.draft, evaluation: mode.evaluation, replay: mode.replay + 1 };

    case 'edit':
      return mode.kind === 'build' && mode.notice === null ? mode : INITIAL_MODE;

    case 'showView':
      return mode.kind === 'result' ? { ...mode, view: event.view } : mode;
  }
}
