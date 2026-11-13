import type { Level } from '@five-nines/sim';
import { useEffect, useMemo, useState } from 'react';
import { playCue } from '../audio/sfx.ts';
import type { GradedEvaluation } from '../engine/index.ts';
import { runBadges, type RunReward } from '../progression/index.ts';
import { progressStore } from '../state/index.ts';
import type { SoundCue } from '../theme/index.ts';
import { revealAt, revealBeats, type RevealBeat, type RevealState } from './reveal.ts';

/**
 * Each run's payout, by its evaluation. A run is recorded once however often its result is shown (a replay shows the
 * same evaluation again), so replaying never pays twice and the result can still say what the run earned.
 */
const rewards = new WeakMap<GradedEvaluation, RunReward>();
/** Runs whose payout has been revealed in full: shown again, they appear finished. */
const revealed = new WeakSet<GradedEvaluation>();

/** Records the run (grade and badges) the first time its result shows, and returns what it paid out. */
export function useRunReward(level: Level, evaluation: GradedEvaluation): RunReward | null {
  const [reward, setReward] = useState(() => rewards.get(evaluation) ?? null);
  useEffect(() => {
    let paid = rewards.get(evaluation);
    if (!paid) {
      paid = progressStore.getState().recordRun(level.id, evaluation.grade, runBadges(level, evaluation));
      rewards.set(evaluation, paid);
    }
    setReward(paid);
  }, [level, evaluation]);
  return reward;
}

const CUES: Record<RevealBeat['kind'], SoundCue> = { grade: 'grade', win: 'win', nine: 'nine', badge: 'badge' };

/** Plays the payout's beats in time, with their sounds, and returns what's showing now. */
export function useReveal(
  evaluation: GradedEvaluation,
  reward: RunReward | null,
  reducedMotion: boolean,
): RevealState | null {
  const passed = evaluation.grade !== 'fail';
  const beats = useMemo(() => (reward ? revealBeats(reward, passed, reducedMotion) : []), [reward, passed, reducedMotion]);
  const [elapsedMs, setElapsedMs] = useState(() => (revealed.has(evaluation) ? Infinity : -1));

  useEffect(() => {
    if (beats.length === 0 || revealed.has(evaluation)) {
      if (revealed.has(evaluation)) setElapsedMs(Infinity);
      return;
    }
    // Beats at the same moment (all of them, with reduced motion) make each sound once.
    const byTime = new Map<number, Set<SoundCue>>();
    for (const beat of beats) byTime.set(beat.atMs, (byTime.get(beat.atMs) ?? new Set()).add(CUES[beat.kind]));
    const last = Math.max(...byTime.keys());
    const timers = [...byTime].map(([atMs, cues]) =>
      setTimeout(() => {
        for (const cue of cues) playCue(cue);
        setElapsedMs((elapsed) => Math.max(elapsed, atMs));
        if (atMs === last) revealed.add(evaluation);
      }, atMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [beats, evaluation]);

  return reward ? revealAt(reward, beats, elapsedMs) : null;
}
