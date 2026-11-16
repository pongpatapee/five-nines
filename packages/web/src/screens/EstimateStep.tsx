import { isCloseEstimate, levelNumbers, solveEstimate, type Estimate, type Level } from '@five-nines/sim';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { playCue } from '../audio/sfx.ts';
import { formatEstimate } from '../format.ts';
import type { BadgeId } from '../progression/index.ts';
import type { EstimateRecord } from '../state/index.ts';
import { cast, CastLine, marks, NapkinWorking, NumbersBox } from '../theme/index.ts';
import { ESTIMATE_GUIDE_ENTRY } from '../guide/guide.ts';
import { GuideLink } from '../guide/FieldGuideProvider.tsx';
import { useEscape, useRestoreFocus } from './escape.ts';
import { isDurationQuantity, parseEstimateInput } from './estimate.ts';

export interface EstimateStepProps {
  level: Level;
  estimate: Estimate;
  /** What the player answered before on this level, if anything. */
  record: EstimateRecord | undefined;
  /** A guess was checked. `close` earns the bonus mark. Returns the badges the answer earned for the first time. */
  onAnswer(guess: number, close: boolean): readonly BadgeId[];
  /** The player skipped the question. Records the skip; the step then shows the working. */
  onSkip(): void;
  /** Done: back to building. */
  onClose(): void;
  /** `review` opens straight on the worked solution, for a player coming back to it. */
  start?: 'ask' | 'review';
}

type Phase =
  | { kind: 'ask' }
  | { kind: 'answered'; guess: number; close: boolean; badges: readonly BadgeId[] }
  /** The working without a fresh answer: after a skip, or come back to later. */
  | { kind: 'review'; skipped: boolean };

/**
 * The napkin-maths step before building (docs/design.md, "Estimate step"): the mentor asks one question worked out
 * from the level's numbers, the player answers or skips, and gets the worked solution either way. It can be reopened
 * on the question or straight on the working.
 */
export function EstimateStep({ level, estimate, record, onAnswer, onSkip, onClose, start = 'ask' }: EstimateStepProps) {
  const solution = useMemo(() => solveEstimate(level, estimate), [level, estimate]);
  const { question, unit } = cast.mentorEstimate.ask(solution.working, level);
  const numbers = useMemo(() => levelNumbers(level), [level]);
  const duration = isDurationQuantity(estimate.quantity);
  const [phase, setPhase] = useState<Phase>(start === 'review' ? { kind: 'review', skipped: false } : { kind: 'ask' });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    // On the working, focus the top of the card so it reads from the first step, not from the buttons below.
    if (phase.kind === 'ask') inputRef.current?.focus();
    else {
      titleRef.current?.focus({ preventScroll: true });
      titleRef.current?.closest('.estimate-overlay')?.scrollTo({ top: 0 });
    }
  }, [phase.kind]);

  // Esc leaves the step: a skip if nothing was ever answered.
  useEscape(() => {
    if (phase.kind === 'ask' && record === undefined) onSkip();
    onClose();
  });
  useRestoreFocus();

  const check = (event: FormEvent) => {
    event.preventDefault();
    const guess = parseEstimateInput(text, { duration });
    if (guess === null) {
      setError(duration ? 'Type one number of seconds, like 90, or add a unit: 2 min, 1.5 h.' : 'Type one number, like 12 or 3.5.');
      return;
    }
    const close = isCloseEstimate(guess, estimate.answer);
    const badges = onAnswer(guess, close);
    if (badges.length > 0) setTimeout(() => playCue('badge'), 400);
    setPhase({ kind: 'answered', guess, close, badges });
  };

  const show = formatEstimate;

  return (
    <div className="estimate-overlay">
      <section className="estimate-card" role="dialog" aria-labelledby="estimate-title">
        <span className="tape tape--center" aria-hidden />
        <h2 ref={titleRef} id="estimate-title" className="estimate-card__title hand" tabIndex={-1}>
          Napkin maths
        </h2>

        {phase.kind === 'ask' ? (
          <>
            <CastLine role="mentor" size={64} className="estimate-card__mentor">
              {question}
            </CastLine>
            <NumbersBox numbers={numbers} variant="card" />
            <form className="estimate-form" onSubmit={check} noValidate>
              <label htmlFor={inputId} className="estimate-form__label">
                Your estimate
              </label>
              <div className="estimate-form__row">
                <input
                  ref={inputRef}
                  id={inputId}
                  className="estimate-form__input num"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={text}
                  aria-invalid={error !== null}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => {
                    setText(event.target.value);
                    setError(null);
                  }}
                />
                <span className="estimate-form__unit">{unit}</span>
                <button type="submit" className="btn btn--primary">
                  Check
                </button>
              </div>
              {error && (
                <p id={errorId} className="estimate-form__error" role="alert">
                  {error}
                </p>
              )}
              {record?.close && (
                <p className="estimate-form__earned">
                  <marks.Met /> You already earned the {cast.mentorEstimate.bonus} here.
                </p>
              )}
            </form>
            <div className="estimate-card__actions">
              {record === undefined ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    onSkip();
                    setPhase({ kind: 'review', skipped: true });
                  }}
                >
                  Skip: show me the working
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--ghost" onClick={onClose}>
                    Back to building
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setPhase({ kind: 'review', skipped: false })}>
                    {cast.mentorEstimate.revisit}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <Answered
            verdict={
              phase.kind === 'answered'
                ? cast.mentorEstimate.verdict({ guess: phase.guess, answer: estimate.answer, close: phase.close })
                : phase.skipped
                  ? cast.mentorEstimate.skipped
                  : cast.mentorEstimate.review
            }
            close={phase.kind === 'answered' ? phase.close : null}
            guess={
              phase.kind === 'answered'
                ? { label: 'Your estimate', value: `${show(phase.guess)} ${unit}` }
                : !phase.skipped && record?.guess != null
                  ? { label: 'Your last estimate', value: `${show(record.guess)} ${unit}` }
                  : null
            }
            answer={`${show(estimate.answer)} ${unit}`}
            working={
              <>
                <NapkinWorking solution={solution} />
                <GuideLink entry={ESTIMATE_GUIDE_ENTRY[estimate.quantity]} className="estimate-card__guide" />
                <NumbersBox numbers={numbers} variant="card" />
              </>
            }
            badges={phase.kind === 'answered' ? phase.badges : []}
            doneLabel={phase.kind === 'review' && !phase.skipped ? 'Back to building' : 'Start building'}
            onDone={onClose}
            retryLabel={phase.kind === 'answered' ? (phase.close ? null : 'Try again') : 'Answer it'}
            onRetry={() => {
              setText('');
              setPhase({ kind: 'ask' });
            }}
          />
        )}
      </section>
    </div>
  );
}

