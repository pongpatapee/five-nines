/** Pure helpers for the napkin-maths step. */
import type { EstimateQuantity } from '@five-nines/sim';

/** Quantities answered in seconds, where the player may type minutes or hours instead ("87 min", "1.5 h"). */
const DURATIONS: ReadonlySet<EstimateQuantity> = new Set<EstimateQuantity>(['secondsBetweenKeyReads']);

export function isDurationQuantity(quantity: EstimateQuantity): boolean {
  return DURATIONS.has(quantity);
}

/** Seconds per unit a duration may be typed in. */
const DURATION_UNITS: readonly [RegExp, number][] = [
  [/^(s|secs?|seconds?)$/, 1],
  [/^(m|mins?|minutes?)$/, 60],
  [/^(h|hrs?|hours?)$/, 3600],
];

/**
 * Reads what the player typed: "3.5", "19,200", "19 200", "73%", "50 vCPUs". A comma followed by exactly three digits
 * separates thousands; any other comma is a decimal point ("3,5"). Returns null for anything that isn't one
 * non-negative number. For a `duration`, the answer is in seconds and a unit converts it: "87 min", "1.5 h", "5200 s".
 */
export function parseEstimateInput(text: string, options: { duration?: boolean } = {}): number | null {
  let s = text.trim().toLowerCase();
  let scale = 1;
  const unit = /[a-z/%]+\s*$/u.exec(s)?.[0].trim();
  if (unit !== undefined && options.duration) {
    const match = DURATION_UNITS.find(([pattern]) => pattern.test(unit));
    if (!match) return null;
    scale = match[1];
  }
  s = s.replace(/[a-z/%]+\s*$/u, '').trim();
  s = s.replace(/(\d)[\s  ](?=\d{3}\b)/gu, '$1');
  s = s.replace(/,(?=\d{3}\b)/g, '');
  s = s.replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const value = Number(s) * scale;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
