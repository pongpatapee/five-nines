/**
 * The notebook's cast and everything they say. Pure: every line is derived from real level data or engine output,
 * so the characters never claim something the simulation didn't do.
 *
 * - Ms. Tally, the budget boss: sets the bar in the briefing and delivers the verdict.
 * - Erasmus, the mentor eraser: voices hints, design checks and the postmortem nudge.
 * - Smudge, the ink-blot troublemaker: owns the level's stress (traffic surges, crashed servers).
 */
import {
  COMPONENT_LABELS,
  type DesignIssue,
  type FailureReason,
  type Grade,
  type Level,
  type SimEvent,
} from '@five-nines/sim';
import { formatAvailability, formatCount, formatMs, formatUsd } from '../format.ts';
import type { GradedEvaluation } from '../engine/index.ts';
import { tierPercent } from '../results/grading.ts';

export const CAST = {
  boss: { name: 'Ms. Tally', role: 'budget boss' },
  mentor: { name: 'Erasmus', role: 'mentor' },
  troublemaker: { name: 'Smudge', role: 'troublemaker' },
} as const;

export type CastMember = keyof typeof CAST;

/** Ms. Tally's one-line brief: the budget she won't let you exceed. */
export function bossBriefingLine(level: Level): string {
  return `${formatUsd(level.requirements.budgetUsdPerMonth)} a month. Not a cent over.`;
}

/**
 * Smudge's heads-up about the level's stress: the first scripted crash if there is one, otherwise the traffic surge.
 * Null when the level has neither (flat traffic, no events).
 */
export function troublemakerTease(level: Level): string | null {
  const crash = level.events.find((event) => event.kind === 'instanceFailure');
  if (crash) {
    return `heh. ${roughly(crash.atSec)} in, I unplug your busiest ${COMPONENT_LABELS.appServer.toLowerCase()}.`;
  }
  const rates = level.workload.traffic.map((point) => point.rps);
  const start = rates[0] ?? 0;
  const peak = Math.max(0, ...rates);
  if (peak > start) return `heh. traffic climbs from ${formatCount(start)} to ${formatCount(peak)} req/s. hope you sized up.`;
  return null;
}

/** "30 seconds", "about a minute", "about 3 minutes": how a character would say when something happens. */
export function roughly(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} seconds`;
  const minutes = Math.round(sec / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

/** How Smudge's handiwork reads on the timeline. Rotation changes are the load balancer's doing, not Smudge's. */
export function eventCaption(event: SimEvent): { text: string; bySmudge: boolean } {
  if (event.kind === 'instanceFailed' && event.instance !== undefined) {
    return { text: `Smudge pulls the plug on ${event.nodeId} instance ${event.instance + 1}`, bySmudge: true };
  }
  return { text: event.message, bySmudge: false };
}

/** Erasmus's nudge for a failure reason: a question that points at the fix without giving it away. */
export const MENTOR_HINTS: Record<FailureReason, string> = {
  instance_down:
    'Ahem. A crashed server refuses connections instantly, no waiting around. So what could cover the gap until the health checks notice?',
  no_healthy_backend:
    'Nothing was left in rotation to take the traffic. How many instances could you lose and still serve everyone?',
  timeout:
    'Requests waited in line until they gave up. Each vCPU serves one at a time, so where would more capacity help?',
  overloaded: 'More requests arrived than that box can handle. Could the load be spread out instead?',
  stale_read:
    'Someone read an old copy. Replicas run a little behind the primary, so which reads can afford to wait, and which must see the latest write?',
};

/** Erasmus's sign-off when there's nothing specific to say. */
export const MENTOR_SIGN_OFF = "Mistakes rub out. That's what I'm for.";

/** Erasmus's standing advice on the contents page. */
export const MENTOR_RULE_ONE = 'Rule one, kid: every box you draw can break. Plan for it.';

export function mentorHint(reason: FailureReason | null | undefined): string {
  return reason ? MENTOR_HINTS[reason] : MENTOR_SIGN_OFF;
}

/** Erasmus's take on the design checks: what to do about them, not a repeat of the list. */
export function mentorCheckLine(issues: readonly DesignIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  if (errors > 0) {
    return errors === 1
      ? "One thing stops this from running. Fix the red one and we'll see what breaks."
      : `${errors} things stop this from running. Start from the clients and work along the flow.`;
  }
  if (issues.length > 0) return "Only warnings. It'll run, but read them before Ms. Tally does.";
  return "Looks runnable to me. Press Run and let's see what breaks.";
}

/**
 * Ms. Tally's verdict on a graded run. A failed run is judged on its first failed check in the engine's order
 * (availability, latency, budget), so she always complains about the thing that actually went wrong.
 */
export function bossVerdict(evaluation: Pick<GradedEvaluation, 'grade' | 'checks' | 'failedChecks'>): {
  exclaim: string;
  line: string;
} {
  const { grade, checks } = evaluation;
  if (grade === 'fail') {
    switch (evaluation.failedChecks[0]) {
      case 'latency':
        return {
          exclaim: `p99 of ${formatMs(checks.latency.p99Ms)}?!`,
          line: `The limit was ${formatMs(checks.latency.requiredMs)}. Customers noticed.`,
        };
      case 'budget':
        return {
          exclaim: `${formatUsd(checks.budget.costUsdPerMonth)} a month?!`,
          line: `I said ${formatUsd(checks.budget.budgetUsdPerMonth)}. Not a cent over.`,
        };
      default:
        return {
          exclaim: `${formatAvailability(checks.availability.value)}?!`,
          line: `We promised ${tierPercent('pass')}. See me after.`,
        };
    }
  }
  return BOSS_PRAISE[grade];
}

const BOSS_PRAISE: Record<Exclude<Grade, 'fail'>, { exclaim: string; line: string }> = {
  pass: { exclaim: 'Three nines.', line: 'Acceptable. There are more nines to be had.' },
  star: { exclaim: 'Four nines!', line: "I'm almost impressed. Almost." },
  mastered: { exclaim: 'Five nines.', line: 'Under budget, too. Frame this page.' },
};
