/** Pure helpers for the napkin-maths step. */

/**
 * Reads what the player typed: "3.5", "19,200", "19 200", "73%", "50 vCPUs". A comma followed by exactly three digits
 * separates thousands; any other comma is a decimal point ("3,5"). Returns null for anything that isn't one
 * non-negative number.
 */
export function parseEstimateInput(text: string): number | null {
  let s = text.trim().toLowerCase();
  s = s.replace(/[a-z/%]+\s*$/u, '').trim();
  s = s.replace(/(\d)[\s  ](?=\d{3}\b)/gu, '$1');
  s = s.replace(/,(?=\d{3}\b)/g, '');
  s = s.replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
