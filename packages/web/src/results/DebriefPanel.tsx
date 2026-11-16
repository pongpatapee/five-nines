import { CLIENTS_ID, designCostUsdPerMonth, peakLoad, type Design, type Level } from '@five-nines/sim';
import { useEffect, useMemo, useRef } from 'react';
import { DesignCanvas, draftFromDesign } from '../canvas/index.ts';
import { formatCount, formatPercent, formatUsdPerMonth, GRADE_LABELS } from '../format.ts';
import { cast, marks } from '../theme/index.ts';

export interface DebriefPanelProps {
  level: Level;
  /** The player saw this before passing: the page pays at most a pass. */
  peeked: boolean;
  onClose(): void;
  /** Label of the close button, e.g. "Back to result" or "Close". */
  closeLabel?: string;
  /** Puts a solution on the player's canvas (their own design is kept aside first). Null where it can't. */
  onLoad: ((design: Design) => void) | null;
  /** Puts the player's kept design back. Null when nothing is kept aside. */
  onSwitchBack: (() => void) | null;
}

/**
 * The solution page: the level's debrief, every reference solution drawn on the notebook with its explanation and key
 * numbers (what it costs, how busy each part is at the peak), and the common traps.
 */
export function DebriefPanel({ level, peeked, onClose, closeLabel = 'Close', onLoad, onSwitchBack }: DebriefPanelProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  return (
    <section className="debrief panel" role="dialog" aria-modal="true" aria-labelledby="debrief-title">
      <header className="panel__header debrief__header">
        <div>
          <div className="eyebrow">{level.concept}</div>
          <h2 ref={titleRef} tabIndex={-1} id="debrief-title" className="debrief__title hand">
            {cast.giveUp.pageTitle}
          </h2>
        </div>
        <div className="debrief__header-actions">
          {peeked && <span className="spoiler-tag">{capitalizeFirst(cast.giveUp.peekedNote)}</span>}
          {onSwitchBack && (
            <button type="button" className="btn" onClick={onSwitchBack}>
              {cast.giveUp.switchBack}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </header>

      <div className="debrief__body">
        <div className="debrief__prose">
          {level.debrief.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        <h3 className="debrief__section-title">Reference solutions</h3>
        <div className="debrief__solutions">
          {level.solutions.map((solution) => (
            <SolutionCard
              key={solution.name}
              level={level}
              name={solution.name}
              explanation={solution.explanation}
              design={solution.design}
              badge={GRADE_LABELS[solution.expectedGrade]}
              grade={solution.expectedGrade}
              onLoad={onLoad ? () => onLoad(solution.design) : null}
            />
          ))}
        </div>

        {level.antiSolutions.length > 0 && (
          <>
            <h3 className="debrief__section-title">Common traps</h3>
            <ul className="debrief__traps">
              {level.antiSolutions.map((trap) => (
                <li key={trap.name} className="trap">
                  <div className="trap__head">
                    <span className="trap__name">
                      <marks.NotMet size={14} />
                      {trap.name}
                    </span>
                    <span className="trap__fails">
                      {trap.expectedFailure === 'invalid' ? "can't run" : `fails ${trap.expectedFailure.join(', ')}`}
                    </span>
                  </div>
                  <p className="trap__explanation">{trap.explanation}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function SolutionCard({
  level,
  name,
  explanation,
  design,
  badge,
  grade,
  onLoad,
}: {
  level: Level;
  name: string;
  explanation: string;
  design: Design;
  badge: string;
  grade: string;
  onLoad: (() => void) | null;
}) {
  const draft = useMemo(() => draftFromDesign(design), [design]);
  const numbers = useMemo(() => keyNumbers(level, design), [level, design]);
  return (
    <article className="solution">
      <div className="solution__canvas">
        <DesignCanvas mode="readOnly" draft={draft} panZoom={false} />
      </div>
      <div className="solution__text">
        <div className="solution__head">
          <h4 className="solution__name">{name}</h4>
          <span className="grade-badge" data-grade={grade}>
            {badge}
          </span>
        </div>
        <div className="solution__cost num muted">{formatUsdPerMonth(designCostUsdPerMonth(design))}</div>
        <p className="solution__explanation">{explanation}</p>
        <dl className="solution__numbers">
          {numbers.map((row) => (
            <div key={row.id} className="solution__number">
              <dt className="num">{row.id}</dt>
              <dd className="num">{row.text}</dd>
            </div>
          ))}
        </dl>
        {onLoad && (
          <button type="button" className="btn btn--sm solution__load" onClick={onLoad}>
            {cast.giveUp.load}
          </button>
        )}
      </div>
    </article>
  );
}

/** How busy each part of a solution is at the level's peak: "app: 5 machines, 62% busy (3,100 of 5,000 requests/s each)". */
function keyNumbers(level: Level, design: Design): { id: string; text: string }[] {
  const load = peakLoad(level, design);
  return design.nodes
    .filter((node) => node.id !== CLIENTS_ID && load.nodes[node.id])
    .map((node) => {
      const n = load.nodes[node.id]!;
      const machines = n.machines > 1 ? `${n.machines} machines, ` : '';
      const busy = Number.isFinite(n.utilization) ? `${formatPercent(n.utilization)} busy` : 'nothing left to serve';
      const each = n.capacity > 0 ? ` (${formatCount(n.load)} of ${formatCount(n.capacity)} ${n.unit}/s${n.machines > 1 ? ' each' : ''})` : '';
      return { id: node.id, text: `${machines}${busy}${each}` };
    });
}
