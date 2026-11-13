import { isCloseEstimate, workEstimate, type Estimate, type Level } from '@five-nines/sim';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type Ref } from 'react';
import { formatCount } from '../format.ts';
import type { EstimateRecord } from '../state/index.ts';
import { cast, CastLine, marks } from '../theme/index.ts';
import { parseEstimateInput } from './estimate.ts';

export interface EstimateStepProps {
  level: Level;
  estimate: Estimate;
  /** What the player answered before on this level, if anything. */
  record: EstimateRecord | undefined;
  /** A guess was checked. `close` earns the bonus mark. */
  onAnswer(guess: number, close: boolean): void;
  /** The player skipped the question. */
  onSkip(): void;
  /** Done: back to building. */
  onClose(): void;
}

type Phase = { kind: 'ask' } | { kind: 'answered'; guess: number; close: boolean };

/**
 * The napkin-maths step before building (docs/design.md, "Estimate step"): the mentor asks one question worked out
 * from the level's numbers, the player answers or skips, and gets the working either way they answer.
 */
export function EstimateStep({ level, estimate, record, onAnswer, onSkip, onClose }: EstimateStepProps) {
  const working = useMemo(() => workEstimate(level, estimate), [level, estimate]);
  const { question, unit } = cast.mentorEstimate.ask(working);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    if (phase.kind === 'ask') inputRef.current?.focus();
    else doneRef.current?.focus();
  }, [phase.kind]);

  // Esc leaves the step: a skip if nothing was answered yet.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (phase.kind === 'ask') onSkip();
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase.kind, onSkip, onClose]);

  const check = (event: FormEvent) => {
    event.preventDefault();
    const guess = parseEstimateInput(text);
    if (guess === null) {
      setError('Type one number, like 12 or 3.5.');
      return;
    }
    const close = isCloseEstimate(guess, estimate.answer);
    onAnswer(guess, close);
    setPhase({ kind: 'answered', guess, close });
  };

  const show = (value: number) => (Math.abs(value) >= 100 ? formatCount(value) : String(Number(value.toFixed(1))));

  return (
    <div className="estimate-overlay">
      <section className="estimate-card" role="dialog" aria-labelledby="estimate-title">
        <span className="tape tape--center" aria-hidden />
        <h2 id="estimate-title" className="estimate-card__title hand">
          Napkin maths
        </h2>

        {phase.kind === 'ask' ? (
          <>
            <CastLine role="mentor" size={64} className="estimate-card__mentor">
              {question}
            </CastLine>
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
              <button type="button" className="btn btn--ghost" onClick={onSkip}>
                Skip for now
              </button>
            </div>
          </>
        ) : (
          <Answered
            verdict={cast.mentorEstimate.verdict({ guess: phase.guess, answer: estimate.answer, close: phase.close })}
            close={phase.close}
            guess={`${show(phase.guess)} ${unit}`}
            answer={`${show(estimate.answer)} ${unit}`}
            working={cast.mentorEstimate.working(working)}
            doneRef={doneRef}
            onDone={onClose}
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
  close: boolean;
  guess: string;
  answer: string;
  working: string;
  doneRef: Ref<HTMLButtonElement>;
  onDone(): void;
  onRetry(): void;
}) {
  return (
    <>
      <CastLine
        role="mentor"
        size={64}
        mood={props.close ? 'pleased' : 'concerned'}
        lead={props.verdict.exclaim}
        tone={props.close ? 'note' : 'alarm'}
        className="estimate-card__mentor"
      >
        {props.verdict.line}
      </CastLine>
      <dl className="estimate-card__compare">
        <div>
          <dt>Your estimate</dt>
          <dd className="num">{props.guess}</dd>
        </div>
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
      <p className="estimate-card__working">{props.working}</p>
      <div className="estimate-card__actions">
        {!props.close && (
          <button type="button" className="btn btn--ghost" onClick={props.onRetry}>
            Try again
          </button>
        )}
        <button ref={props.doneRef} type="button" className="btn btn--primary" onClick={props.onDone}>
          Start building
          <marks.Arrow width={30} />
        </button>
      </div>
    </>
  );
}
