import { designCostUsdPerMonth, type Level } from '@five-nines/sim';
import { useMemo } from 'react';
import { DesignCanvas, draftFromDesign } from '../canvas/index.ts';
import { formatUsdPerMonth, GRADE_LABELS } from '../format.ts';
import { marks } from '../theme/index.ts';

export interface DebriefPanelProps {
  level: Level;
  /** Show a spoiler warning: the player hasn't passed this level yet. */
  spoilers: boolean;
  onClose(): void;
  /** Label of the close button, e.g. "Back to result" or "Close". */
  closeLabel?: string;
}

/** The level's debrief, reference solutions (as read-only canvases) and common traps. */
export function DebriefPanel({ level, spoilers, onClose, closeLabel = 'Close' }: DebriefPanelProps) {
  return (
    <section className="debrief panel" aria-labelledby="debrief-title">
      <header className="panel__header debrief__header">
        <div>
          <div className="eyebrow">{level.concept}</div>
          <h2 id="debrief-title" className="debrief__title hand">
            Debrief &amp; solutions
          </h2>
        </div>
        <div className="debrief__header-actions">
          {spoilers && <span className="spoiler-tag">Spoilers: you haven't passed this level yet</span>}
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
              name={solution.name}
              explanation={solution.explanation}
              design={solution.design}
              badge={GRADE_LABELS[solution.expectedGrade]}
              grade={solution.expectedGrade}
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

function SolutionCard({
  name,
  explanation,
  design,
  badge,
  grade,
}: {
  name: string;
  explanation: string;
  design: Level['solutions'][number]['design'];
  badge: string;
  grade: string;
}) {
  const draft = useMemo(() => draftFromDesign(design), [design]);
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
      </div>
    </article>
  );
}
