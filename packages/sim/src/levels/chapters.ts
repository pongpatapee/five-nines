/**
 * The campaign: levels grouped into chapters that follow the story arc in docs/design.md and
 * docs/story/everything-labs.md, a company growing from its first server to worldwide. Chapters with no levels yet
 * are planned ones, shown as "coming soon".
 */
import { LEVELS } from './index.ts';

export interface Chapter {
  id: string;
  title: string;
  /** Level ids in play order. Empty for a chapter that isn't written yet. */
  levelIds: readonly string[];
  /**
   * The chapter's capstone: its launch-day level, which puts the chapter's lessons together in one product. Always its
   * last level. Unset while the chapter has none yet.
   */
  capstoneId?: string;
}

export const CHAPTERS: readonly Chapter[] = checkChapters([
  {
    id: 'getting-online',
    title: 'Getting Online',
    levelIds: ['01-hello-traffic', '02-scale-out', '03-pull-the-plug', '11-everything-links'],
    capstoneId: '11-everything-links',
  },
  {
    id: 'growing-pains',
    title: 'Growing Pains',
    levelIds: ['04-read-all-about-it', '05-cache-miss', '06-bank-balance'],
  },
  {
    id: 'hypergrowth',
    title: 'Hypergrowth',
    levelIds: ['07-the-write-wall', '08-thundering-herd', '09-stale-prices', '10-flash-sale'],
  },
  { id: 'worldwide', title: 'Worldwide', levelIds: [] },
]);

/** Whether a chapter has playable levels. */
export function isWritten(chapter: Chapter): boolean {
  return chapter.levelIds.length > 0;
}

/** Whether a level is its chapter's capstone. */
export function isCapstone(chapters: readonly Chapter[], levelId: string): boolean {
  return chapters.some((chapter) => chapter.capstoneId === levelId);
}

/**
 * Checked at import, like the levels: the written chapters come first and cover every level exactly once, in play
 * order, and a capstone is its chapter's last level.
 */
function checkChapters(chapters: Chapter[]): Chapter[] {
  const written = chapters.filter(isWritten);
  if (chapters.slice(0, written.length).some((chapter) => !isWritten(chapter))) {
    throw new Error('Chapters: planned chapters must come after every written one.');
  }
  const covered = written.flatMap((chapter) => chapter.levelIds).join(',');
  const levels = LEVELS.map((level) => level.id).join(',');
  if (covered !== levels) {
    throw new Error(`Chapters must list every level once, in play order. Chapters: ${covered}. Levels: ${levels}.`);
  }
  for (const chapter of chapters) {
    if (chapter.capstoneId !== undefined && chapter.capstoneId !== chapter.levelIds.at(-1)) {
      throw new Error(`Chapter ${chapter.id}: its capstone must be its last level.`);
    }
  }
  return chapters;
}
