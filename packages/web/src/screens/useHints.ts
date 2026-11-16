/**
 * The mentor's hints on a level page (docs/design.md, "Hints and iteration"). Before any failed run: the level's own
 * ladder, about its main trap. After a failed run: that run's ladder, which stays the one the top bar shows while the
 * player builds, until a run passes or another fails. The rungs revealed are kept per ladder, so the results card and
 * the hints dialog always agree.
 */
import type { Level } from '@five-nines/sim';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { playCue } from '../audio/sfx.ts';
import { failureStory, hintLadder, levelHintLadder, type HintLadder } from '../theme/index.ts';
import type { LevelMode } from './levelMode.ts';

export interface Hints {
  ladder: HintLadder;
  shown: number;
  reveal(): void;
}

interface RunLadder {
  runId: number;
  /** Null when the run passed. */
  ladder: HintLadder | null;
}

export function useHints(level: Level, mode: LevelMode): Hints | null {
  const levelLadder = useMemo(() => levelHintLadder(level), [level]);

  // The ladder of the run on screen, worked out as soon as its result shows.
  // It depends on the run, not on which view of its result is showing, so it's keyed on the run's parts.
  const runId = mode.kind === 'result' ? mode.runId : null;
  const design = mode.kind === 'result' ? mode.draft.design : null;
  const evaluation = mode.kind === 'result' ? mode.evaluation : null;
  const current = useMemo<RunLadder | null>(() => {
    if (runId === null || !design || !evaluation) return null;
    const story = failureStory(level, design, evaluation);
    return { runId, ladder: story ? hintLadder(level, story) : null };
  }, [level, runId, design, evaluation]);
  const [last, setLast] = useState<RunLadder | null>(null);
  useEffect(() => {
    if (current && current.runId !== last?.runId) setLast(current);
  }, [current, last]);

  const run = current ?? last;
  const ladder = run?.ladder ?? levelLadder;
  const key = run?.ladder ? `run:${run.runId}` : 'level';
  const [shownByKey, setShownByKey] = useState<Readonly<Record<string, number>>>({});
  const shown = shownByKey[key] ?? 1;
  const reveal = useCallback(() => {
    playCue('hint');
    setShownByKey((byKey) => ({ ...byKey, [key]: (byKey[key] ?? 1) + 1 }));
  }, [key]);

  return useMemo(() => (ladder ? { ladder, shown, reveal } : null), [ladder, shown, reveal]);
}
