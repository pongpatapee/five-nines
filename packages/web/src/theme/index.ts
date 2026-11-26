/**
 * The game's art style, chosen statically: the one place that names a theme. Everything outside `theme/` imports
 * the slots from here, so a new art style is a new folder beside `notebook/` and a change to the import below.
 */
import type { FailureReason, Level, SimEvent } from '@five-nines/sim';
import type { Theme } from './contract.ts';
import { notebookTheme } from './notebook/index.ts';
import * as situations from './situations.ts';

export const theme: Theme = notebookTheme;

export const {
  Shell,
  cast,
  story,
  TitlePage,
  AllHands,
  BriefingCard,
  CastLine,
  words,
  componentNames,
  ComponentArt,
  BudgetMeter,
  PostmortemCard,
  NapkinWorking,
  numbersText,
  NumbersBox,
  FieldGuide,
  fieldGuide,
  GradeCard,
  HintLadderView,
  CampaignMap,
  UtilizationGauge,
  BadgeShelf,
  marks,
} = theme;

export type * from './contract.ts';
export {
  checkSummary,
  designComparison,
  failoverSituation,
  failureStory,
  hottestShard,
  latencyAt,
  latencyWorthNoting,
  LEVEL_TRAPS,
  levelTrap,
  lockSituation,
  recentStrikes,
  savingsSituation,
  STRIKE_NOTE_SEC,
  verdictFor,
  worstLatency,
  type DesignComparison,
  type FailoverSituation,
  type FailureStory,
  type HintLadder,
  type LatencySituation,
  type LevelTrap,
  type LockSituation,
  type SavingsSituation,
  type Strike,
} from './situations.ts';

/** The mentor's hint for a failure reason, or the sign-off when there's none. */
export const mentorHint = (reason: FailureReason | null | undefined): string => situations.mentorHint(reason, cast);

/** The troublemaker's tease for a level, or null when the level has no stress to tease. */
export const troublemakerTease = (level: Level): string | null => situations.troublemakerTease(level, cast);

/** How an event reads on the timeline and in the postmortem: crashes are credited to the troublemaker. */
export const eventCaption = (event: SimEvent) => situations.eventCaption(event, cast);

/** The mentor's hint ladder for a failed run. */
export const hintLadder = (level: Level, story: situations.FailureStory) => situations.hintLadder(level, story, cast);

/** The mentor's hint ladder before any failed run, about the level's main trap. Null for a level without one. */
export const levelHintLadder = (level: Level) => situations.levelHintLadder(level, cast);
