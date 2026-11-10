import { formatUsd } from '../format.ts';

export interface CostMeterProps {
  costUsdPerMonth: number;
  budgetUsdPerMonth: number;
  compact?: boolean;
}

/** Monthly cost against the level budget. Turns red over budget. */
export function CostMeter({ costUsdPerMonth, budgetUsdPerMonth, compact = false }: CostMeterProps) {
  const over = costUsdPerMonth > budgetUsdPerMonth;
  const fraction = budgetUsdPerMonth > 0 ? Math.min(1, costUsdPerMonth / budgetUsdPerMonth) : 1;
  return (
    <div
      className={`cost-meter${over ? ' is-over' : ''}${compact ? ' cost-meter--compact' : ''}`}
      role="meter"
      aria-label="Monthly cost"
      aria-valuemin={0}
      aria-valuemax={budgetUsdPerMonth}
      aria-valuenow={costUsdPerMonth}
    >
      <div className="cost-meter__row">
        {!compact && <span className="eyebrow">Cost</span>}
        <span className="cost-meter__value num">
          {formatUsd(costUsdPerMonth)}
          <span className="muted"> / {formatUsd(budgetUsdPerMonth)} per month</span>
        </span>
      </div>
      <div className="cost-meter__track">
        <div className="cost-meter__fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      {over && !compact && (
        <div className="cost-meter__warning">Over budget by {formatUsd(costUsdPerMonth - budgetUsdPerMonth)}</div>
      )}
    </div>
  );
}
