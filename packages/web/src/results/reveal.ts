/**
 * The results screen's payout, revealed in beats: the grade is stamped, the win chimes, the nines tick up one at a
 * time, then each new badge is stamped. Pure: `revealBeats` lays the beats out in time, `revealAt` says what's showing
 * at a moment. With reduced motion every beat happens at once.
 */
import type { BadgeId, RunReward } from '../progression/index.ts';

export type RevealBeat =
  | { kind: 'grade'; atMs: number }
  | { kind: 'win'; atMs: number }
  /** One more nine on the counter: `total` is the new running total. */
  | { kind: 'nine'; atMs: number; total: number }
  | { kind: 'badge'; atMs: number; badge: BadgeId };

export const REVEAL_TIMING = {
  /** The win chime, after the grade's stamp lands. */
  winMs: 350,
  /** The first nine. */
  ninesStartMs: 700,
  /** Between nines. */
  nineGapMs: 180,
  /** Between the last nine and the first badge, and between badges. */
  badgeGapMs: 650,
} as const;

export function revealBeats(reward: RunReward, passed: boolean, reducedMotion: boolean): RevealBeat[] {
  const beats: RevealBeat[] = [{ kind: 'grade', atMs: 0 }];
  const at = (ms: number) => (reducedMotion ? 0 : ms);
  if (passed) beats.push({ kind: 'win', atMs: at(REVEAL_TIMING.winMs) });
  let t = REVEAL_TIMING.ninesStartMs;
  const { before, after } = reward.totalNines;
  for (let total = before + 1; total <= after; total++) {
    beats.push({ kind: 'nine', atMs: at(t), total });
    t += REVEAL_TIMING.nineGapMs;
  }
  t += REVEAL_TIMING.badgeGapMs - REVEAL_TIMING.nineGapMs;
  for (const badge of reward.newBadges) {
    beats.push({ kind: 'badge', atMs: at(t), badge });
    t += REVEAL_TIMING.badgeGapMs;
  }
  return beats;
}

export interface RevealState {
  /** The running total of nines on the counter. */
  total: number;
  /** The level's nines on show: they fill in step with the counter. */
  level: number;
  /** New badges stamped so far, in order. */
  badges: BadgeId[];
  /** Every beat has happened. */
  done: boolean;
}

export function revealAt(reward: RunReward, beats: readonly RevealBeat[], elapsedMs: number): RevealState {
  let total = reward.totalNines.before;
  const badges: BadgeId[] = [];
  for (const beat of beats) {
    if (beat.atMs > elapsedMs) continue;
    if (beat.kind === 'nine') total = Math.max(total, beat.total);
    if (beat.kind === 'badge') badges.push(beat.badge);
  }
  const gained = total - reward.totalNines.before;
  return {
    total,
    level: Math.min(reward.levelNines.after, reward.levelNines.before + gained),
    badges,
    done: beats.every((beat) => beat.atMs <= elapsedMs),
  };
}
