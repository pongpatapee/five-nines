/**
 * Expected peak utilization as a pressure dial inked in the margin: green to 70%, amber to 85%, red to 100%, and a
 * hatched red stretch past it for overload. The needle stops at the end stop when there's nothing left to serve.
 */
import { COMFORTABLE_UTILIZATION, HOT_UTILIZATION, utilizationZone, type UtilizationZone } from '@five-nines/sim';
import { formatPercent } from '../../format.ts';
import type { GaugeMeasure, UtilizationGaugeProps } from '../contract.ts';

/** What each zone is called next to the reading, by what the gauge measures. */
export const ZONE_WORDS: Record<GaugeMeasure, Record<UtilizationZone, string>> = {
  busy: { comfortable: 'comfortable', busy: 'busy', hot: 'hot: p99 climbs', overloaded: 'overloaded' },
  deadline: {
    comfortable: 'well inside the deadline',
    busy: 'most of the deadline',
    hot: 'close to the deadline',
    overloaded: 'misses the deadline',
  },
  room: { comfortable: 'room to spare', busy: 'filling up', hot: 'nearly full', overloaded: 'overflows: orders refused' },
  backlog: {
    comfortable: 'backlog clears',
    busy: 'backlog building',
    hot: 'backlog near its limit',
    overloaded: 'backlog over its limit',
  },
};

/**
 * The word beside a node's small dial, short enough for the canvas: nothing while comfortable, then a word at each
 * line it crosses (70%, 85%, 100%).
 */
export const ZONE_SHORT_WORDS: Record<GaugeMeasure, Record<UtilizationZone, string>> = {
  busy: { comfortable: '', busy: 'busy', hot: 'too busy', overloaded: 'overloaded' },
  deadline: { comfortable: '', busy: 'tight', hot: 'near deadline', overloaded: 'too late' },
  room: { comfortable: '', busy: 'filling', hot: 'nearly full', overloaded: 'overflows' },
  backlog: { comfortable: '', busy: 'building', hot: 'near limit', overloaded: 'over limit' },
};

/** What the reading is, for its label. */
const MEASURE_LABEL: Record<GaugeMeasure, string> = {
  busy: 'Expected peak utilization',
  deadline: 'Expected backlog, as a share of the deadline,',
  room: "Expected backlog, as a share of the queue's room,",
  backlog: 'Expected backlog, as a share of its limit,',
};

/** The dial's full sweep: 0% on the left to this on the right, so overload has room to show. */
const DIAL_MAX = 1.2;
const CX = 50;
const CY = 48;
const R = 38;

function point(fraction: number, radius = R): [number, number] {
  const theta = Math.PI * (1 - Math.min(Math.max(fraction, 0), DIAL_MAX) / DIAL_MAX);
  return [CX + radius * Math.cos(theta), CY - radius * Math.sin(theta)];
}

function arc(from: number, to: number): string {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

/** "88%", or "no capacity left" when every machine is gone. */
export function readingText(utilization: number): string {
  return Number.isFinite(utilization) ? formatPercent(utilization) : 'no capacity left';
}

export function UtilizationGauge({ utilization, variant, measure = 'busy' }: UtilizationGaugeProps) {
  const zone = utilizationZone(utilization);
  const words = ZONE_WORDS[measure][zone];
  const label = `${MEASURE_LABEL[measure]} ${readingText(utilization)}, ${words}`;
  const [nx, ny] = point(Number.isFinite(utilization) ? utilization : DIAL_MAX, R - 7);
  const dial = (
    <svg className="util-gauge__dial" viewBox="0 0 100 56" aria-hidden>
      <path className="util-gauge__zone" data-zone="comfortable" d={arc(0, COMFORTABLE_UTILIZATION)} />
      <path className="util-gauge__zone" data-zone="busy" d={arc(COMFORTABLE_UTILIZATION, HOT_UTILIZATION)} />
      <path className="util-gauge__zone" data-zone="hot" d={arc(HOT_UTILIZATION, 1)} />
      <path className="util-gauge__zone" data-zone="overloaded" d={arc(1, DIAL_MAX)} />
      {variant === 'full' && <FullLoadTick />}
      <path className="util-gauge__needle" d={`M${CX},${CY} L${nx.toFixed(2)},${ny.toFixed(2)}`} />
      <circle className="util-gauge__hub" cx={CX} cy={CY} r={3.2} />
    </svg>
  );

  if (variant === 'mark') {
    return (
      <span className="util-gauge util-gauge--mark" data-zone={zone} role="img" aria-label={label} title={label}>
        {dial}
        <span className="util-gauge__value num" aria-hidden>
          {Number.isFinite(utilization) ? formatPercent(utilization) : '—'}
        </span>
        {ZONE_SHORT_WORDS[measure][zone] && (
          <span className="util-gauge__word" aria-hidden>
            {ZONE_SHORT_WORDS[measure][zone]}
          </span>
        )}
      </span>
    );
  }
  return (
    <div className="util-gauge util-gauge--full" data-zone={zone} role="img" aria-label={label}>
      {dial}
      <div className="util-gauge__reading" aria-hidden>
        <span className="util-gauge__value num">{readingText(utilization)}</span>
        <span className="util-gauge__zone-word">{words}</span>
      </div>
    </div>
  );
}

/** A pen tick at 100%, labelled, so "full" has a place on the dial. */
function FullLoadTick() {
  const [x1, y1] = point(1, R - 5);
  const [x2, y2] = point(1, R + 5);
  return (
    <>
      <path className="util-gauge__tick" d={`M${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)}`} />
      <text className="util-gauge__tick-label" x={x2 + 1} y={y2 - 1}>
        100
      </text>
    </>
  );
}
