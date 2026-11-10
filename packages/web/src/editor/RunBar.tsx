import { useEffect, useRef, useState } from 'react';
import { HandArrow } from '../notebook/index.ts';

export interface RunBarProps {
  /** Why the design can't run, or null when it can. */
  blocker: string | null;
  notice: string | null;
  onRun(): void;
  onReset(): void;
}

/** Run (with its blocking reason), the last run's notice, and Reset level behind an inline confirmation. */
export function RunBar({ blocker, notice, onRun, onReset }: RunBarProps) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirming(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming]);

  return (
    <footer className="run-bar">
      {notice && (
        <div className="run-bar__notice" role="alert">
          {notice}
        </div>
      )}
      {blocker && (
        <div className="run-bar__blocker" id="run-blocker">
          <span className="issue__icon" data-severity="error" aria-hidden>
            ✕
          </span>
          {blocker}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary run-bar__run"
        disabled={blocker !== null}
        aria-describedby={blocker ? 'run-blocker' : undefined}
        onClick={onRun}
      >
        Run simulation <span className="kbd run-bar__kbd">R</span>
        <HandArrow width={34} />
      </button>

      {confirming ? (
        <div className="run-bar__confirm" role="group" aria-label="Confirm reset">
          <span>Clear the canvas and start over?</span>
          <div className="run-bar__confirm-actions">
            <button ref={cancelRef} type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              onClick={() => {
                setConfirming(false);
                onReset();
              }}
            >
              Reset level
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--sm btn--ghost run-bar__reset" onClick={() => setConfirming(true)}>
          Reset level…
        </button>
      )}
    </footer>
  );
}
