/** Player-facing number formatting, shared by every module. */
import type { Grade } from '@five-nines/sim';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "$1,920" */
export function formatUsd(usd: number): string {
  return `$${integer.format(usd)}`;
}

/** "$0.40", "$0.023": a per-use price, which whole dollars would round away. */
export function formatUsdCents(usd: number): string {
  return `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;
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

/** Short counts for tight spaces: "800", "2.5k", "10k", "120k", "1M", "2.5M". */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return integer.format(Math.round(n));
  if (abs >= 999_500) {
    const m = n / 1_000_000;
    return `${Math.abs(m) < 10 ? Number(m.toFixed(1)) : Math.round(m)}M`;
  }
  const k = n / 1000;
  return `${Math.abs(k) < 10 ? Number(k.toFixed(1)) : Math.round(k)}k`;
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

/** Compact durations for settings: "10 s", "5 min", "1 h". */
export function formatDurationShort(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec / 3600)} h`;
}

/** A measured time in seconds: "0.43 s", "1.9 s", "12 s". */
export function formatSeconds(sec: number): string {
  if (sec < 1) return `${sec.toFixed(2)} s`;
  if (sec < 10) return `${sec.toFixed(1)} s`;
  return `${Math.round(sec)} s`;
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

/** "page" → "Page". */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An estimate's answer at the precision a napkin keeps: 3.5, 3.75, 50, 72.7, 19,200. */
export function formatEstimate(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return formatCount(value);
  return String(Number(value.toFixed(abs < 10 ? 2 : 1)));
}
