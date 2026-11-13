/** What the postmortem may show on the freeze-frame. Pure. */
import type { FailureCause, SimEvent } from '@five-nines/sim';

export interface IncidentAtFreeze {
  /** The first cause by the freeze, if any. */
  rootCause: FailureCause | undefined;
  /** Later causes by the freeze, in order of onset. */
  knockOn: FailureCause[];
  /** Events by the freeze. */
  events: SimEvent[];
}

/**
 * Only what had happened by the freeze (allowing the second it falls in); later causes and events would be spoilers
 * for "Keep watching". `causes` are in order of onset.
 */
export function incidentAtFreeze(
  causes: readonly FailureCause[],
  events: readonly SimEvent[],
  exhaustedAtSec: number,
): IncidentAtFreeze {
  const [rootCause, ...knockOn] = causes.filter((cause) => cause.firstAtSec <= exhaustedAtSec + 1);
  return { rootCause, knockOn, events: events.filter((event) => event.atSec <= exhaustedAtSec + 1) };
}
