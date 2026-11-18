import { designCostUsdPerMonth, levelNumbers, type Design, type Level } from '@five-nines/sim';
import { Fragment, useMemo } from 'react';
import { COMPONENTS } from '../components/registry.ts';
import { capitalize } from '../format.ts';
import { cast, CastLine, componentNames, NumbersBox, troublemakerTease, words } from '../theme/index.ts';
import { CostMeter } from './CostMeter.tsx';

export interface BriefingPanelProps {
  level: Level;
  levelNumber: number;
  /** The design whose cost the meter shows: the draft in build mode, the run snapshot otherwise. */
  design: Design;
  collapsed: boolean;
  onToggle(): void;
  /** Opens the napkin-math working again; null when there's none to show yet, or it can't open now. */
  onShowEstimateWorking?: (() => void) | null;
}

/** Left side panel, in every mode: briefing, the level's numbers, component reference card and live cost. */
export function BriefingPanel({ level, levelNumber, design, collapsed, onToggle, onShowEstimateWorking }: BriefingPanelProps) {
  const cost = designCostUsdPerMonth(design);
  const tease = troublemakerTease(level);
  const numbers = useMemo(() => levelNumbers(level), [level]);
  if (collapsed) {
    return (
      <aside className="briefing briefing--collapsed" aria-label="Briefing (collapsed)">
        <button type="button" className="btn btn--ghost btn--sm briefing__toggle" onClick={onToggle} title="Show briefing">
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="briefing" aria-label="Briefing">
      <div className="briefing__head">
        <div>
          <div className="eyebrow">
            {capitalize(words.level)} {levelNumber} · {level.concept}
          </div>
          <h1 className="briefing__title hand">{level.title}</h1>
        </div>
        <button type="button" className="btn btn--ghost btn--sm briefing__toggle" onClick={onToggle} title="Hide briefing">
          «
        </button>
      </div>

      <div className="briefing__scroll">
        <CastLine role="boss" size={84} className="briefing__boss">
          "{cast.bossBrief(level)}"
        </CastLine>

        <CostMeter costUsdPerMonth={cost} budgetUsdPerMonth={level.requirements.budgetUsdPerMonth} />

        <section className="briefing__section">
          <h2 className="briefing__section-title">Briefing</h2>
          <div className="briefing__prose">
            {level.briefing.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          {onShowEstimateWorking && (
            <button type="button" className="btn btn--sm btn--ghost briefing__napkin" onClick={onShowEstimateWorking}>
              {cast.mentorEstimate.revisit}
            </button>
          )}
        </section>

        <NumbersBox numbers={numbers} variant="briefing" />

        {tease && (
          <CastLine role="troublemaker" size={56} tone="alarm" className="briefing__troublemaker">
            {tease}
          </CastLine>
        )}

        <section className="briefing__section">
          <h2 className="briefing__section-title">Component reference</h2>
          <ReferenceCard components={level.components} />
        </section>
      </div>
    </aside>
  );
}

function ReferenceCard({ components }: { components: Level['components'] }) {
  return (
    <table className="reference-card">
      <tbody>
        {components.map((kind) => {
          const { per, rows } = COMPONENTS[kind].reference;
          const { product, concept } = componentNames[kind];
          return (
            <Fragment key={kind}>
              <tr className="reference-card__group">
                <th colSpan={3}>
                  {product} <span className="reference-card__concept">{concept}</span>
                  {per && <span className="reference-card__per"> ({per})</span>}
                </th>
              </tr>
              {rows.map(([option, capacity, price]) => (
                <tr key={option}>
                  <td>{option}</td>
                  <td className="num">{capacity}</td>
                  <td className="num">{price}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
