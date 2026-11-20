/**
 * The numbers as a picture, on the briefing card: a sparkline of the level's traffic, the work per request, an icon per
 * event (named, never timed), and a badge per requirement. Every figure is read from `levelNumbers` or the level's
 * traffic curve; the full worded numbers box sits behind "more".
 */
import type { LevelNumbers, RunSurprise } from '@five-nines/sim';
import { formatCount, formatDuration, formatMs, formatPercent, formatUsdPerMonth } from '../../format.ts';
import { paint } from './ink.tsx';
import { COMPONENT_NAMES } from './names.ts';
import { shareText } from './numbers.tsx';

const W = 132;
const H = 36;
const PAD = 3;

/** The traffic curve, scaled into the sparkline's box: time across, rate up, from zero. */
export function sparklinePath(traffic: readonly { atSec: number; rps: number }[]): string {
  const end = Math.max(1, ...traffic.map((point) => point.atSec));
  const top = Math.max(1, ...traffic.map((point) => point.rps));
  return traffic
    .map((point, i) => {
      const x = PAD + (point.atSec / end) * (W - 2 * PAD);
      const y = H - PAD - (point.rps / top) * (H - 2 * PAD);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** What each event is called on the card, short. */
function eventName(surprise: RunSurprise): string {
  switch (surprise.kind) {
    case 'crash':
      return `an ${COMPONENT_NAMES.appServer.concept} crashes`;
    case 'cacheRestart':
      return 'the cache restarts';
    case 'hotKey':
      return `hot key: ${surprise.label}`;
    case 'rateLimit':
      return 'provider rate limit';
  }
}

/** A small ink glyph per event: a pulled plug, a restart arrow, a flame, a raised hand. Decorative. */
function EventGlyph({ kind }: { kind: RunSurprise['kind'] }) {
  const ink = 'currentColor';
  return (
    <svg className="numbers-card__glyph" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      {kind === 'crash' && (
        <>
          <path d="M3,8 h6 v5 h-6 Z" style={paint(null, ink, 1.6)} />
          <path d="M4.5,8 v-3 M7.5,8 v-3" style={paint(null, ink, 1.6)} strokeLinecap="round" />
          <path d="M6,13 v3 q0,2 3,2" style={paint(null, ink, 1.6)} strokeLinecap="round" />
          <path d="M12,6 l5,-3 M12.5,10 h5 M12,14 l5,3" style={paint(null, ink, 1.6)} strokeLinecap="round" />
        </>
      )}
      {kind === 'cacheRestart' && (
        <>
          <path d="M15.5,7 A6.5,6.5 0 1 0 16,12" style={paint(null, ink, 1.8)} strokeLinecap="round" />
          <path d="M16.5,2.5 L15.5,7 L11,6.2" style={paint(null, ink, 1.8)} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === 'hotKey' && (
        <path
          d="M10,2 C12,6 16,8 15,13 C14.5,16.5 12,18 10,18 C7,18 4.5,16 5,12.5 C5.3,10 7,9 7.5,7 C9,9 9.5,10.5 9,12 C11,10 11,6 10,2 Z"
          style={paint(null, ink, 1.6)}
          strokeLinejoin="round"
        />
      )}
      {kind === 'rateLimit' && (
        <>
          <circle cx="10" cy="10" r="7.5" style={paint(null, ink, 1.8)} />
          <path d="M5,15 L15,5" style={paint(null, ink, 1.8)} strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function NumbersCard({ numbers, traffic }: { numbers: LevelNumbers; traffic: readonly { atSec: number; rps: number }[] }) {
  const { startRps, sustainedRps, spikes } = numbers.traffic;
  const per = numbers.unit === 'orders' ? 'orders/s' : 'req/s';
  const rate = startRps === sustainedRps ? formatCount(sustainedRps) : `${formatCount(startRps)} → ${formatCount(sustainedRps)}`;
  const spike = spikes[0];
  const r = numbers.requirements;
  const work = [
    `${formatMs(numbers.cpuMsPerRequest)} CPU each`,
    ...(numbers.data
      ? [numbers.data.readShare === 0 ? 'all writes' : `${shareText(numbers.data.readShare)} reads`]
      : []),
    ...(numbers.payments ? [`provider ≤ ${formatCount(numbers.payments.rateLimitRps)}/s`] : []),
  ];
  const badges = [
    { id: 'p99', label: 'p99', value: `≤ ${formatMs(r.p99Ms)}` },
    { id: 'availability', label: 'up', value: `≥ ${formatPercent(r.availability, 1)}` },
    ...(r.maxStalenessSec !== null ? [{ id: 'stale', label: 'stale', value: `≤ ${r.maxStalenessSec} s` }] : []),
    ...(r.ownWrites ? [{ id: 'own', label: 'own writes', value: 'always' }] : []),
    ...(r.processWithinSec !== null ? [{ id: 'charge', label: 'charged', value: `≤ ${formatDuration(r.processWithinSec)}` }] : []),
    { id: 'budget', label: 'budget', value: `≤ ${formatUsdPerMonth(r.budgetUsdPerMonth)}` },
  ];
  const trafficLabel = `Traffic: ${rate} ${per}${spike ? `, a spike to ${formatCount(spike.rps)} for ${spike.durationSec} s` : ''}`;

  return (
    <section className="numbers-card" aria-label="The numbers at a glance">
      <div className="numbers-card__traffic">
        <svg className="numbers-card__spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={trafficLabel}>
          <path className="numbers-card__spark-base" d={`M${PAD},${H - PAD} H${W - PAD}`} />
          <path className="numbers-card__spark-line" d={sparklinePath(traffic)} />
        </svg>
        <div className="numbers-card__rate" aria-hidden>
          <span className="numbers-card__rate-value num">{rate}</span> <span className="numbers-card__unit">{per}</span>
          {spike && (
            <span className="numbers-card__spike num">
              spike {formatCount(spike.rps)} · {spike.durationSec} s
            </span>
          )}
        </div>
      </div>
      <ul className="numbers-card__work" aria-label="Each request">
        {work.map((item) => (
          <li key={item} className="numbers-card__chip num">
            {item}
          </li>
        ))}
      </ul>
      {numbers.surprises.length > 0 && (
        <ul className="numbers-card__events" aria-label="During the run">
          {numbers.surprises.map((surprise) => (
            <li key={surprise.kind === 'hotKey' ? `hotKey:${surprise.label}` : surprise.kind} className="numbers-card__event">
              <EventGlyph kind={surprise.kind} />
              {eventName(surprise)}
            </li>
          ))}
        </ul>
      )}
      <ul className="numbers-card__badges" aria-label="To pass">
        {badges.map((badge) => (
          <li key={badge.id} className="numbers-card__badge" data-requirement={badge.id}>
            <span className="numbers-card__badge-label">{badge.label}</span>
            <span className="numbers-card__badge-value num">{badge.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
