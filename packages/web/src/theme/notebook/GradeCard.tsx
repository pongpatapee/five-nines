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
import { MAX_NINES_PER_LEVEL, ninesForGrade, type BadgeId } from '../../progression/index.ts';
import { gradeHeadline, litTiers, nextTier, tierPercent, tierRequirementLabel, TIER_ORDER } from '../../results/grading.ts';
import type { GradeCardProps, HintLadderProps, RewardView } from '../contract.ts';
import { verdictFor, type SavingsSituation } from '../situations.ts';
import { BADGE_GLYPHS } from './BadgeShelf.tsx';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { CastLine } from './Characters.tsx';
import { BadgeSeal, Cross, HandArrow, InkLoop, NinesDots, Tick } from './ink.tsx';

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
  solutionLabel,
  onNextLevel,
  reward,
  savings,
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
          <h2 id="grade-card-title" className="grade-card__grade hand stamp-in">
            {!passed && <InkLoop width={150} height={70} delayMs={100} />}
            {GRADE_LABELS[grade]}
          </h2>
          <NinesDots filled={reward ? reward.shown.level : ninesForGrade(grade)} total={MAX_NINES_PER_LEVEL} />
        </div>
        <p className="grade-card__headline">{gradeHeadline(grade)}</p>
        {reward && <Payout view={reward} />}
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
        >
          {savings && <Savings situation={savings} />}
        </CheckRow>
      </div>

      {reward && reward.shown.badges.length > 0 && <NewBadges badges={reward.shown.badges} />}

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
        {Object.entries(simulation.payments.peakQueueDepth).map(([id, depth]) => (
          <div key={`depth:${id}`}>
            <dt>{id} peak backlog</dt>
            <dd className="num">{formatCount(depth)}</dd>
          </div>
        ))}
        {Object.entries(simulation.payments.peakQueueWaitSec).map(([id, wait]) => (
          <div key={`wait:${id}`}>
            <dt>{id} longest wait</dt>
            <dd className="num">{formatSeconds(wait)}</dd>
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
      {reward?.reward.capped && <p className="grade-card__note grade-card__capped">{NOTEBOOK_SCRIPT.giveUp.capped}</p>}
      {hints && <HintLadderView {...hints} />}
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
          {solutionLabel}
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

/** The nines this run paid, ticking onto the running total, and any chapter it opened. */
function Payout({ view }: { view: RewardView }) {
  const { reward, shown, openedChapters } = view;
  const gained = reward.totalNines.after - reward.totalNines.before;
  const ticking = shown.total - reward.totalNines.before;
  return (
    <div className="grade-card__payout" data-gained={gained > 0}>
      <p className="grade-card__payout-line">
        <span className="grade-card__payout-gain hand" aria-hidden>
          {gained > 0 ? `+${ticking}` : '+0'}
        </span>
        <span className="grade-card__payout-total num" aria-hidden>
          {shown.total} / {reward.totalNines.total} nines
        </span>
        <span className="visually-hidden">
          {gained > 0
            ? `This run earned ${gained} nines: ${reward.totalNines.after} of ${reward.totalNines.total} in all.`
            : `No new nines this run: ${reward.totalNines.after} of ${reward.totalNines.total} in all.`}
        </span>
      </p>
      {gained === 0 && reward.levelNines.after > 0 && (
        <p className="grade-card__payout-note muted">
          This page has paid its {reward.levelNines.after} already: only a better grade pays more.
        </p>
      )}
      {shown.done &&
        openedChapters.map((chapter) => (
          <p key={chapter.number} className="grade-card__payout-opened stamp-in" role="status">
            {NOTEBOOK_SCRIPT.chapterOpened(chapter.number, chapter.title)}
          </p>
        ))}
    </div>
  );
}

/** Ms. Tally on the money left over: the second score. */
function Savings({ situation }: { situation: SavingsSituation }) {
  return (
    <div className="grade-card__savings">
      <span className="grade-card__savings-figure num">
        {situation.savedUsdPerMonth > 0 ? `${formatUsdPerMonth(situation.savedUsdPerMonth)} under budget` : 'Exactly on budget'}
      </span>
      <CastLine role="boss" size={40} mood={situation.share >= 0.05 ? 'pleased' : 'neutral'} className="grade-card__savings-line">
        {NOTEBOOK_SCRIPT.bossSavings(situation)}
      </CastLine>
    </div>
  );
}

/** Each badge this run earned, stamped onto the page, handed over by whoever would hand it over. */
function NewBadges({ badges }: { badges: readonly BadgeId[] }) {
  return (
    <ul className="grade-card__badges" aria-label="New badges">
      {badges.map((id) => {
        const copy = NOTEBOOK_SCRIPT.badges[id];
        return (
          <li key={id} className="grade-card__badge">
            <span className="stamp-in grade-card__badge-seal">
              <BadgeSeal glyph={BADGE_GLYPHS[id]} earned size={64} />
            </span>
            <CastLine role={copy.role} size={48} lead={`Badge: ${copy.name}`} className="grade-card__badge-line">
              {copy.line}
            </CastLine>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Erasmus's hints, one rung at a time: where to look (or where it broke), why, the idea, the fix. Controlled, so the
 * results card and the hints dialog show the same rungs.
 */
export function HintLadderView({ ladder, shown, onReveal, footer }: HintLadderProps) {
  const total = ladder.rungs.length;
  const visible = Math.min(Math.max(shown, 1), total);
  const words = NOTEBOOK_SCRIPT.mentorLadder;
  const labels = words.stepLabels[ladder.kind];
  // Each new hint takes the focus, so keyboard and screen-reader players land on what they asked for.
  const latest = useRef<HTMLLIElement>(null);
  const revealed = useRef(visible);
  useEffect(() => {
    if (visible > revealed.current) latest.current?.focus();
    revealed.current = visible;
  }, [visible]);
  return (
    <CastLine
      role="mentor"
      mood={ladder.kind === 'run' ? 'concerned' : undefined}
      size={56}
      className="grade-card__mentor"
      lead={`Hint ${visible} of ${total}`}
    >
      <ol className="hint-ladder">
        {ladder.rungs.slice(0, visible).map((rung, i) => (
          <li
            key={rung.step}
            ref={i === visible - 1 ? latest : undefined}
            tabIndex={-1}
            className="hint-ladder__rung"
            data-step={rung.step}
          >
            <b className="hint-ladder__label">{labels[rung.step]}:</b> {rung.text}
          </li>
        ))}
      </ol>
      {visible < total && (
        <button type="button" className="btn btn--sm btn--ghost hint-ladder__more" onClick={onReveal}>
          {words.more} ({visible + 1} of {total})
        </button>
      )}
      {footer && <div className="hint-ladder__footer">{footer}</div>}
    </CastLine>
  );
}
