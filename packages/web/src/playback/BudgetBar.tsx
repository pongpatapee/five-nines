import { formatCount, formatPercent } from '../format.ts';
import type { BudgetUsage } from './series.ts';

/**
 * The pass-level error budget (0.1% of all requests in the run) as a draining bar: full at the start, empty and red
 * once cumulative failures exceed it.
 */
export function BudgetBar({ usage }: { usage: BudgetUsage }) {
  const remaining = Math.max(0, 1 - usage.fraction);
  const tone = usage.exhausted ? 'exhausted' : remaining < 0.25 ? 'low' : 'ok';
  return (
    <div className="pb-budget" data-tone={tone}>
      <div className="pb-budget__header">
        <span className="eyebrow">Error budget</span>
        <span className="pb-budget__status num">
          {usage.exhausted ? 'Exhausted' : `${formatPercent(remaining)} left`}
        </span>
      </div>
      <div
        className="pb-budget__track"
        role="meter"
        aria-label="Error budget remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remaining * 100)}
      >
        <div className="pb-budget__fill" style={{ transform: `scaleX(${remaining})` }} />
      </div>
      <div className="pb-budget__detail faint num">
        {formatCount(usage.used)} / {formatCount(usage.budget)} failed requests
      </div>
    </div>
  );
}
