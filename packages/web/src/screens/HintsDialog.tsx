import { useEffect, useId, useRef, type ReactNode } from 'react';
import { GuideLink } from '../guide/FieldGuideProvider.tsx';
import { HintLadderView } from '../theme/index.ts';
import { useEscape, useRestoreFocus } from './escape.ts';
import type { Hints } from './useHints.ts';

export interface HintsDialogProps {
  hints: Hints;
  /** Under the hints: the way to the solution. */
  solution?: ReactNode;
  onClose(): void;
}

/** The hints, from the top bar, at any time: the level's own ladder, or the last failed run's. */
export function HintsDialog({ hints, solution, onClose }: HintsDialogProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  useEscape(onClose);
  useRestoreFocus();
  const { ladder } = hints;
  return (
    <div className="hints-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="hints-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="hints-card__head">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="hints-card__title hand">
            {ladder.kind === 'run' ? 'Hints for your last run' : 'Hints'}
          </h2>
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Close
          </button>
        </header>
        <HintLadderView
          ladder={ladder}
          shown={hints.shown}
          onReveal={hints.reveal}
          footer={
            ladder.guide || solution ? (
              <>
                {ladder.guide && <GuideLink entry={ladder.guide} />}
                {solution}
              </>
            ) : undefined
          }
        />
      </section>
    </div>
  );
}
