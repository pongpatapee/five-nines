/**
 * What the cast reacts to, worked out from real level data and engine output. Pure and theme-independent: the game
 * decides *which* situation applies, a theme's script decides how its characters say it. So no theme can make a
 * character claim something the simulation didn't do.
 */
import type { DesignIssue, FailureReason, Grade, Level, SimEvent } from '@five-nines/sim';
import type { GradedEvaluation } from '../engine/index.ts';
import type { CastScript } from './contract.ts';

/**
 * The level's stress, for the troublemaker's tease. Most specific first: the first scripted crash, then the data the
 * level checks for freshness (read-your-writes, then a staleness limit), then a traffic spike, then a traffic surge.
 */
export type LevelStress =
  | { kind: 'crash'; atSec: number }
  | { kind: 'readAfterWrite'; share: number }
  | { kind: 'staleness'; limitSec: number }
  | { kind: 'spike'; atSec: number; peakRps: number }
  | { kind: 'surge'; fromRps: number; toRps: number };

/** Null when the level has none of these (flat traffic, no events, no freshness rules). */
export function levelStress(level: Level): LevelStress | null {
  const crash = level.events.find((event) => event.kind === 'instanceFailure');
  if (crash) return { kind: 'crash', atSec: crash.atSec };
  const readAfterWrite = level.workload.data?.readAfterWrite;
  if (readAfterWrite) return { kind: 'readAfterWrite', share: readAfterWrite.share };
  const staleness = level.requirements.maxStalenessSec;
  if (staleness !== undefined) return { kind: 'staleness', limitSec: staleness };
  const traffic = level.workload.traffic;
  const rates = traffic.map((point) => point.rps);
  const start = rates[0] ?? 0;
  const peak = Math.max(0, ...rates);
  const end = rates[rates.length - 1] ?? 0;
  const spike = traffic.find((point) => point.rps === peak);
  if (spike && peak > end && spike.atSec > 0) return { kind: 'spike', atSec: spike.atSec, peakRps: peak };
  if (peak > start) return { kind: 'surge', fromRps: start, toRps: peak };
  return null;
}

/**
 * The boss's verdict on a graded run. A failed run is judged on its first failed check in the engine's order
 * (availability, latency, budget), so the boss always complains about the thing that actually went wrong.
 */
export type Verdict =
  | { kind: 'availability'; availability: number; staleReads: boolean }
  | { kind: 'latency'; p99Ms: number | null; requiredMs: number }
  | { kind: 'budget'; costUsdPerMonth: number; budgetUsdPerMonth: number }
  | { kind: 'praise'; grade: Exclude<Grade, 'fail'> };

export function verdictFor(evaluation: Pick<GradedEvaluation, 'grade' | 'checks' | 'failedChecks' | 'simulation'>): Verdict {
  const { grade, checks } = evaluation;
  if (grade !== 'fail') return { kind: 'praise', grade };
  switch (evaluation.failedChecks[0]) {
    case 'latency':
      return { kind: 'latency', p99Ms: checks.latency.p99Ms, requiredMs: checks.latency.requiredMs };
    case 'budget':
      return {
        kind: 'budget',
        costUsdPerMonth: checks.budget.costUsdPerMonth,
        budgetUsdPerMonth: checks.budget.budgetUsdPerMonth,
      };
    default:
      return {
        kind: 'availability',
        availability: checks.availability.value,
        staleReads: evaluation.simulation.causes[0]?.reason === 'stale_read',
      };
  }
}

/** The design checks, as the mentor sees them. */
export interface CheckSummary {
  errors: number;
  warnings: number;
}

export function checkSummary(issues: readonly DesignIssue[]): CheckSummary {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

/**
 * How an event reads on the timeline and in the postmortem. A crashed instance is the troublemaker's doing; every
 * other event (rotation changes, replica lag) is the system's, in the engine's words.
 */
export function eventCaption(event: SimEvent, script: CastScript): { text: string; byTroublemaker: boolean } {
  return event.kind === 'instanceFailed' && event.instance !== undefined
    ? { text: script.troublemakerCrash(event.nodeId, event.instance), byTroublemaker: true }
    : { text: event.message, byTroublemaker: false };
}

/** The mentor's hint for a failure reason, or the sign-off when there's none. */
export function mentorHint(reason: FailureReason | null | undefined, script: CastScript): string {
  return reason ? script.mentorHints[reason] : script.mentorSignOff;
}

/** The troublemaker's tease for a level, or null when it has no stress to tease. */
export function troublemakerTease(level: Level, script: CastScript): string | null {
  const stress = levelStress(level);
  return stress ? script.troublemakerTease(stress) : null;
}
