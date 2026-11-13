import { AVAILABILITY_TIERS } from './catalog.ts';
import { designCostUsdPerMonth } from './cost.ts';
import type { CheckName, Design, Grade, Level } from './schema.ts';
import { simulate, type SimulationResult } from './simulate.ts';
import { validateDesign, type DesignIssue } from './validate.ts';

export interface Checks {
  availability: { value: number; required: number; ok: boolean };
  latency: { p99Ms: number | null; requiredMs: number; ok: boolean };
  budget: { costUsdPerMonth: number; budgetUsdPerMonth: number; ok: boolean };
}

export type Evaluation =
  | { status: 'invalid'; issues: DesignIssue[] }
  | {
      status: 'graded';
      grade: Grade;
      checks: Checks;
      /** In a fixed order: availability, latency, budget. */
      failedChecks: CheckName[];
      /**
       * The second in which cumulative failures exceeded the error budget for a pass (0.1% of all requests
       * in the run), or null if they never did. The UI freezes playback here.
       */
      errorBudgetExhaustedAtSec: number | null;
      warnings: DesignIssue[];
      simulation: SimulationResult;
    };

/** Validates, simulates and grades a design. The single entry point the game and the CLI use. */
export function evaluateDesign(level: Level, design: Design): Evaluation {
  const issues = validateDesign(design, level);
  if (issues.some((issue) => issue.severity === 'error')) return { status: 'invalid', issues };

  const simulation = simulate(level, design);
  const cost = designCostUsdPerMonth(design);
  const p99Ms = simulation.latency.p99Ms;
  const checks: Checks = {
    availability: {
      value: simulation.availability,
      required: AVAILABILITY_TIERS.pass,
      ok: simulation.availability >= AVAILABILITY_TIERS.pass,
    },
    latency: { p99Ms, requiredMs: level.requirements.p99Ms, ok: p99Ms !== null && p99Ms <= level.requirements.p99Ms },
    budget: {
      costUsdPerMonth: cost,
      budgetUsdPerMonth: level.requirements.budgetUsdPerMonth,
      ok: cost <= level.requirements.budgetUsdPerMonth,
    },
  };
  const failedChecks = (['availability', 'latency', 'budget'] as const).filter((name) => !checks[name].ok);

  return {
    status: 'graded',
    grade: failedChecks.length > 0 ? 'fail' : availabilityGrade(simulation.availability),
    checks,
    failedChecks,
    errorBudgetExhaustedAtSec: simulation.errorBudgetExhaustedAtSec,
    warnings: issues,
    simulation,
  };
}

export function availabilityGrade(availability: number): Grade {
  if (availability >= AVAILABILITY_TIERS.mastered) return 'mastered';
  if (availability >= AVAILABILITY_TIERS.star) return 'star';
  if (availability >= AVAILABILITY_TIERS.pass) return 'pass';
  return 'fail';
}
