/**
 * The contents page as a campaign map: which levels exist, how many nines each has earned and where the player is.
 * Pure, so the map component only lays things out.
 */
import { CHAPTERS, isWritten, type Grade } from '@five-nines/sim';
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
 * The page to play next: the first level not yet passed. Null once every level is passed (the player can still
 * replay any of them for more nines).
 */
export function nextUpIndex(levelIds: readonly string[], best: Readonly<Record<string, Grade>>): number | null {
  const index = levelIds.findIndex((id) => !isPassingGrade(best[id]));
  return index === -1 ? null : index;
}

export type ChapterWash = 'green' | 'blue' | 'peach' | 'pink';

/** A chapter with real levels: its title, its pages (level ids, in play order) and where its label sits on the map. */
export interface WrittenChapter {
  title: string;
  wash: ChapterWash;
  levelIds: readonly string[];
  label: XYPoint;
  tilt: number;
}

/*
 * Map geometry, in the map's SVG user units (viewBox 880 × 760). The trail runs through the written chapters' levels,
 * then on through the locked chapters' placeholder pages. Add a slot (and a trail segment) when adding a level.
 */
export const MAP_SIZE = { width: 880, height: 760 } as const;

export interface XYPoint {
  x: number;
  y: number;
}

/** Where each chapter's label sits on the map and how it's washed, in `CHAPTERS` order. */
const CHAPTER_LABELS: readonly { wash: ChapterWash; label: XYPoint; tilt: number }[] = [
  { wash: 'green', label: { x: 22, y: 30 }, tilt: -1 },
  { wash: 'blue', label: { x: 560, y: 30 }, tilt: 1 },
  { wash: 'peach', label: { x: 290, y: 280 }, tilt: -1 },
  { wash: 'pink', label: { x: 222, y: 520 }, tilt: 1 },
];

/** The chapters that exist, in order. Every level belongs to exactly one, and they cover `LEVELS` in order. */
export const WRITTEN_CHAPTERS: readonly WrittenChapter[] = CHAPTERS.filter(isWritten).map((chapter, c) => ({
  title: chapter.title,
  levelIds: chapter.levelIds,
  ...CHAPTER_LABELS[c]!,
}));

/** Chapters that aren't written yet. Shown as locked "coming soon" pages: titles only, nothing playable. */
export const FUTURE_CHAPTERS: readonly { title: string; wash: ChapterWash }[] = CHAPTERS.filter(
  (chapter) => !isWritten(chapter),
).map((chapter, c) => ({ title: chapter.title, wash: CHAPTER_LABELS[WRITTEN_CHAPTERS.length + c]!.wash }));

/** The chapter label's width for a title, in map units. */
export function chapterLabelWidth(title: string): number {
  return 84 + title.length * 13;
}

/** Where each real level sits, in play order. */
export const LEVEL_SLOTS: readonly XYPoint[] = [
  { x: 90, y: 150 },
  { x: 250, y: 110 },
  { x: 420, y: 180 },
  { x: 610, y: 130 },
  { x: 790, y: 180 },
  { x: 760, y: 400 },
];

/** `TRAIL_SEGMENTS[i]` runs from level slot i to slot i + 1; the last one continues into the locked chapters. */
export const TRAIL_SEGMENTS: readonly string[] = [
  'M90,150 C150,110 190,100 250,110',
  'M250,110 C320,120 350,170 420,180',
  'M420,180 C500,190 540,130 610,130',
  'M610,130 C690,130 740,150 790,180',
  'M790,180 C850,230 840,360 760,400',
  'M760,400 C700,430 650,350 590,350 C520,350 490,420 420,420 C350,420 320,370 250,370 C180,370 120,400 100,450 C80,510 110,570 170,600 C250,640 340,650 420,650 C500,650 560,640 640,640',
];

/** Placeholder pages for the chapters that aren't written yet, in `FUTURE_CHAPTERS` order. */
export const LOCKED_CHAPTER_LAYOUT: readonly {
  label: XYPoint;
  tilt: number;
  /** Where the "coming soon" note goes. */
  note: XYPoint;
  pages: readonly XYPoint[];
}[] = [
  { label: CHAPTER_LABELS[2]!.label, tilt: -1, note: { x: 455, y: 336 }, pages: [{ x: 590, y: 350 }, { x: 420, y: 420 }, { x: 250, y: 370 }] },
  { label: CHAPTER_LABELS[3]!.label, tilt: 1, note: { x: 238, y: 566 }, pages: [{ x: 100, y: 450 }, { x: 170, y: 600 }, { x: 420, y: 650 }] },
];

/** The finale page at the end of the trail (locked). */
export const FINALE_SLOT: XYPoint = { x: 640, y: 640 };
