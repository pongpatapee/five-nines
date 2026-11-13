/** Campaign progress on the level select screen: nines earned and where the player is. Pure. */
import type { Grade } from '@five-nines/sim';
import { isPassingGrade } from '../format.ts';
import { ninesForGrade, NINES_PER_LEVEL } from '../results/grading.ts';

export { ninesForGrade, NINES_PER_LEVEL };

export interface CampaignProgress {
  earned: number;
  total: number;
}

export function campaignProgress(
  levelIds: readonly string[],
  best: Readonly<Record<string, Grade>>,
): CampaignProgress {
  const earned = levelIds.reduce((sum, id) => sum + ninesForGrade(best[id]), 0);
  return { earned, total: levelIds.length * NINES_PER_LEVEL };
}

/**
 * The level to play next: the first level not yet passed. Null once every level is passed (the player can still
 * replay any of them for more nines).
 */
export function nextUpIndex(levelIds: readonly string[], best: Readonly<Record<string, Grade>>): number | null {
  const index = levelIds.findIndex((id) => !isPassingGrade(best[id]));
  return index === -1 ? null : index;
}
