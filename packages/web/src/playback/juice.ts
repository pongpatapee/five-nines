/**
 * When playback should shake and buzz: the moments the troublemaker strikes, as the playhead plays through them. Pure.
 * Scrubbing or skipping across an event doesn't count: only playing does.
 */
import type { SimEvent } from '@five-nines/sim';
import { MAX_TICK_SEC, SPEEDS } from './clock.ts';

/** The furthest one animation frame moves the playhead while playing (the top speed's longest tick). */
export const MAX_PLAY_STEP_SEC = Math.max(...SPEEDS) * MAX_TICK_SEC;

/** Events the troublemaker causes: each buzzes the pager. */
const STRIKES: ReadonlySet<SimEvent['kind']> = new Set(['instanceFailed', 'cacheRestarted', 'hotKeyStarted']);
/** Strikes that break a machine: these shake the screen too. */
const CRASHES: ReadonlySet<SimEvent['kind']> = new Set(['instanceFailed', 'cacheRestarted']);

export interface Strike {
  event: SimEvent;
  /** A machine broke: shake the screen. */
  shake: boolean;
}

/** The strikes the playhead played through going from `fromSec` to `toSec`. */
export function strikesPlayed(events: readonly SimEvent[], fromSec: number, toSec: number): Strike[] {
  const step = toSec - fromSec;
  if (!(step > 0) || step > MAX_PLAY_STEP_SEC + 1e-9) return [];
  return events
    .filter((event) => STRIKES.has(event.kind) && event.atSec > fromSec && event.atSec <= toSec)
    .map((event) => ({ event, shake: CRASHES.has(event.kind) }));
}
