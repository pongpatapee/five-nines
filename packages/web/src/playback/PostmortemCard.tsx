import { AVAILABILITY_TIERS, type FailureCause, type SimEvent } from '@five-nines/sim';
import { useEffect, useRef, type Ref } from 'react';
import { describeCause } from '../describe.ts';
import { formatAvailability, formatSimTime } from '../format.ts';
import { CastLine, eventCaption, HandArrow, InkLoop, mentorHint } from '../notebook/index.ts';

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
  /** The card's element, so playback can keep the root-cause node out from under it. */
  ref?: Ref<HTMLElement>;
}

/** The incident postmortem shown on the freeze-frame: a sticky note, with Erasmus's nudge underneath. */
export function PostmortemCard(props: PostmortemCardProps) {
  const { exhaustedAtSec, causes, events } = props;
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => primaryRef.current?.focus({ preventScroll: true }), []);
  // Only what had happened by the freeze; later causes and events would be spoilers for "Keep watching".
  const shownCauses = causes.filter((cause) => cause.firstAtSec <= exhaustedAtSec + 1);
  const shownEvents = events.filter((event) => event.atSec <= exhaustedAtSec + 1);
  const [rootCause, ...knockOn] = shownCauses;

  return (
    <section ref={props.ref} className="pb-postmortem" role="dialog" aria-labelledby="pb-postmortem-title">
      <div className="pb-postmortem__note">
        <span className="tape tape--center" aria-hidden />
        <div className="pb-postmortem__head">
          <span className="hand pb-postmortem__word">postmortem</span>
          <span className="pb-postmortem__draft">draft · {formatSimTime(exhaustedAtSec)}</span>
        </div>
        <h2 id="pb-postmortem-title" className="pb-postmortem__title">
          Incident: error budget exhausted at {formatSimTime(exhaustedAtSec)}
        </h2>

        {rootCause ? (
          <div className="pb-postmortem__root">
            <InkLoop width={320} height={70} delayMs={150} />
            <b className="pb-postmortem__label">Root cause:</b> {describeCause(rootCause, { count: false })}
          </div>
        ) : (
          <p>No single cause stood out.</p>
        )}

        {knockOn.length > 0 && (
          <>
            <h3 className="pb-postmortem__heading">Then:</h3>
            <ol className="pb-postmortem__causes">
              {knockOn.map((cause) => (
                <li key={`${cause.nodeId}:${cause.reason}`}>{describeCause(cause, { count: false })}</li>
              ))}
            </ol>
          </>
        )}

        <h3 className="pb-postmortem__heading">Event log:</h3>
        {shownEvents.length > 0 ? (
          <ul className="pb-postmortem__events">
            {shownEvents.map((event, i) => {
              const caption = eventCaption(event);
              return (
                <li key={i} data-smudge={caption.bySmudge || undefined}>
                  <span className="num pb-postmortem__time">{formatSimTime(event.atSec)}</span> {caption.text}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pb-postmortem__quiet">No crashes or rotation changes before the incident.</p>
        )}

        <div className="pb-postmortem__availability">
          <b className="pb-postmortem__label">Availability so far:</b>
          <span className="num pb-postmortem__avail">{formatAvailability(props.availability)}</span>
          <span className="muted">needs ≥ {formatAvailability(AVAILABILITY_TIERS.pass)}</span>
        </div>
      </div>

      <CastLine
        who="mentor"
        erasmusMood="leaning"
        figureSize={64}
        lead="Erasmus leans in:"
        className="pb-postmortem__mentor"
      >
        {mentorHint(rootCause?.reason)}
      </CastLine>

      <div className="pb-postmortem__actions">
        <button type="button" className="btn pb-postmortem__keep" onClick={props.onKeepWatching}>
          Keep watching
        </button>
        <button ref={primaryRef} type="button" className="btn btn--primary pb-postmortem__results" onClick={props.onSeeResults}>
          See results
          <HandArrow width={30} />
        </button>
      </div>
    </section>
  );
}
