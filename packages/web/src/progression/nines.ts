/**
 * Nines, the game's currency (docs/ideas.md, "Rewards and progression"). A level pays out the nines of the
 * availability it reached: 3 for a pass (99.9%), 4 for a star (99.99%), 5 for mastered (99.999%). Only a level's best
 * grade counts, so replaying a level can raise its payout but never pays twice. Pure.
 */
import type { Grade } from '@five-nines/sim';

/** What each passing grade pays. A failed or unplayed level pays nothing. */
export const NINES_FOR_GRADE: Readonly<Record<Exclude<Grade, 'fail'>, number>> = { pass: 3, star: 4, mastered: 5 };

/** The most a level can pay: mastered. */
export const MAX_NINES_PER_LEVEL = NINES_FOR_GRADE.mastered;

/** Nines a grade pays. */
export function ninesForGrade(grade: Grade | undefined): number {
  return grade === undefined || grade === 'fail' ? 0 : NINES_FOR_GRADE[grade];
}

export interface NinesTotal {
  earned: number;
  /** Everything the levels could pay: `MAX_NINES_PER_LEVEL` each. */
  total: number;
}

/** Nines earned across `levelIds` from their best grades. */
export function ninesTotal(levelIds: readonly string[], best: Readonly<Record<string, Grade>>): NinesTotal {
  const earned = levelIds.reduce((sum, id) => sum + ninesForGrade(best[id]), 0);
  return { earned, total: levelIds.length * MAX_NINES_PER_LEVEL };
}
