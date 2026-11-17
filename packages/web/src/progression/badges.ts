/**
 * Badges for good engineering habits, not grinding (docs/ideas.md, "Rewards and progression"). Pure functions: run
 * badges judge one graded run, progress badges judge the saved progress. Once earned, a badge stays earned.
 *
 * - Right-sized: passed for no more than the level's cheapest reference solution costs (`rightSizedCost`). Nothing
 *   bought just in case. Judged by cost, not by how busy the machines are: sizes come in fixed steps, so the right
 *   answer can sit well under the 70% the game teaches (level 1's one large server is 44% busy), and a busyness floor
 *   would reward running hot. No tolerance: costs are exact sums of catalogue prices, and the reference designs are
 *   real designs a player can build.
 * - N+1: passed a level with a scripted crash, and the crashed node's surviving instances stayed at or under
 *   `N_PLUS_ONE_MAX_AFTER_CRASH` (the "hot" line) for the rest of the run: there was spare capacity to lose a machine.
 * - Penny Pincher: mastered while spending at most `PENNY_PINCHER_MAX_SPEND` of the budget.
 * - Five Nines Club: mastered every level of a chapter.
 * - Napkin Wizard: a napkin-math estimate within 10% (the bonus mark) on `NAPKIN_WIZARD_LEVELS` levels.
 */
import {
  designCostUsdPerMonth,
  HOT_UTILIZATION,
  isWritten,
  type Chapter,
  type Evaluation,
  type Grade,
  type Level,
  type TimelineFrame,
} from '@five-nines/sim';

export const BADGE_IDS = ['rightSized', 'nPlusOne', 'pennyPincher', 'fiveNinesClub', 'napkinWizard'] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export function isBadgeId(value: string): value is BadgeId {
  return (BADGE_IDS as readonly string[]).includes(value);
}

/** N+1: the crashed node's surviving instances must stay at or under this after the crash. */
export const N_PLUS_ONE_MAX_AFTER_CRASH = HOT_UTILIZATION;
/** Penny Pincher: the most of the budget a mastered design may cost. */
export const PENNY_PINCHER_MAX_SPEND = 0.8;
/** Napkin Wizard: levels with the estimate bonus. */
export const NAPKIN_WIZARD_LEVELS = 3;

type GradedEvaluation = Extract<Evaluation, { status: 'graded' }>;

/** The busiest an instance of `nodeId` got while up, over frames from `fromSec` on. 0 when it never ran. */
function peakUtilization(timeline: readonly TimelineFrame[], nodeId: string, fromSec = 0): number {
  let peak = 0;
  for (const frame of timeline) {
    if (frame.atSec < fromSec) continue;
    for (const instance of frame.nodes[nodeId]?.instances ?? []) {
      if (instance.up && instance.utilization > peak) peak = instance.utilization;
    }
  }
  return peak;
}

/** The most a design may cost to be right-sized: the level's cheapest reference solution. */
export function rightSizedCost(level: Pick<Level, 'solutions'>): number {
  return Math.min(...level.solutions.map((solution) => designCostUsdPerMonth(solution.design)));
}

/** Passed for no more than the cheapest reference solution. */
export function isRightSized(level: Pick<Level, 'solutions'>, evaluation: GradedEvaluation): boolean {
  return evaluation.grade !== 'fail' && evaluation.checks.budget.costUsdPerMonth <= rightSizedCost(level);
}

/** Passed through a crash with the survivors out of the hot zone. False when nothing crashed. */
export function keptSpareThroughCrash(evaluation: GradedEvaluation): boolean {
  if (evaluation.grade === 'fail') return false;
  const crashes = evaluation.simulation.events.filter((event) => event.kind === 'instanceFailed');
  if (crashes.length === 0) return false;
  return crashes.every(
    (crash) => peakUtilization(evaluation.simulation.timeline, crash.nodeId, crash.atSec) <= N_PLUS_ONE_MAX_AFTER_CRASH,
  );
}

/** Mastered for at most `PENNY_PINCHER_MAX_SPEND` of the budget. */
export function isPennyPincher(evaluation: GradedEvaluation): boolean {
  const { costUsdPerMonth, budgetUsdPerMonth } = evaluation.checks.budget;
  return evaluation.grade === 'mastered' && costUsdPerMonth <= PENNY_PINCHER_MAX_SPEND * budgetUsdPerMonth;
}

/** The badges one graded run earns, in `BADGE_IDS` order. */
export function runBadges(level: Pick<Level, 'solutions'>, evaluation: GradedEvaluation): BadgeId[] {
  const earned = new Set<BadgeId>();
  if (isRightSized(level, evaluation)) earned.add('rightSized');
  if (keptSpareThroughCrash(evaluation)) earned.add('nPlusOne');
  if (isPennyPincher(evaluation)) earned.add('pennyPincher');
  return BADGE_IDS.filter((id) => earned.has(id));
}

export interface BadgeProgress {
  best: Readonly<Record<string, Grade>>;
  /** Levels where an estimate earned the bonus mark. */
  closeEstimates: readonly string[];
}

/** Chapters whose every level is mastered. */
export function masteredChapterIds(chapters: readonly Chapter[], best: Readonly<Record<string, Grade>>): string[] {
  return chapters
    .filter((chapter) => isWritten(chapter) && chapter.levelIds.every((id) => best[id] === 'mastered'))
    .map((chapter) => chapter.id);
}

/** The badges the saved progress has earned, in `BADGE_IDS` order. */
export function progressBadges(chapters: readonly Chapter[], progress: BadgeProgress): BadgeId[] {
  const earned = new Set<BadgeId>();
  if (masteredChapterIds(chapters, progress.best).length > 0) earned.add('fiveNinesClub');
  if (new Set(progress.closeEstimates).size >= NAPKIN_WIZARD_LEVELS) earned.add('napkinWizard');
  return BADGE_IDS.filter((id) => earned.has(id));
}
