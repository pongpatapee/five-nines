import type { Grade } from '@five-nines/sim';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { describeCause } from '../../describe.ts';
import {
  formatAvailability,
  formatCount,
  formatMs,
  formatPercent,
  formatSeconds,
  formatUsdPerMonth,
  GRADE_LABELS,
} from '../../format.ts';
import {
  gradeHeadline,
  litTiers,
  nextTier,
  NINES_PER_LEVEL,
  ninesForGrade,
  tierPercent,
  tierRequirementLabel,
  TIER_ORDER,
} from '../../results/grading.ts';
import type { GradeCardProps } from '../contract.ts';
import { verdictFor, type HintLadder } from '../situations.ts';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { CastLine } from './Characters.tsx';
import { Cross, HandArrow, InkLoop, NinesDots, Tick } from './ink.tsx';

/** The graded result as a marked notebook page: the grade circled, the boss's verdict, ticks and crosses. */
export function GradeCard({
  level,
  levelNumber,
  evaluation,
  hints,
  failover,
  onBackToEditor,
  onReplay,
  onShowDebrief,
  onNextLevel,
}: GradeCardProps) {
  const { grade, checks, simulation } = evaluation;
  const passed = grade !== 'fail';
  const upNext = nextTier(grade);
  const mainCause = simulation.causes[0];
  const verdict = NOTEBOOK_SCRIPT.bossVerdict(verdictFor(evaluation));

  return (
    <section className="grade-card" aria-labelledby="grade-card-title" data-grade={grade}>
      <span className="tape tape--left" aria-hidden />
      <span className="tape tape--right" aria-hidden />
      <header className="grade-card__head">
        <div className="eyebrow">
          p.{levelNumber} · {level.title} · graded
        </div>
        <div className="grade-card__mark">
          <h2 id="grade-card-title" className="grade-card__grade hand">
            {!passed && <InkLoop width={150} height={70} delayMs={100} />}
            {GRADE_LABELS[grade]}
          </h2>
          <NinesDots filled={ninesForGrade(grade)} total={NINES_PER_LEVEL} />
        </div>
        <p className="grade-card__headline">{gradeHeadline(grade)}</p>
      </header>

      <CastLine
        role="boss"
        mood={passed ? 'pleased' : 'concerned'}
        size={92}
        lead={verdict.exclaim}
        tone={passed ? 'note' : 'alarm'}
        className="grade-card__boss"
      >
        {verdict.line}
      </CastLine>

      <div className="grade-card__checks">
        <CheckRow
          label="Availability"
          ok={checks.availability.ok}
          actual={formatAvailability(checks.availability.value)}
          required={`≥ ${tierPercent('pass')}`}
        >
          <TierLadder grade={grade} />
        </CheckRow>
        <CheckRow
          label="p99 latency"
          ok={checks.latency.ok}
          actual={formatMs(checks.latency.p99Ms)}
          required={`≤ ${formatMs(checks.latency.requiredMs)}`}
        />
        <CheckRow
          label="Cost"
          ok={checks.budget.ok}
          actual={formatUsdPerMonth(checks.budget.costUsdPerMonth)}
          required={`≤ ${formatUsdPerMonth(checks.budget.budgetUsdPerMonth)}`}
        />
      </div>

      <dl className="grade-card__facts">
        <div>
          <dt>Requests</dt>
          <dd className="num">{formatCount(simulation.totalRequests)}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd className="num">{formatCount(simulation.failedRequests)}</dd>
        </div>
        <div>
          <dt>p50</dt>
          <dd className="num">{formatMs(simulation.latency.p50Ms)}</dd>
        </div>
        {Object.entries(simulation.dataTier.cacheHitRate).map(([id, hitRate]) => (
          <div key={`hit:${id}`}>
            <dt>{id} hit rate</dt>
            <dd className="num">{formatPercent(hitRate, hitRate < 0.1 ? 1 : 0)}</dd>
          </div>
        ))}
        {Object.entries(simulation.dataTier.peakReplicationLagSec).map(([id, lag]) => (
          <div key={`lag:${id}`}>
            <dt>{id} peak lag</dt>
            <dd className="num">{formatSeconds(lag)}</dd>
          </div>
        ))}
      </dl>

      {failover && (
        <div className="grade-card__failover">
          <b className="grade-card__failover-label">Failover</b>
          <ul>
            {NOTEBOOK_SCRIPT.failoverLines(failover).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {passed && mainCause && (
        <p className="grade-card__note">
          <b className="grade-card__note-label">First failure:</b> {describeCause(mainCause)}
        </p>
      )}
      {hints && <MentorHints key={hints.topic} ladder={hints} />}
      {upNext && passed && <p className="grade-card__note muted">Next: {tierRequirementLabel(upNext)}.</p>}
      {evaluation.warnings.length > 0 && (
        <ul className="grade-card__warnings">
          {evaluation.warnings.map((warning, i) => (
            <li key={i}>{warning.message}</li>
          ))}
        </ul>
      )}

      <footer className="grade-card__actions">
        <button type="button" className={passed ? 'btn' : 'btn btn--primary'} onClick={onBackToEditor}>
          Back to editor
        </button>
        <button type="button" className="btn" onClick={onReplay}>
          Replay
        </button>
        <button type="button" className="btn" onClick={onShowDebrief}>
          Debrief &amp; solutions
        </button>
        {onNextLevel && (
          <button type="button" className="btn btn--primary" onClick={onNextLevel}>
            Next page
            <HandArrow width={30} />
          </button>
        )}
      </footer>
    </section>
  );
}

function CheckRow({
  label,
  ok,
  actual,
  required,
  children,
}: {
  label: string;
  ok: boolean;
  actual: string;
  required: string;
  children?: ReactNode;
}) {
  return (
    <div className="check-row" data-ok={ok}>
      <span className="check-row__icon">{ok ? <Tick label="met" /> : <Cross label="not met" />}</span>
      <span className="check-row__label">{label}</span>
      <span className="check-row__actual num">{actual}</span>
      <span className="check-row__required num muted">{required}</span>
      {children && <div className="check-row__extra">{children}</div>}
    </div>
  );
}

/** Pass, star and mastered thresholds, lit up to the grade earned. A failed run lights none, and says why. */
function TierLadder({ grade }: { grade: Grade }) {
  const lit = litTiers(grade);
  return (
    <>
      <ol className="tier-ladder" aria-label="Nines earned">
        {TIER_ORDER.map((tier) => {
          const reached = lit.includes(tier);
          return (
            <li key={tier} className="tier-ladder__step" data-tier={tier} data-reached={reached}>
              <span className="tier-ladder__name">{GRADE_LABELS[tier]}</span>
              <span className="tier-ladder__value num">{tierPercent(tier)}</span>
              <span className="visually-hidden">{reached ? ', earned' : ', not earned'}</span>
            </li>
          );
        })}
      </ol>
      {grade === 'fail' && <p className="tier-ladder__void">No nines this run: they only count when every check passes.</p>}
    </>
  );
}

/** Erasmus's hints, one rung at a time: where it broke, why, the idea, the fix. */
function MentorHints({ ladder }: { ladder: HintLadder }) {
  const [shown, setShown] = useState(1);
  const total = ladder.rungs.length;
  const words = NOTEBOOK_SCRIPT.mentorLadder;
  // Each new hint takes the focus, so keyboard and screen-reader players land on what they asked for.
  const latest = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (shown > 1) latest.current?.focus();
  }, [shown]);
  return (
    <CastLine
      role="mentor"
      mood="concerned"
      size={56}
      className="grade-card__mentor"
      lead={`Hint ${shown} of ${total}`}
    >
      <ol className="hint-ladder">
        {ladder.rungs.slice(0, shown).map((rung, i) => (
          <li
            key={rung.step}
            ref={i === shown - 1 ? latest : undefined}
            tabIndex={-1}
            className="hint-ladder__rung"
            data-step={rung.step}
          >
            <b className="hint-ladder__label">{words.stepLabels[rung.step]}:</b> {rung.text}
          </li>
        ))}
      </ol>
      {shown < total && (
        <button type="button" className="btn btn--sm btn--ghost hint-ladder__more" onClick={() => setShown(shown + 1)}>
          {words.more} ({shown + 1} of {total})
        </button>
      )}
    </CastLine>
  );
}
