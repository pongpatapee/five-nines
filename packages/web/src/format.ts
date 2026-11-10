/** Player-facing number formatting, shared by every module. */
import type { Grade } from '@five-nines/sim';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "$1,920" */
export function formatUsd(usd: number): string {
  return `$${integer.format(usd)}`;
}

/** "$1,920/mo" */
export function formatUsdPerMonth(usd: number): string {
  return `${formatUsd(usd)}/mo`;
}

/** "5,000", "12.3k" when `compact` and large. */
export function formatCount(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1)}k`;
  return integer.format(Math.round(n));
}

/** "5,000 req/s" */
export function formatRps(rps: number, compact = false): string {
  return `${formatCount(rps, compact)} req/s`;
}

/** "42 ms", "1.3 ms", "—" for null. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${integer.format(ms)} ms`;
}

/** "87%" */
export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * Availability with enough decimals to compare against the tiers (99.9 / 99.99 / 99.999%). Truncates rather than
 * rounds, so 99.98999% never displays as a misleading "99.990%".
 */
export function formatAvailability(fraction: number): string {
  const digits = 4;
  const scale = 10 ** digits;
  // The epsilon absorbs float error (0.999 * 100 * 1e4 is 998999.9999…), not real differences.
  const truncated = Math.floor(fraction * 100 * scale + 1e-6) / scale;
  return `${truncated.toFixed(digits)}%`;
}

/** "3 min", "90 s", "2 min 30 s" */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  const rest = Math.round(sec - min * 60);
  return rest === 0 ? `${min} min` : `${min} min ${rest} s`;
}

/** "t=64s" */
export function formatSimTime(sec: number): string {
  return `t=${Math.floor(sec)}s`;
}

export const GRADE_LABELS: Record<Grade, string> = {
  fail: 'Fail',
  pass: 'Pass',
  star: '★ Star',
  mastered: 'Mastered',
};

const GRADE_RANK: Record<Grade, number> = { fail: 0, pass: 1, star: 2, mastered: 3 };

/** Ordering for grades: fail < pass < star < mastered. */
export function gradeRank(grade: Grade): number {
  return GRADE_RANK[grade];
}

export function isPassingGrade(grade: Grade | undefined): boolean {
  return grade !== undefined && grade !== 'fail';
}
