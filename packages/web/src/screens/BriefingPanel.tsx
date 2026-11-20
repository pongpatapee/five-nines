import { designCostUsdPerMonth, levelNumbers, type Design, type Level } from '@five-nines/sim';
import { Fragment, useMemo } from 'react';
import { COMPONENTS } from '../components/registry.ts';
import { capitalize } from '../format.ts';
import { BriefingCard, cast, CastLine, componentNames, marks, NumbersBox, story, troublemakerTease, words } from '../theme/index.ts';
import { CostMeter } from './CostMeter.tsx';
import { LevelProduct } from './LevelProduct.tsx';

export interface BriefingPanelProps {
  level: Level;
  levelNumber: number;
  /** The design whose cost the meter shows: the draft in build mode, the run snapshot otherwise. */
  design: Design;
  collapsed: boolean;
  onToggle(): void;
  /** Opens the napkin-math working again; null when there's none to show yet, or it can't open now. */
  onShowEstimateWorking?: (() => void) | null;
  /** Opens the opt-in napkin-math question; null when the level has none, or it can't open now. */
  onOpenEstimate?: (() => void) | null;
  /** Whether the napkin bonus is already earned on this level. */
  estimateBonus?: boolean;
}

/**
 * Left side panel, in every mode: the live cost, then the theme's briefing card (the founder's line, the goal, the
 * mentor's margin note, the numbers drawn, and the opt-in napkin challenge). Behind its "more": the boss's brief, the
 * plain briefing, the full numbers, the troublemaker's tease and the component reference card. The plain briefing and
 * the numbers are the source of truth; the card is the way into them (docs/design.md, "Briefing").
 */
export function BriefingPanel({
  level,
  levelNumber,
  design,
  collapsed,
  onToggle,
  onShowEstimateWorking,
  onOpenEstimate,
  estimateBonus = false,
}: BriefingPanelProps) {
  const cost = designCostUsdPerMonth(design);
  const tease = troublemakerTease(level);
  const numbers = useMemo(() => levelNumbers(level), [level]);
  const memo = useMemo(() => story.memo(level.id, numbers), [level.id, numbers]);
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
          <LevelProduct levelId={level.id} />
        </div>
        <button type="button" className="btn btn--ghost btn--sm briefing__toggle" onClick={onToggle} title="Hide briefing">
          «
        </button>
      </div>

      <div className="briefing__scroll">
        <CostMeter costUsdPerMonth={cost} budgetUsdPerMonth={level.requirements.budgetUsdPerMonth} />
        <BriefingCard
          memo={memo}
          numbers={numbers}
          traffic={level.workload.traffic}
          challenge={
            onOpenEstimate ? (
              <button
                type="button"
                className="btn btn--sm briefing__challenge"
                data-earned={estimateBonus}
                onClick={onOpenEstimate}
              >
                {estimateBonus ? (
                  <>
                    <marks.Met /> {cast.mentorEstimate.challengeEarned}
                  </>
                ) : (
                  cast.mentorEstimate.challenge
                )}
              </button>
            ) : null
          }
          more={
            <>
              <CastLine role="boss" size={64} className="briefing__boss">
                "{cast.bossBrief(level)}"
              </CastLine>
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
            </>
          }
        />
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
