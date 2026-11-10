/**
 * The contents page as a campaign map: which levels exist, how many nines each has earned and where the player is.
 * Pure, so the map component only lays things out.
 */
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
 * The page to play next: the first level not yet passed. Null once every level is passed (the player can still
 * replay any of them for more nines).
 */
export function nextUpIndex(levelIds: readonly string[], best: Readonly<Record<string, Grade>>): number | null {
  const index = levelIds.findIndex((id) => !isPassingGrade(best[id]));
  return index === -1 ? null : index;
}

/** Chapters that aren't written yet. Shown as locked "coming soon" pages: titles only, nothing playable. */
export const FUTURE_CHAPTERS: readonly { title: string; wash: 'blue' | 'peach' | 'pink' }[] = [
  { title: 'Remember Things', wash: 'blue' },
  { title: 'Split It Up', wash: 'peach' },
  { title: 'The Big Leagues', wash: 'pink' },
];

/** The chapter every current level belongs to. */
export const FIRST_CHAPTER_TITLE = 'Getting Traffic In';

/*
 * Map geometry, in the map's SVG user units (viewBox 880 × 760). The trail runs through chapter 1's real levels, then
 * on through the locked chapters' placeholder pages. Add a slot (and a trail segment) when adding a level.
 */
export const MAP_SIZE = { width: 880, height: 760 } as const;

export interface XYPoint {
  x: number;
  y: number;
}

/** Where each real level sits, in order. */
export const LEVEL_SLOTS: readonly XYPoint[] = [
  { x: 90, y: 150 },
  { x: 250, y: 110 },
  { x: 420, y: 180 },
];

/** `TRAIL_SEGMENTS[i]` runs from level slot i to slot i + 1; the last one continues into the locked chapters. */
export const TRAIL_SEGMENTS: readonly string[] = [
  'M90,150 C150,110 190,100 250,110',
  'M250,110 C320,120 350,170 420,180',
  'M420,180 C500,190 540,120 610,120 C690,120 740,140 790,170 C840,210 820,300 760,330 C700,360 650,300 590,300 C520,300 490,370 420,370 C350,370 320,320 250,320 C180,320 120,360 90,420 C60,480 110,560 170,590 C250,630 340,640 420,640 C520,640 600,600 690,580',
];

/** Placeholder pages for the chapters that aren't written yet, in `FUTURE_CHAPTERS` order. */
export const LOCKED_CHAPTER_LAYOUT: readonly {
  label: XYPoint;
  tilt: number;
  /** Where the "coming soon" note goes. */
  note: XYPoint;
  pages: readonly XYPoint[];
}[] = [
  { label: { x: 600, y: 30 }, tilt: 1, note: { x: 660, y: 80 }, pages: [{ x: 610, y: 120 }, { x: 790, y: 170 }, { x: 760, y: 330 }] },
  { label: { x: 552, y: 228 }, tilt: -1, note: { x: 640, y: 290 }, pages: [{ x: 590, y: 300 }, { x: 420, y: 370 }, { x: 250, y: 320 }] },
  { label: { x: 222, y: 500 }, tilt: 1, note: { x: 230, y: 548 }, pages: [{ x: 90, y: 420 }, { x: 170, y: 590 }, { x: 420, y: 640 }] },
];

/** The finale page at the end of the trail (locked). */
export const FINALE_SLOT: XYPoint = { x: 690, y: 580 };