function Answered(props: {
  verdict: { exclaim: string; line: string };
  /** Whether a fresh answer earned the bonus; null when there's no fresh answer. */
  close: boolean | null;
  guess: { label: string; value: string } | null;
  answer: string;
  working: ReactNode;
  badges: readonly BadgeId[];
  doneLabel: string;
  onDone(): void;
  /** Back to the question; no button when null. */
  retryLabel: string | null;
  onRetry(): void;
}) {
  return (
    <>
      <CastLine
        role="mentor"
        size={64}
        mood={props.close === null ? 'neutral' : props.close ? 'pleased' : 'concerned'}
        lead={props.verdict.exclaim}
        tone={props.close === false ? 'alarm' : 'note'}
        className="estimate-card__mentor"
      >
        {props.verdict.line}
      </CastLine>
      <dl className="estimate-card__compare">
        {props.guess && (
          <div>
            <dt>{props.guess.label}</dt>
            <dd className="num">{props.guess.value}</dd>
          </div>
        )}
        <div>
          <dt>The napkin says</dt>
          <dd className="num">{props.answer}</dd>
        </div>
        {props.close && (
          <div className="estimate-card__bonus">
            <dt>Bonus</dt>
            <dd>
              <marks.Met label="earned" /> {cast.mentorEstimate.bonus}
            </dd>
          </div>
        )}
      </dl>
      {props.working}
      {props.badges.map((id) => {
        const badge = cast.badges[id];
        return (
          <CastLine key={id} role={badge.role} size={48} lead={`Badge: ${badge.name}`} className="estimate-card__badge stamp-in">
            {badge.line}
          </CastLine>
        );
      })}
      <div className="estimate-card__actions">
        {props.retryLabel && (
          <button type="button" className="btn btn--ghost" onClick={props.onRetry}>
            {props.retryLabel}
          </button>
        )}
        <button type="button" className="btn btn--primary" onClick={props.onDone}>
          {props.doneLabel}
          <marks.Arrow width={30} />
        </button>
      </div>
    </>
  );
}
