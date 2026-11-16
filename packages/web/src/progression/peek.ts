/**
 * Giving up: seeing a level's reference solution before passing it (docs/design.md, "Giving up"). The rules:
 *
 * - A level is *peeked* when the player confirms seeing its solution while it has no passing grade. Once passed, the
 *   solutions are free to look at and nothing is recorded. A peek is permanent.
 * - A run on a peeked level is credited at most a pass (three nines), and earns no run badges.
 * - The level's best grade is never lowered: a grade recorded before the peek stays.
 * - Unlocks are unaffected: a pass on a peeked level opens the next, as any pass does.
 * - Progress badges follow the credited grades, so a capped level can't complete a mastered chapter. The Napkin
 *   Wizard is about estimates, made before building, and is unaffected.
 */
import { type Grade } from '@five-nines/sim';
import { gradeRank, isPassingGrade } from '../format.ts';
import type { BadgeId } from './badges.ts';

/** The best a peeked level can be credited. */
export const PEEK_GRADE_CAP: Grade = 'pass';

/** What a run is credited: its grade, capped at a pass on a peeked level. */
export function creditedGrade(grade: Grade, peeked: boolean): Grade {
  return peeked && gradeRank(grade) > gradeRank(PEEK_GRADE_CAP) ? PEEK_GRADE_CAP : grade;
}

/** The badges a run is credited: none on a peeked level. */
export function creditedRunBadges(earned: readonly BadgeId[], peeked: boolean): readonly BadgeId[] {
  return peeked ? [] : earned;
}

/** Whether seeing the level's solution now would record a peek: only before the level is passed, and only once. */
export function peekCosts(best: Grade | undefined, peeked: boolean): boolean {
  return !peeked && !isPassingGrade(best);
}
