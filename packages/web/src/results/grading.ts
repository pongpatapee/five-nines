/** Pure helpers behind the grade card. */
import { AVAILABILITY_TIERS, type Grade } from '@five-nines/sim';
import { GRADE_LABELS } from '../format.ts';

export const TIER_ORDER = ['pass', 'star', 'mastered'] as const;
export type Tier = (typeof TIER_ORDER)[number];

/** The next availability tier above `grade`, or null at the top (or when the run failed for another reason). */
export function nextTier(grade: Grade): Tier | null {
  if (grade === 'fail') return 'pass';
  const index = TIER_ORDER.indexOf(grade);
  return TIER_ORDER[index + 1] ?? null;
}

/** "★ Star needs 99.99%" */
export function tierRequirementLabel(tier: Tier): string {
  return `${GRADE_LABELS[tier]} needs ≥ ${tierPercent(tier)} availability`;
}

/** "99.9%" for the pass tier, "99.99%" for star, "99.999%" for mastered. */
export function tierPercent(tier: Tier): string {
  const value = AVAILABILITY_TIERS[tier];
  const decimals = Math.max(0, String(value).length - 4);
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Headline under the grade. */
export function gradeHeadline(grade: Grade): string {
  switch (grade) {
    case 'fail':
      return 'The design did not meet the requirements.';
    case 'pass':
      return 'Requirements met. Three nines.';
    case 'star':
      return 'Requirements met with four nines.';
    case 'mastered':
      return 'Five nines. Flawless.';
  }
}

/**
 * The availability tiers the grade card lights. Nines are only earned when every check passes, so a failed run lights
 * none, however available it was: a fast-enough-but-too-slow run must not look like it earned three nines.
 */
export function litTiers(grade: Grade): Tier[] {
  return grade === 'fail' ? [] : TIER_ORDER.slice(0, TIER_ORDER.indexOf(grade) + 1);
}
