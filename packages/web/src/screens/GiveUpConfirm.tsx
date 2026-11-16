import { useEffect, useId, useRef } from 'react';
import { cast } from '../theme/index.ts';
import { useEscape, useRestoreFocus } from './escape.ts';

export interface GiveUpConfirmProps {
  onConfirm(): void;
  onCancel(): void;
}

/** Before the solution of a level not yet passed: what seeing it costs, said before it happens. */
export function GiveUpConfirm({ onConfirm, onCancel }: GiveUpConfirmProps) {
  const titleId = useId();
  const bodyId = useId();
  // The safe choice has the focus, so Enter never gives up by accident.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  useEscape(onCancel);
  useRestoreFocus();
  const words = cast.giveUp;
  return (
    <div className="confirm-overlay">
      <section className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId} className="confirm-card__title hand">
          {words.confirmTitle}
        </h2>
        <div id={bodyId} className="confirm-card__body">
          {words.confirmLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="confirm-card__actions">
          <button ref={cancelRef} type="button" className="btn btn--primary" onClick={onCancel}>
            {words.cancel}
          </button>
          <button type="button" className="btn" onClick={onConfirm}>
            {words.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
