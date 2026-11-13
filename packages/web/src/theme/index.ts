/**
 * The game's art style, chosen statically: the one place that names a theme. Everything outside `theme/` imports
 * the slots from here, so a new art style is a new folder beside `notebook/` and a change to the import below.
 */
import type { FailureReason, Level, SimEvent } from '@five-nines/sim';
import type { Theme } from './contract.ts';
import { notebookTheme } from './notebook/index.ts';
import * as situations from './situations.ts';

export const theme: Theme = notebookTheme;

export const { Shell, cast, CastLine, words, ComponentArt, BudgetMeter, PostmortemCard, GradeCard, CampaignMap, marks } =
  theme;

export type * from './contract.ts';
export { checkSummary, verdictFor } from './situations.ts';

/** The mentor's hint for a failure reason, or the sign-off when there's none. */
export const mentorHint = (reason: FailureReason | null | undefined): string => situations.mentorHint(reason, cast);

/** The troublemaker's tease for a level, or null when the level has no stress to tease. */
export const troublemakerTease = (level: Level): string | null => situations.troublemakerTease(level, cast);

/** How an event reads on the timeline and in the postmortem: crashes are credited to the troublemaker. */
export const eventCaption = (event: SimEvent) => situations.eventCaption(event, cast);
