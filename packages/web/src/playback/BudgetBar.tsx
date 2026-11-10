import { formatCount } from '../format.ts';
import { InkLoop, TALLY_BUNDLE, tallyState } from '../notebook/index.ts';
import type { BudgetUsage } from './series.ts';

const BUNDLE_WIDTH = 38;
const HEIGHT = 56;

/**
 * The pass-level error budget (0.1% of all requests in the run) as tally marks in bundles of five. Strokes are
 * crossed out as failures spend the budget; once it's exhausted the whole tally is struck through in red pen.
 */
export function BudgetBar({ usage }: { usage: BudgetUsage }) {
  const tally = tallyState(usage.fraction, usage.exhausted);
  const remaining = Math.max(0, 1 - usage.fraction);
  const bundles = tally.total / TALLY_BUNDLE;
  const width = bundles * BUNDLE_WIDTH + 4;
  // The strike runs to the end of the last spent stroke.
  const strikeTo = strokeX(tally.spent - 1) + 4;
  const tone = usage.exhausted ? 'exhausted' : remaining < 0.25 ? 'low' : 'ok';

  return (
    <div className="pb-budget" data-tone={tone}>
      <div className="pb-budget__header">
        <span className="hand pb-budget__title">error budget</span>
        <span className="pb-budget__detail num">
          {formatCount(usage.used)} / {formatCount(usage.budget)} failed requests
        </span>
      </div>
      <div className="pb-budget__row">
        <svg
          className="pb-budget__tally"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="meter"
          aria-label="Error budget remaining"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(remaining * 100)}
          aria-valuetext={usage.exhausted ? 'Exhausted' : `${Math.round(remaining * 100)}% left`}
        >
          {Array.from({ length: tally.total }, (_, i) => (
            <TallyStroke key={i} index={i} spent={i < tally.spent} />
          ))}
          {tally.spent > 0 && (
            <path
              className="pb-budget__strike"
              d={`M2,${HEIGHT / 2 - 2} C${strikeTo * 0.3},${HEIGHT / 2 - 8} ${strikeTo * 0.6},${HEIGHT / 2 + 6} ${strikeTo},${HEIGHT / 2 - 3}`}
            />
          )}
          {usage.exhausted && (
            <path
              className="pb-budget__strike pb-budget__strike--second ink-draw"
              pathLength={1}
              d={`M4,${HEIGHT / 2 + 9} C${width * 0.25},${HEIGHT / 2 + 16} ${width * 0.5},${HEIGHT / 2 + 2} ${width * 0.75},${HEIGHT / 2 + 12} S${width - 6},${HEIGHT / 2 + 4} ${width - 2},${HEIGHT / 2 + 8}`}
            />
          )}
        </svg>
        <div className="pb-budget__left">
          {usage.exhausted ? (
            <span className="pb-budget__zero">
              <InkLoop width={110} height={56} />
              <span className="hand">0 left!</span>
            </span>
          ) : (
            <span className="hand pb-budget__count">
              {tally.left} / {tally.total} marks left
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function strokeX(index: number): number {
  const bundle = Math.floor(index / TALLY_BUNDLE);
  const k = index % TALLY_BUNDLE;
  return 6 + bundle * BUNDLE_WIDTH + (k === TALLY_BUNDLE - 1 ? 24 : k * 7);
}

/** Four uprights and a diagonal per bundle, slightly uneven like real handwriting. */
function TallyStroke({ index, spent }: { index: number; spent: boolean }) {
  const bundle = Math.floor(index / TALLY_BUNDLE);
  const k = index % TALLY_BUNDLE;
  const x0 = 6 + bundle * BUNDLE_WIDTH;
  const wobble = ((bundle * 7 + k * 3) % 5) - 2;
  const d =
    k === TALLY_BUNDLE - 1
      ? `M${x0 - 5},${HEIGHT - 16} L${x0 + 27},${14 + wobble * 0.5}`
      : `M${x0 + k * 7},${10 + wobble * 0.6} L${x0 + k * 7 + (wobble > 0 ? 1 : 0)},${HEIGHT - 10 + wobble * 0.4}`;
  return <path d={d} className={`pb-budget__stroke${spent ? ' is-spent' : ''}`} />;
}
