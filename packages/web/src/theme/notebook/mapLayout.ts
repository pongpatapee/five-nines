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

/** Where each real level sits, in play order. A chapter's capstone (its last stop) is drawn larger. */
export const LEVEL_SLOTS: readonly XYPoint[] = [
  { x: 80, y: 160 },
  { x: 220, y: 110 },
  { x: 360, y: 175 },
  { x: 510, y: 130 },
  { x: 665, y: 180 },
  { x: 805, y: 225 },
  { x: 770, y: 410 },
  { x: 610, y: 360 },
  { x: 450, y: 420 },
  { x: 290, y: 370 },
  { x: 120, y: 430 },
];

/** `TRAIL_SEGMENTS[i]` runs from level slot i to slot i + 1; the last one continues into the planned chapters. */
export const TRAIL_SEGMENTS: readonly string[] = [
  'M80,160 C130,120 170,100 220,110',
  'M220,110 C290,120 300,170 360,175',
  'M360,175 C430,180 450,130 510,130',
  'M510,130 C580,130 610,175 665,180',
  'M665,180 C725,185 775,195 805,225',
  'M805,225 C855,280 845,370 770,410',
  'M770,410 C710,440 660,360 610,360',
  'M610,360 C550,360 510,420 450,420',
  'M450,420 C380,420 350,370 290,370',
  'M290,370 C210,370 140,380 120,430',
  'M120,430 C100,530 180,595 260,595 C330,595 350,650 420,650 C470,650 490,610 530,610 C580,610 600,640 640,640',
];

/** Placeholder pages for the planned chapters, in order: where the "coming soon" note and the locked pages go. */
export const PLANNED_CHAPTER_PAGES: readonly { note: XYPoint; pages: readonly XYPoint[] }[] = [
  { note: { x: 298, y: 578 }, pages: [{ x: 260, y: 595 }, { x: 420, y: 650 }, { x: 530, y: 610 }] },
];

/** The finale page at the end of the trail (locked). */
export const FINALE_SLOT: XYPoint = { x: 640, y: 640 };
