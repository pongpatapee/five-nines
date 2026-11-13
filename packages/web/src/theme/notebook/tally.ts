/**
 * The error budget as tally marks: a fixed number of strokes in bundles of five, each standing for an equal share of
 * the failed requests the run may afford. Strokes get crossed out as the budget is spent.
 */

/** Strokes drawn for the whole budget: ten bundles of five. */
export const TALLY_STROKES = 50;
export const TALLY_BUNDLE = 5;

export interface TallyState {
  total: number;
  /** Strokes crossed out. Every stroke once the budget is exhausted. */
  spent: number;
  /** Strokes not yet crossed out. */
  left: number;
}

/**
 * `fraction` is budget used / budget (unclamped; above 1 once overspent). A stroke is only crossed out once its whole
 * share is spent, so a budget that held never shows as fully crossed out; `exhausted` (the engine's verdict) does.
 */
export function tallyState(fraction: number, exhausted: boolean, total = TALLY_STROKES): TallyState {
  const safe = Number.isFinite(fraction) ? Math.max(0, fraction) : exhausted ? 1 : 0;
  const spent = exhausted ? total : Math.min(total - 1, Math.floor(safe * total + 1e-9));
  return { total, spent, left: total - spent };
}
