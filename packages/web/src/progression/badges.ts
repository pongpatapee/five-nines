/**
 * Badges for good engineering habits, not grinding (docs/ideas.md, "Rewards and progression"). Pure functions: run
 * badges judge one graded run, progress badges judge the saved progress. Once earned, a badge stays earned.
 *
 * - Right-sized: passed, with every app-server instance at least `RIGHT_SIZED_MIN_PEAK` busy at its own peak in the
 *   run. Nothing bought just in case: a pass already means the design was within budget.
 * - N+1: passed a level with a scripted crash, and the crashed node's surviving instances stayed at or under
 *   `N_PLUS_ONE_MAX_AFTER_CRASH` (the "hot" line) for the rest of the run: there was spare capacity to lose a machine.
 * - Penny Pincher: mastered while spending at most `PENNY_PINCHER_MAX_SPEND` of the budget.
 * - Five Nines Club: mastered every level of a chapter.
 * - Napkin Wizard: a napkin-maths estimate within 10% (the bonus mark) on `NAPKIN_WIZARD_LEVELS` levels.
 */
import {
  HOT_UTILIZATION,
  isWritten,
  type Chapter,
  type Design,
  type Evaluation,
  type Grade,
  type TimelineFrame,
} from '@five-nines/sim';

export const BADGE_IDS = ['rightSized', 'nPlusOne', 'pennyPincher', 'fiveNinesClub', 'napkinWizard'] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export function isBadgeId(value: string): value is BadgeId {
  return (BADGE_IDS as readonly string[]).includes(value);
}

/** Right-sized: every app-server instance must reach at least this utilization at its peak. */
export const RIGHT_SIZED_MIN_PEAK = 0.6;
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

/** Passed with every app server pulling its weight at peak. */
export function isRightSized(design: Design, evaluation: GradedEvaluation): boolean {
  if (evaluation.grade === 'fail') return false;
  const apps = design.nodes.filter((node) => node.kind === 'appServer');
  if (apps.length === 0) return false;
  // Each instance individually: one idle instance next to a busy one is still overprovisioned.
  return apps.every((node) => {
    for (let index = 0; index < node.instances; index++) {
      let peak = 0;
      for (const frame of evaluation.simulation.timeline) {
        const instance = frame.nodes[node.id]?.instances[index];
        if (instance?.up && instance.utilization > peak) peak = instance.utilization;
      }
      if (peak < RIGHT_SIZED_MIN_PEAK) return false;
    }
    return true;
  });
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
export function runBadges(design: Design, evaluation: GradedEvaluation): BadgeId[] {
  const earned = new Set<BadgeId>();
  if (isRightSized(design, evaluation)) earned.add('rightSized');
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
