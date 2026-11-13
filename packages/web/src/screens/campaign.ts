/** The campaign's state for screens: best grades, what's open, and where the player is. */
import { CHAPTERS, LEVELS, type Grade } from '@five-nines/sim';
import { useMemo } from 'react';
import {
  chapterAccess,
  devUnlockAll,
  levelAccess,
  nextUpLevelId,
  ninesTotal,
  type ChapterAccess,
  type LevelAccess,
  type NinesTotal,
} from '../progression/index.ts';
import { useBestGrades } from '../state/index.ts';

/** Read once: the address's query string doesn't change while the game runs (routes live in the hash). */
export const UNLOCK_ALL = devUnlockAll();

export interface CampaignState {
  best: Readonly<Record<string, Grade>>;
  nines: NinesTotal;
  access: Readonly<Record<string, LevelAccess>>;
  chapterAccess: Readonly<Record<string, ChapterAccess>>;
  /** Index into `LEVELS` of the first level not passed, or null when every level is passed. */
  nextUp: number | null;
}

export function campaignState(best: Readonly<Record<string, Grade>>, unlockAll = UNLOCK_ALL): CampaignState {
  const progress = { best, unlockAll };
  const next = nextUpLevelId(CHAPTERS, best);
  return {
    best,
    nines: ninesTotal(
      LEVELS.map((level) => level.id),
      best,
    ),
    access: Object.fromEntries(LEVELS.map((level) => [level.id, levelAccess(CHAPTERS, progress, level.id)])),
    chapterAccess: Object.fromEntries(CHAPTERS.map((chapter) => [chapter.id, chapterAccess(CHAPTERS, progress, chapter.id)])),
    nextUp: next === null ? null : LEVELS.findIndex((level) => level.id === next),
  };
}

export function useCampaign(): CampaignState {
  const best = useBestGrades();
  return useMemo(() => campaignState(best), [best]);
}

/** Whether a level may be opened now. */
export function useLevelAccess(levelId: string): LevelAccess {
  return useCampaign().access[levelId] ?? { kind: 'open' };
}
