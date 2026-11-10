/**
 * Developer CLI for grading designs and calibrating levels.
 *
 *   pnpm sim levels                         Grade every level's solutions and anti-solutions.
 *   pnpm sim grade <level-id> <design.json> Grade one design and explain the result.
 */
import { readFileSync } from 'node:fs';
import { DesignSchema, type Design, type Level } from './schema.ts';
import { evaluateDesign, type Evaluation } from './evaluate.ts';
import { getLevel, LEVELS } from './levels/index.ts';

function main(args: string[]): number {
  const [command, ...rest] = args;
  switch (command) {
    case 'levels':
      return gradeAllLevels();
    case 'grade': {
      const [levelId, designPath] = rest;
      if (levelId === undefined || designPath === undefined) return usage();
      const level = getLevel(levelId);
      if (level === undefined) {
        console.error(`Unknown level "${levelId}". Levels: ${LEVELS.map((l) => l.id).join(', ')}`);
        return 1;
      }
      const design = DesignSchema.parse(JSON.parse(readFileSync(designPath, 'utf8')));
      printEvaluation(level, design);
      return 0;
    }
    default:
      return usage();
  }
}

function gradeAllLevels(): number {
  let mismatches = 0;
  for (const level of LEVELS) {
    console.log(`\n${level.id}  ${level.title}  (p99 ≤ ${level.requirements.p99Ms}ms, ≤ $${level.requirements.budgetUsdPerMonth}/mo)`);
    for (const solution of level.solutions) {
      const evaluation = evaluateDesign(level, solution.design);
      const actual = evaluation.status === 'graded' ? evaluation.grade : 'invalid';
      const ok = actual === solution.expectedGrade;
      if (!ok) mismatches++;
      console.log(`  ${ok ? '✓' : '✗'} solution  ${solution.name.padEnd(36)} ${summarize(evaluation)}  expected ${solution.expectedGrade}`);
    }
    for (const anti of level.antiSolutions) {
      const evaluation = evaluateDesign(level, anti.design);
      const actual = evaluation.status === 'graded' ? evaluation.failedChecks.join('+') || 'nothing' : 'invalid';
      const expected = anti.expectedFailure === 'invalid' ? 'invalid' : anti.expectedFailure.join('+');
      const ok = actual === expected;
      if (!ok) mismatches++;
      console.log(`  ${ok ? '✓' : '✗'} anti      ${anti.name.padEnd(36)} ${summarize(evaluation)}  fails ${actual}, expected ${expected}`);
    }
  }
  console.log(mismatches === 0 ? '\nAll levels calibrated.' : `\n${mismatches} mismatch(es).`);
  return mismatches === 0 ? 0 : 1;
}

function summarize(evaluation: Evaluation): string {
  if (evaluation.status === 'invalid') return 'invalid'.padEnd(46);
  const { availability, latency, budget } = evaluation.checks;
  return [
    evaluation.grade.padEnd(8),
    `avail ${formatPercent(availability.value)}`.padEnd(16),
    `p99 ${formatMs(latency.p99Ms)}`.padEnd(13),
    `$${budget.costUsdPerMonth}`,
  ]
    .join(' ')
    .padEnd(46);
}

function printEvaluation(level: Level, design: Design): void {
  const evaluation = evaluateDesign(level, design);
  if (evaluation.status === 'invalid') {
    console.log('Design is invalid:');
    for (const issue of evaluation.issues) console.log(`  [${issue.severity}] ${issue.message}`);
    return;
  }
  const { checks, simulation } = evaluation;
  console.log(`Grade: ${evaluation.grade.toUpperCase()}`);
  console.log(`  availability ${formatPercent(checks.availability.value)} (need ${formatPercent(checks.availability.required)}) ${mark(checks.availability.ok)}`);
  console.log(`  p99          ${formatMs(checks.latency.p99Ms)} (need ≤ ${checks.latency.requiredMs}ms) ${mark(checks.latency.ok)}`);
  console.log(`  cost         $${checks.budget.costUsdPerMonth}/mo (budget $${checks.budget.budgetUsdPerMonth}) ${mark(checks.budget.ok)}`);
  for (const warning of evaluation.warnings) console.log(`  warning: ${warning.message}`);
  if (simulation.events.length > 0) {
    console.log('\nEvents:');
    for (const event of simulation.events) console.log(`  t=${event.atSec.toFixed(1)}s  ${event.message}`);
  }
  if (simulation.causes.length > 0) {
    console.log('\nFailures, in order of onset:');
    for (const cause of simulation.causes) {
      console.log(
        `  ${cause.nodeId} ${cause.reason}: ${Math.round(cause.requests).toLocaleString()} requests, ` +
          `t=${cause.firstAtSec.toFixed(1)}s–${cause.lastAtSec.toFixed(1)}s`,
      );
    }
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)}ms`;
}

function mark(ok: boolean): string {
  return ok ? '✓' : '✗';
}

function usage(): number {
  console.error('Usage:\n  pnpm sim levels\n  pnpm sim grade <level-id> <design.json>');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
