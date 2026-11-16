/**
 * The contract between the game and an art style. The game asks for things by role or slot (the mentor's hint for a
 * failure reason, the budget meter, the campaign map); a theme supplies the names, portraits, wording, widgets and
 * stylesheets. Screens import only from `theme/index.ts`, never from a theme's folder.
 *
 * Besides this interface, a theme's stylesheets style the class names the game's components render and define the
 * semantic tokens they use (`--text`, `--surface-1`, `--healthy`, `--request`, `--write`, `--failing`, `--edge-color`,
 * `--grid-minor`, `--grid-major`, …).
 */
import type {
  Chapter,
  ComponentKind,
  EstimateWorking,
  FailureCause,
  FailureReason,
  Grade,
  Level,
  LevelNumbers,
  NapkinSolution,
  SimEvent,
} from '@five-nines/sim';
import type { ComponentType, ReactNode, Ref } from 'react';
import type { GradedEvaluation } from '../engine/index.ts';
import type { ConceptId, GuideEntryId, SpecTable } from '../guide/guide.ts';
import type { BudgetUsage } from '../playback/series.ts';
import type { BadgeId, ChapterAccess, EarnedBadges, LevelAccess, RunReward } from '../progression/index.ts';
import type { RevealState } from '../results/reveal.ts';
import type {
  CheckSummary,
  LockSituation,
  SavingsSituation,
  FailoverSituation,
  FailureStory,
  HintLadder,
  HintStep,
  HintTopic,
  LatencySituation,
  LevelStress,
  Verdict,
} from './situations.ts';

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
  /** A cache restart, credited to the troublemaker the same way. */
  troublemakerCacheRestart(nodeId: string): string;
  /** A hot key, credited to the troublemaker: `label` is what turned hot, as the level words it. */
  troublemakerHotKey(label: string): string;
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
  /** The mentor's hint ladder for a failed run (docs/design.md, "Hints and iteration"). */
  mentorLadder: MentorLadderScript;
  /** The mentor on why p99 is where it is, quoting the numbers. */
  mentorLatency(situation: LatencySituation): string;
  /** The failover around a crash as a few short lines: when it died, when the balancer noticed, what it cost. */
  failoverLines(situation: FailoverSituation): string[];
  /** The napkin-maths step before building. */
  mentorEstimate: MentorEstimateScript;
  /** The boss on the money a design left under the budget: the second score. */
  bossSavings(situation: SavingsSituation): string;
  /** Every badge: its name, what earns it, and who hands it over with what line. */
  badges: Readonly<Record<BadgeId, BadgeCopy>>;
  /** Why a level is still closed, said by whoever would say it. */
  lockedLevel(situation: LockSituation): { role: CastRole; line: string };
  /** The line under the nines counter when a run opens a chapter. */
  chapterOpened(chapterNumber: number, title: string): string;
}

export interface BadgeCopy {
  name: string;
  /** What earns it, precisely enough to aim for. */
  how: string;
  /** Who hands it over, and what they say. */
  role: CastRole;
  line: string;
}

export interface MentorLadderScript {
  /** Where it broke, from the story's numbers. */
  where(story: FailureStory): string;
  /** Why, from the story's numbers. */
  why(story: FailureStory): string;
  /** The concept behind this kind of failure, in this level. Every level and topic must have one. */
  concept(levelId: string, topic: HintTopic): string;
  /** The change that fixes it, in this level, without handing over a whole design. */
  fix(levelId: string, topic: HintTopic): string;
  /** A heading for each rung. */
  stepLabels: Readonly<Record<HintStep, string>>;
  /** The button that reveals the next rung. */
  more: string;
}

export interface EstimateResult {
  guess: number;
  answer: number;
  /** Within the tolerance: earns the bonus mark. */
  close: boolean;
}

