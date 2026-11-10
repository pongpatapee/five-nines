import { formatAvailability, formatSimTime } from '../format.ts';
import { SPEEDS, type Speed } from './clock.ts';

export interface ControlBarProps {
  playing: boolean;
  speed: Speed;
  timeSec: number;
  durationSec: number;
  availability: number;
  /** Availability needed to pass, to colour the readout. */
  passAvailability: number;
  onTogglePlay(): void;
  onSpeed(speed: Speed): void;
  onSkipToEnd(): void;
  onExit(): void;
}

/** Transport controls and the live readouts. */
export function ControlBar(props: ControlBarProps) {
  const { playing, speed, timeSec, durationSec, availability } = props;
  return (
    <div className="pb-controls">
      <button
        type="button"
        className="btn btn--sm pb-controls__play"
        onClick={props.onTogglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="pb-speed" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === speed}
            className="pb-speed__option num"
            onClick={() => props.onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--sm btn--ghost" onClick={props.onSkipToEnd} title="Skip to end and see results">
        Skip to end
      </button>

      <div className="pb-controls__readouts">
        <span className="pb-controls__time num">
          {formatSimTime(timeSec)}
          <span className="faint"> / {durationSec}s</span>
        </span>
        <span className="pb-controls__availability">
          <span className="faint">availability</span>{' '}
          <span className="num" data-tone={availability >= props.passAvailability ? 'ok' : 'failing'}>
            {formatAvailability(availability)}
          </span>
        </span>
      </div>

      <button type="button" className="btn btn--sm" onClick={props.onExit}>
        Back to editor
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="1.5" width="2.5" height="9" rx="0.5" fill="currentColor" />
      <rect x="7" y="1.5" width="2.5" height="9" rx="0.5" fill="currentColor" />
    </svg>
  );
}
