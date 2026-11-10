import {
  APP_SERVER_SIZES,
  COMPONENT_LABELS,
  designCostUsdPerMonth,
  LOAD_BALANCER,
  type AppServerSize,
  type Design,
  type Level,
} from '@five-nines/sim';
import { formatDuration, formatMs, formatUsdPerMonth, GRADE_LABELS } from '../format.ts';
import { tierPercent } from '../results/grading.ts';
import { CostMeter } from './CostMeter.tsx';

export interface BriefingPanelProps {
  level: Level;
  levelNumber: number;
  /** The design whose cost the meter shows: the draft in build mode, the run snapshot otherwise. */
  design: Design;
  collapsed: boolean;
  onToggle(): void;
}

/** Left side panel, in every mode: briefing, requirements, component reference card and live cost. */
export function BriefingPanel({ level, levelNumber, design, collapsed, onToggle }: BriefingPanelProps) {
  const cost = designCostUsdPerMonth(design);
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
            Level {levelNumber} · {level.concept}
          </div>
          <h1 className="briefing__title">{level.title}</h1>
        </div>
        <button type="button" className="btn btn--ghost btn--sm briefing__toggle" onClick={onToggle} title="Hide briefing">
          «
        </button>
      </div>

      <div className="briefing__scroll">
        <CostMeter costUsdPerMonth={cost} budgetUsdPerMonth={level.requirements.budgetUsdPerMonth} />

        <section className="briefing__section">
          <h2 className="briefing__section-title">Briefing</h2>
          <div className="briefing__prose">
            {level.briefing.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section className="briefing__section">
          <h2 className="briefing__section-title">Requirements</h2>
          <dl className="spec-list">
            <div>
              <dt>Availability</dt>
              <dd className="num">
                ≥ {tierPercent('pass')}
                <span className="spec-list__tiers">
                  {GRADE_LABELS.star} {tierPercent('star')} · {GRADE_LABELS.mastered} {tierPercent('mastered')}
                </span>
              </dd>
            </div>
            <div>
              <dt>p99 latency</dt>
              <dd className="num">≤ {formatMs(level.requirements.p99Ms)}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd className="num">≤ {formatUsdPerMonth(level.requirements.budgetUsdPerMonth)}</dd>
            </div>
            <div>
              <dt>Run length</dt>
              <dd className="num">{formatDuration(level.durationSec)}</dd>
            </div>
          </dl>
        </section>

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
        {components.includes('appServer') && (
          <>
            <tr className="reference-card__group">
              <th colSpan={3}>{COMPONENT_LABELS.appServer} (per instance)</th>
            </tr>
            {(Object.keys(APP_SERVER_SIZES) as AppServerSize[]).map((size) => (
              <tr key={size}>
                <td>{size}</td>
                <td className="num">{APP_SERVER_SIZES[size].vcpu} vCPU</td>
                <td className="num">{formatUsdPerMonth(APP_SERVER_SIZES[size].usdPerMonth)}</td>
              </tr>
            ))}
          </>
        )}
        {components.includes('loadBalancer') && (
          <>
            <tr className="reference-card__group">
              <th colSpan={3}>{COMPONENT_LABELS.loadBalancer}</th>
            </tr>
            <tr>
              <td>any</td>
              <td className="num">{formatMs(LOAD_BALANCER.latencyMs)} added</td>
              <td className="num">{formatUsdPerMonth(LOAD_BALANCER.usdPerMonth)}</td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}
