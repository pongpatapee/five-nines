/**
 * Which levels the player may open (docs/design.md, "Progression"). Pure.
 *
 * - A level opens when the level before it (in play order) is passed.
 * - A chapter opens once the player holds enough nines in total (`CHAPTER_UNLOCK_NINES`). Its first level also needs
 *   the previous chapter's last level passed, like any other level.
 * - A level the player already has a grade on stays open, whatever else is true. Saves from builds where every level
 *   was open keep everything they played, and changing a threshold later can never lock a player out of their work.
 * - `unlockAll` (the developer escape hatch, `?unlock=all`) opens everything.
 */
import { isWritten, type Chapter, type Grade } from '@five-nines/sim';
import { isPassingGrade } from '../format.ts';
import { ninesTotal } from './nines.ts';

/**
 * Nines needed to open each chapter, by chapter id. A pass on every level pays 3 each, so the bar asks for a few
 * stars or masteries on top: chapter 1 pays at most 15 (9 for passes), chapters 1–2 at most 30 (18), chapters 1–3 at
 * most 50 (30).
 *
 * - Getting Online: open from the start.
 * - Growing Pains: 10, every chapter 1 page passed plus one star.
 * - Hypergrowth: 22, every page so far passed plus four tiers above a pass.
 * - Worldwide: 36, every page so far passed plus six tiers above a pass.
 */
export const CHAPTER_UNLOCK_NINES: Readonly<Record<string, number>> = {
  'getting-online': 0,
  'growing-pains': 10,
  hypergrowth: 22,
  worldwide: 36,
};

export interface Progress {
  best: Readonly<Record<string, Grade>>;
  /** Open everything (the developer escape hatch). */
  unlockAll?: boolean;
}

/** Why a level is closed, or that it's open. */
export type LevelAccess =
  | { kind: 'open' }
  /** Pass `levelId` first. */
  | { kind: 'previousLevel'; levelId: string }
  /** The level's chapter needs `needed` nines; the player holds `have`. */
  | { kind: 'chapter'; chapterId: string; needed: number; have: number };

export type ChapterAccess = { kind: 'open' } | { kind: 'locked'; needed: number; have: number };

/** Nines a chapter asks for. Unknown chapters (a chapter added without a threshold) ask for none. */
export function chapterThreshold(chapterId: string): number {
  return CHAPTER_UNLOCK_NINES[chapterId] ?? 0;
}

/** Every written chapter's levels, in play order. */
function playOrder(chapters: readonly Chapter[]): string[] {
  return chapters.filter(isWritten).flatMap((chapter) => chapter.levelIds);
}

/** Whether the player holds enough nines for a chapter. Ignores the levels inside it. */
export function chapterAccess(chapters: readonly Chapter[], progress: Progress, chapterId: string): ChapterAccess {
  const needed = chapterThreshold(chapterId);
  const have = ninesTotal(playOrder(chapters), progress.best).earned;
  return progress.unlockAll || have >= needed ? { kind: 'open' } : { kind: 'locked', needed, have };
}

export function levelAccess(chapters: readonly Chapter[], progress: Progress, levelId: string): LevelAccess {
  const order = playOrder(chapters);
  const index = order.indexOf(levelId);
  if (progress.unlockAll || index === -1 || progress.best[levelId] !== undefined) return { kind: 'open' };

  const previous = order[index - 1];
  if (previous !== undefined && !isPassingGrade(progress.best[previous])) {
    return { kind: 'previousLevel', levelId: previous };
  }
  const chapter = chapters.find((c) => c.levelIds.includes(levelId))!;
  const access = chapterAccess(chapters, progress, chapter.id);
  if (access.kind === 'locked') return { kind: 'chapter', chapterId: chapter.id, needed: access.needed, have: access.have };
  return { kind: 'open' };
}

export function isLevelOpen(chapters: readonly Chapter[], progress: Progress, levelId: string): boolean {
  return levelAccess(chapters, progress, levelId).kind === 'open';
}

/** Ids of the chapters the player holds enough nines for. */
export function openChapterIds(chapters: readonly Chapter[], progress: Progress): string[] {
  return chapters.filter((chapter) => chapterAccess(chapters, progress, chapter.id).kind === 'open').map((c) => c.id);
}

/**
 * The level to play next: the first level not yet passed, open or not (the map shows why it's closed). Null once every
 * level is passed; the player can still replay any of them for more nines.
 */
export function nextUpLevelId(chapters: readonly Chapter[], best: Readonly<Record<string, Grade>>): string | null {
  return playOrder(chapters).find((id) => !isPassingGrade(best[id])) ?? null;
}
