/**
 * Promotions (docs/story/everything-labs.md, "The promotion ladder"): one per chapter, handed out when the chapter's
 * launch ships. Derived from saved best grades, so nothing new is saved and old saves get the titles they earned.
 * Pure; the theme names the titles and words the moment.
 */
import { isWritten, type Chapter, type Grade } from '@five-nines/sim';
import { isPassingGrade } from '../format.ts';

/**
 * THE PROMOTION RULE. A chapter's promotion is earned by passing its capstone (`capstoneId` in the sim's
 * chapters.ts). A chapter without a capstone yet promotes on passing its last level instead. So giving a chapter a
 * capstone moves its promotion there with a data change, and no code change.
 */
export function promotionLevelId(chapter: Chapter): string | null {
  return chapter.capstoneId ?? chapter.levelIds.at(-1) ?? null;
}

/** The chapters whose promotion the player has earned, in campaign order. */
export function earnedPromotionIds(chapters: readonly Chapter[], best: Readonly<Record<string, Grade>>): string[] {
  return chapters
    .filter(isWritten)
    .filter((chapter) => {
      const levelId = promotionLevelId(chapter);
      return levelId !== null && isPassingGrade(best[levelId]);
    })
    .map((chapter) => chapter.id);
}

/** The latest promotion earned, by chapter id: the player's current title. Null before the first one. */
export function currentPromotionId(chapters: readonly Chapter[], best: Readonly<Record<string, Grade>>): string | null {
  return earnedPromotionIds(chapters, best).at(-1) ?? null;
}
