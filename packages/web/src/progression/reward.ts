/**
 * What a graded run paid out, worked out by comparing the progress before and after recording it. Pure, so the
 * results screen can show exactly what changed: nines ticking up, new badges stamped, chapters opened.
 */
import { isWritten, type Chapter, type Grade } from '@five-nines/sim';
import { gradeRank } from '../format.ts';
import { BADGE_IDS, type BadgeId } from './badges.ts';
import { ninesForGrade, ninesTotal } from './nines.ts';
import { openChapterIds } from './unlocks.ts';

/** Where a badge was earned: the level whose run or estimate earned it, or null when it came with an old save. */
export interface BadgeRecord {
  levelId: string | null;
}

export type EarnedBadges = Readonly<Partial<Record<BadgeId, BadgeRecord>>>;

export interface ProgressFacts {
  best: Readonly<Record<string, Grade>>;
  badges: EarnedBadges;
}

export interface RunReward {
  levelId: string;
  /** The level's payout before and after the run (its best grade's nines). */
  levelNines: { before: number; after: number };
  /** Nines held across every level, before and after, and the most there are. */
  totalNines: { before: number; after: number; total: number };
  /** Badges this run earned for the first time, in `BADGE_IDS` order. */
  newBadges: BadgeId[];
  /** Chapters this run opened (by nines), in campaign order. */
  openedChapterIds: string[];
  /** The level's solution was seen before passing, and this run was credited less than it earned (progression/peek.ts). */
  capped: boolean;
}

/** The best of two grades: a worse run never lowers what the level has paid. */
export function bestOf(previous: Grade | undefined, grade: Grade): Grade {
  return previous !== undefined && gradeRank(previous) >= gradeRank(grade) ? previous : grade;
}

/** Adds the badges in `earned` that aren't held yet, crediting `levelId`. Returns the same object when nothing is new. */
export function awardBadges(badges: EarnedBadges, earned: readonly BadgeId[], levelId: string | null): EarnedBadges {
  const fresh = earned.filter((id) => badges[id] === undefined);
  if (fresh.length === 0) return badges;
  const next: Partial<Record<BadgeId, BadgeRecord>> = { ...badges };
  for (const id of fresh) next[id] = { levelId };
  return next;
}

export function runReward(chapters: readonly Chapter[], levelId: string, before: ProgressFacts, after: ProgressFacts): RunReward {
  const levelIds = chapters.filter(isWritten).flatMap((chapter) => chapter.levelIds);
  const totalBefore = ninesTotal(levelIds, before.best);
  const openBefore = new Set(openChapterIds(chapters, { best: before.best }));
  return {
    levelId,
    levelNines: { before: ninesForGrade(before.best[levelId]), after: ninesForGrade(after.best[levelId]) },
    totalNines: { before: totalBefore.earned, after: ninesTotal(levelIds, after.best).earned, total: totalBefore.total },
    newBadges: BADGE_IDS.filter((id) => before.badges[id] === undefined && after.badges[id] !== undefined),
    openedChapterIds: openChapterIds(chapters, { best: after.best }).filter((id) => !openBefore.has(id)),
    capped: false,
  };
}