export interface MentorEstimateScript {
  /**
   * The question for this level's estimate, and the unit the answer is typed in ("vCPUs", "%"). Self-contained: with
   * the level's numbers beside it, it gives every number the working starts from (docs/design.md, "Estimate step").
   */
  ask(working: EstimateWorking, level: Level): { question: string; unit: string };
  /** The mentor's reaction to an answer. */
  verdict(result: EstimateResult): { exclaim: string; line: string };
  /** The mentor's lead-in to the working after the player skips the question. */
  skipped: { exclaim: string; line: string };
  /** The mentor's lead-in when the player comes back to read the working again. */
  review: { exclaim: string; line: string };
  /** The control that brings the working back later, from the briefing or the question. */
  revisit: string;
  /** The name of the bonus mark ("napkin bonus"). */
  bonus: string;
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

/** "The numbers", worded: groups of labelled values, and what will happen during the run (named, never timed). */
export interface NumbersText {
  title: string;
  groups: readonly { heading: string; rows: readonly { label: string; value: string }[] }[];
  during: { lead: string; items: readonly string[] } | null;
}

export interface NumbersBoxProps {
  /** The level's numbers (`@five-nines/sim`'s `levelNumbers`). */
  numbers: LevelNumbers;
  /** In the briefing's margin, or on the napkin-maths card. */
  variant: 'briefing' | 'card';
}

/** The field guide's fixed words; the entries' own copy is the theme's. */
export interface FieldGuideScript {
  title: string;
  /** The link from an inspector, a napkin working or a hint: "More in the field guide". */
  more: string;
  /** An entry's name, for links and the contents. */
  entryName(id: GuideEntryId): string;
}

export interface FieldGuideProps {
  /** The components the player has met, in the guide's order, each with its spec table from the catalog. */
  components: readonly { kind: ComponentKind; table: SpecTable }[];
  /** The concepts the player has met. */
  concepts: readonly ConceptId[];
  /** Entries still to meet: counted, never named. */
  unmet: number;
  /** The entry to open at, or null for the contents. */
  focus: GuideEntryId | null;
  onClose(): void;
}

export interface NapkinWorkingProps {
  /** The estimate worked step by step, with every number (`@five-nines/sim`'s `napkinSolution`). */
  solution: NapkinSolution;
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
  /** The failover around the run's crash, counted up to the freeze. Null when nothing crashed. */
  failover: FailoverSituation | null;
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
  /** The mentor's hints, when the run failed. */
  hints: HintLadder | null;
  /** The failover around the run's crash, over the whole run. Null when nothing crashed. */
  failover: FailoverSituation | null;
  onBackToEditor(): void;
  onReplay(): void;
  onShowDebrief(): void;
  /** Null when there's no next level or this attempt didn't pass. */
  onNextLevel: (() => void) | null;
  /** The run's payout, once recorded. */
  reward: RewardView | null;
  /** Money left under the budget, or null when over it. */
  savings: SavingsSituation | null;
  /** The player revealed another hint. */
  onHintRevealed?(): void;
}

export interface CampaignMapProps {
  /** Every chapter, written ones first. */
  chapters: readonly Chapter[];
  /** The levels, in play order. */
  levels: readonly Level[];
  best: Readonly<Record<string, Grade>>;
  /** Index of the level to play next, or null when all are passed. */
  nextUp: number | null;
  /** Whether each level (by id) is open, and if not, why. */
  access: Readonly<Record<string, LevelAccess>>;
  /** Whether each chapter (by id) has enough nines to open. */
  chapterAccess: Readonly<Record<string, ChapterAccess>>;
}

export interface BadgeShelfProps {
  earned: EarnedBadges;
  /** "p.3 · Pull the Plug", for where a badge was earned. */
  levelLabel(levelId: string): string;
}

/** What the grade card shows of a run's payout, as the reveal has got to so far. */
export interface RewardView {
  reward: RunReward;
  shown: RevealState;
  /** Chapters the run opened. */
  openedChapters: readonly { number: number; title: string }[];
}

/**
 * What a gauge's reading measures. Machines are busy; a queue's reading is its backlog against a limit: the share of
 * the deadline its oldest message waits (`deadline`), the share of its room the backlog fills (`room`), or whichever
 * is more when the gauge doesn't say (`backlog`).
 */
export type GaugeMeasure = 'busy' | 'deadline' | 'room' | 'backlog';

export interface UtilizationGaugeProps {
  /** Load ÷ capacity: 0.5 is half busy, above 1 overloaded, Infinity when nothing is left to serve. */
  utilization: number;
  /** What the reading measures; `busy` (a machine) when omitted. */
  measure?: GaugeMeasure;
  /** `full`: the inspector's gauge with its reading. `mark`: a small dial on a canvas node. Both are labelled. */
  variant: 'full' | 'mark';
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
  /** The sound toggle's icon: a speaker, struck through when off. Decorative (the button carries the label). */
  Sound: ComponentType<{ on: boolean }>;
}

/** Moments the game makes a sound for. Sound is off unless the player turns it on. */
export type SoundCue =
  /** Moving between screens. */
  | 'navigate'
  /** A hint revealed, an estimate checked. */
  | 'hint'
  /** One nine ticking onto the counter. */
  | 'nine'
  /** The grade stamped on the result. */
  | 'grade'
  /** A badge stamped. */
  | 'badge'
  /** A passing grade. */
  | 'win'
  /** The troublemaker strikes during playback: a crash, a restart, a hot key. */
  | 'crash'
  /** Playback freezes on the incident. */
  | 'incident';

/**
 * A short synthesised sound: schedules nodes on `context` starting at `at` (its clock, seconds) into `out`, and
 * stops every source it starts. No audio files.
 */
export type SoundSynth = (context: BaseAudioContext, out: AudioNode, at: number) => void;

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
  /** The napkin-maths estimate worked step by step: numbered steps, each with its reason and arithmetic. */
  NapkinWorking: ComponentType<NapkinWorkingProps>;
  /** The level's numbers, worded. */
  numbersText(numbers: LevelNumbers): NumbersText;
  /** The level's numbers, drawn: in the briefing and on the napkin-maths card. */
  NumbersBox: ComponentType<NumbersBoxProps>;
  /** The field guide: components and concepts met so far, laid open over the page. */
  FieldGuide: ComponentType<FieldGuideProps>;
  fieldGuide: FieldGuideScript;
  /** The graded result. */
  GradeCard: ComponentType<GradeCardProps>;
  /** The campaign on the level select screen. */
  CampaignMap: ComponentType<CampaignMapProps>;
  /** Expected peak utilization, in the inspector and on canvas nodes while building. */
  UtilizationGauge: ComponentType<UtilizationGaugeProps>;
  /** Badges earned and still to earn, beside the campaign map. */
  BadgeShelf: ComponentType<BadgeShelfProps>;
  marks: ThemeMarks;
  sounds: Readonly<Record<SoundCue, SoundSynth>>;
}
