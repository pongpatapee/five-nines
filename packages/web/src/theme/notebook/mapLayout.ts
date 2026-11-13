/**
 * The campaign map's geometry, in the map's SVG user units (viewBox 880 × 760). The trail runs through the written
 * chapters' levels, then on through the planned chapters' placeholder pages. Hand-placed: add a level slot (and a
 * trail segment) when adding a level, and a chapter label when adding a chapter. Tests check the counts.
 */
export const MAP_SIZE = { width: 880, height: 760 } as const;

export interface XYPoint {
  x: number;
  y: number;
}

export type ChapterWash = 'green' | 'blue' | 'peach' | 'pink';

/** Where each chapter's label sits on the map and how it's washed, in `CHAPTERS` order. */
export const CHAPTER_LABELS: readonly { wash: ChapterWash; at: XYPoint; tilt: number }[] = [
  { wash: 'green', at: { x: 22, y: 30 }, tilt: -1 },
  { wash: 'blue', at: { x: 560, y: 30 }, tilt: 1 },
  { wash: 'peach', at: { x: 290, y: 280 }, tilt: -1 },
  { wash: 'pink', at: { x: 222, y: 520 }, tilt: 1 },
];

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

/** `TRAIL_SEGMENTS[i]` runs from level slot i to slot i + 1; the last one continues into the planned chapters. */
export const TRAIL_SEGMENTS: readonly string[] = [
  'M90,150 C150,110 190,100 250,110',
  'M250,110 C320,120 350,170 420,180',
  'M420,180 C500,190 540,130 610,130',
  'M610,130 C690,130 740,150 790,180',
  'M790,180 C850,230 840,360 760,400',
  'M760,400 C700,430 650,350 590,350 C520,350 490,420 420,420 C350,420 320,370 250,370 C180,370 120,400 100,450 C80,510 110,570 170,600 C250,640 340,650 420,650 C500,650 560,640 640,640',
];

/** Placeholder pages for the planned chapters, in order: where the "coming soon" note and the locked pages go. */
export const PLANNED_CHAPTER_PAGES: readonly { note: XYPoint; pages: readonly XYPoint[] }[] = [
  { note: { x: 455, y: 336 }, pages: [{ x: 590, y: 350 }, { x: 420, y: 420 }, { x: 250, y: 370 }] },
  { note: { x: 238, y: 566 }, pages: [{ x: 100, y: 450 }, { x: 170, y: 600 }, { x: 420, y: 650 }] },
];

/** The finale page at the end of the trail (locked). */
export const FINALE_SLOT: XYPoint = { x: 640, y: 640 };
