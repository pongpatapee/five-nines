import { AVAILABILITY_TIERS, type FailureCause, type SimEvent } from '@five-nines/sim';
import { useEffect, useRef } from 'react';
import { describeCause } from '../describe.ts';
import { formatAvailability, formatSimTime } from '../format.ts';

export interface PostmortemCardProps {
  /** The engine's `errorBudgetExhaustedAtSec`. */
  exhaustedAtSec: number;
  /** In order of onset. */
  causes: readonly FailureCause[];
  events: readonly SimEvent[];
  /** Availability of the requests up to the freeze. */
  availability: number;
  onKeepWatching(): void;
  onSeeResults(): void;
}

/** The incident postmortem shown on the freeze-frame. */
export function PostmortemCard(props: PostmortemCardProps) {
  const { exhaustedAtSec, causes, events } = props;
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => primaryRef.current?.focus({ preventScroll: true }), []);
  // Only what had happened by the freeze; later causes and events would be spoilers for "Keep watching".
  const shownCauses = causes.filter((cause) => cause.firstAtSec <= exhaustedAtSec + 1);
  const shownEvents = events.filter((event) => event.atSec <= exhaustedAtSec + 1);

  return (
    <section className="pb-postmortem panel" role="dialog" aria-labelledby="pb-postmortem-title">
      <div className="pb-postmortem__eyebrow eyebrow">Incident postmortem</div>
      <h2 id="pb-postmortem-title" className="pb-postmortem__title">
        Incident: error budget exhausted at {formatSimTime(exhaustedAtSec)}
      </h2>

      <h3 className="pb-postmortem__heading eyebrow">What failed, in order</h3>
      {shownCauses.length > 0 ? (
        <ol className="pb-postmortem__causes">
          {shownCauses.map((cause, i) => (
            <li key={`${cause.nodeId}:${cause.reason}`} data-root={i === 0 || undefined}>
              {describeCause(cause)}
              {i === 0 && <span className="pb-postmortem__root">root cause</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No single cause stood out.</p>
      )}

      <h3 className="pb-postmortem__heading eyebrow">Event log</h3>
      {shownEvents.length > 0 ? (
        <ul className="pb-postmortem__events">
          {shownEvents.map((event, i) => (
            <li key={i}>
              <span className="num faint">{formatSimTime(event.atSec)}</span> {event.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No crashes or rotation changes before the incident.</p>
      )}

      <div className="pb-postmortem__availability">
        <span className="muted">Availability so far</span>
        <span className="num">{formatAvailability(props.availability)}</span>
        <span className="faint">needs ≥ {formatAvailability(AVAILABILITY_TIERS.pass)}</span>
      </div>

      <div className="pb-postmortem__actions">
        <button type="button" className="btn" onClick={props.onKeepWatching}>
          Keep watching
        </button>
        <button ref={primaryRef} type="button" className="btn btn--primary" onClick={props.onSeeResults}>
          See results
        </button>
      </div>
    </section>
  );
}
