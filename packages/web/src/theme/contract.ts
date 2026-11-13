/**
 * The contract between the game and an art style. The game asks for things by role or slot (the mentor's hint for a
 * failure reason, the budget meter, the campaign map); a theme supplies the names, portraits, wording, widgets and
 * stylesheets. Screens import only from `theme/index.ts`, never from a theme's folder.
 *
 * Besides this interface, a theme's stylesheets style the class names the game's components render and define the
 * semantic tokens they use (`--text`, `--surface-1`, `--healthy`, `--request`, `--write`, `--failing`, `--edge-color`,
 * `--grid-minor`, `--grid-major`, …).
 */
import type { Chapter, ComponentKind, FailureCause, FailureReason, Grade, Level, SimEvent } from '@five-nines/sim';
import type { ComponentType, ReactNode, Ref } from 'react';
import type { GradedEvaluation } from '../engine/index.ts';
import type { BudgetUsage } from '../playback/series.ts';
import type { CheckSummary, LevelStress, Verdict } from './situations.ts';

// ---------------------------------------------------------------------------- the cast

/** The characters, by what they do in the game (docs/design.md, "Art direction"). */
export type CastRole = 'boss' | 'mentor' | 'troublemaker';

/** How a character looks while saying a line. Each theme draws these its own way. */
export type CastMood = 'neutral' | 'pleased' | 'concerned';

export interface CastMember {
  /** "Erasmus". */
  name: string;
  /** What they are, under the name: "mentor". */
  title: string;
}

/** Everything the cast says. Each line is a function of a situation the game derived from real data. */
export interface CastScript {
  members: Readonly<Record<CastRole, CastMember>>;
  /** The boss sets the bar in the briefing. */
  bossBrief(level: Level): string;
  /** The boss's reaction to a graded run: a short exclamation and a line. */
  bossVerdict(verdict: Verdict): { exclaim: string; line: string };
  /** The troublemaker's heads-up about the level's stress. */
  troublemakerTease(stress: LevelStress): string;
  /** A crash, credited to the troublemaker on the timeline and in the postmortem's event log. */
  troublemakerCrash(nodeId: string, instance: number): string;
  /** The mentor's nudge for each failure reason: points at the fix without giving it away. */
  mentorHints: Readonly<Record<FailureReason, string>>;
  /** The mentor's line when there's nothing specific to say. */
  mentorSignOff: string;
  /** The mentor's standing advice beside the campaign map. */
  mentorWelcome: string;
  /** The mentor's lead-in above the postmortem hint. */
  mentorPostmortemLead: string;
  /** The mentor's take on the design checks. */
  mentorChecks(summary: CheckSummary): string;
}

export interface CastLineProps {
  role: CastRole;
  children: ReactNode;
  /** A lead-in above the line, e.g. the boss's exclamation. */
  lead?: ReactNode;
  /** Figure size in px. */
  size?: number;
  mood?: CastMood;
  /** `alarm` marks the lead-in as bad news. */
  tone?: 'note' | 'alarm';
  className?: string;
}

// ---------------------------------------------------------------------------- copy

/** The theme's words for the game's places and things. */
export interface ThemeWords {
  /** What a level is called, lower case: "page". */
  level: string;
  /** A level's short label in headings: "p.3". */
  levelShort(levelNumber: number): string;
  /** The level select screen, short and long: "contents", "table of contents". */
  home: string;
  homeLong: string;
  /** The line under the wordmark. */
  tagline: string;
}

// ---------------------------------------------------------------------------- widgets

export interface ComponentArtProps {
  kind: ComponentKind | 'clients';
  size?: number;
}

export interface BudgetMeterProps {
  usage: BudgetUsage;
}

export interface PostmortemCardProps {
  /** The engine's `errorBudgetExhaustedAtSec`. */
  exhaustedAtSec: number;
  /** The first cause by the freeze, if any. */
  rootCause: FailureCause | undefined;
  /** Later causes by the freeze, in order of onset. */
  knockOn: readonly FailureCause[];
  /** Events by the freeze. */
  events: readonly SimEvent[];
  /** Availability of the requests up to the freeze. */
  availability: number;
  onKeepWatching(): void;
  onSeeResults(): void;
  /** The card's element, so playback can keep the root-cause node out from under it. */
  ref?: Ref<HTMLElement>;
}

export interface GradeCardProps {
  level: Level;
  /** 1-based, for the heading. */
  levelNumber: number;
  evaluation: GradedEvaluation;
  onBackToEditor(): void;
  onReplay(): void;
  onShowDebrief(): void;
  /** Null when there's no next level or this attempt didn't pass. */
  onNextLevel: (() => void) | null;
}

export interface CampaignMapProps {
  /** Every chapter, written ones first. */
  chapters: readonly Chapter[];
  /** The levels, in play order. */
  levels: readonly Level[];
  best: Readonly<Record<string, Grade>>;
  /** Index of the level to play next, or null when all are passed. */
  nextUp: number | null;
}

export interface NinesProps {
  /** Earned nines, 0 to `total`. */
  filled: number;
  total: number;
  size?: 'sm' | 'md';
}

/** Small marks the game puts next to text. */
export interface ThemeMarks {
  /** Inside call-to-action buttons. Decorative. */
  Arrow: ComponentType<{ width?: number }>;
  /** Before a requirement still to meet. Decorative. */
  Checkbox: ComponentType;
  /** A requirement met or not. Labelled when `label` is given, otherwise decorative. */
  Met: ComponentType<{ label?: string }>;
  NotMet: ComponentType<{ label?: string; size?: number }>;
  /** Nines earned on a level. Labelled. */
  Nines: ComponentType<NinesProps>;
  /** Over the root-cause node on the freeze-frame. Decorative. */
  RootCause: ComponentType;
}

export interface Theme {
  /** Wraps every screen. */
  Shell: ComponentType<{ children: ReactNode }>;
  cast: CastScript;
  /** A character saying a line. Must name the speaker in text. */
  CastLine: ComponentType<CastLineProps>;
  words: ThemeWords;
  /** Art for each component kind, on the palette and the canvas nodes. Decorative. */
  ComponentArt: ComponentType<ComponentArtProps>;
  /** The error budget during playback. */
  BudgetMeter: ComponentType<BudgetMeterProps>;
  /** The incident postmortem on the freeze-frame. */
  PostmortemCard: ComponentType<PostmortemCardProps>;
  /** The graded result. */
  GradeCard: ComponentType<GradeCardProps>;
  /** The campaign on the level select screen. */
  CampaignMap: ComponentType<CampaignMapProps>;
  marks: ThemeMarks;
}
