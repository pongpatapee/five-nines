/**
 * "The numbers" on a sticky note: every figure the level gives the player, worded from `levelNumbers` (the game reads
 * them from the level's data; this file only says them). Scheduled events are named, never timed.
 */
import type { LevelNumbers, Popularity, RunSurprise, ShardKeyNumbers } from '@five-nines/sim';
import { useId } from 'react';
import { formatCount, formatDuration, formatMs, formatPercent, formatUsdPerMonth, GRADE_LABELS } from '../../format.ts';
import { tierPercent } from '../../results/grading.ts';
import type { NumbersBoxProps, NumbersText } from '../contract.ts';

/** "100 million", "2 million", "1 billion", "50,000": big round counts the way people say them. */
export function bigCount(n: number): string {
  if (n >= 1e9 && n % 1e8 === 0) return `${n / 1e9} billion`;
  if (n >= 1e6 && n % 1e5 === 0) return `${n / 1e6} million`;
  return formatCount(n);
}

const POPULARITY: Record<Popularity, string> = {
  uniform: 'all equally likely',
  mild: 'some more popular than others',
  skewed: 'a few are very popular',
};

/** "50%", "99.8%", "95%". */
const share = (fraction: number) => `${Number((fraction * 100).toFixed(1))}%`;

function shardKey(key: ShardKeyNumbers): { label: string; value: string } {
  return key.spread === 'sequential'
    ? { label: key.label, value: 'only grows: new data always has the newest value' }
    : { label: key.label, value: `${bigCount(key.count)} values, ${POPULARITY[key.popularity]}` };
}

function surprise(s: RunSurprise): string {
  switch (s.kind) {
    case 'crash':
      return 'an app server will crash';
    case 'cacheRestart':
      return 'the cache will restart';
    case 'hotKey':
      return `a hot key: ${s.label}`;
    case 'rateLimit':
      return 'the payment provider refuses calls over its rate limit';
  }
}

export function numbersText(n: LevelNumbers): NumbersText {
  const per = n.unit === 'orders' ? 'orders a second' : 'requests a second';
  const { startRps, sustainedRps, spikes } = n.traffic;
  const traffic = [
    {
      label: 'Traffic',
      value: startRps === sustainedRps ? `${formatCount(sustainedRps)} ${per}` : `${formatCount(startRps)} → ${formatCount(sustainedRps)} ${per}`,
    },
    ...spikes.map((spike) => ({ label: 'Spike', value: `${formatCount(spike.rps)} for ${spike.durationSec} s` })),
    { label: 'CPU per request', value: formatMs(n.cpuMsPerRequest) },
    { label: 'Request timeout', value: formatMs(n.timeoutMs) },
  ];

  const data: { label: string; value: string }[] = [];
  if (n.data) {
    const { readShare, readAfterWrite, keys, itemKb, shardKeys } = n.data;
    data.push({
      label: 'Reads and writes',
      value: readShare === 0 ? 'every request is a write' : `${share(readShare)} reads, ${share(1 - readShare)} writes`,
    });
    if (readAfterWrite) {
      data.push({
        label: 'Reading own writes',
        value: `${share(readAfterWrite.share)} of reads, about ${readAfterWrite.meanGapSec} s after the write`,
      });
    }
    if (keys) data.push({ label: 'Data', value: `${bigCount(keys.count)} ${keys.label}, ${POPULARITY[keys.popularity]}` });
    if (itemKb !== null) data.push({ label: 'Item size', value: `${formatCount(itemKb)} KB each` });
    for (const key of shardKeys ?? []) {
      const row = shardKey(key);
      data.push({ label: `Shard by ${row.label}`, value: row.value });
    }
  }
  if (n.payments) {
    data.push({
      label: 'Payment provider',
      value: `at most ${formatCount(n.payments.rateLimitRps)} charges a second, ${formatMs(n.payments.latencyMs)} each`,
    });
  }

  const r = n.requirements;
  const requirements = [
    {
      label: 'Availability',
      value: `≥ ${formatPercent(r.availability, 1)} (${GRADE_LABELS.star} ${tierPercent('star')}, ${GRADE_LABELS.mastered} ${tierPercent('mastered')})`,
    },
    { label: 'p99 latency', value: `≤ ${formatMs(r.p99Ms)}` },
    ...(r.maxStalenessSec !== null ? [{ label: 'Staleness', value: `reads ≤ ${r.maxStalenessSec} s out of date` }] : []),
    ...(r.ownWrites ? [{ label: 'Consistency', value: 'users always see their own writes' }] : []),
    ...(r.processWithinSec !== null ? [{ label: 'Charging', value: `every order within ${formatDuration(r.processWithinSec)}` }] : []),
    { label: 'Budget', value: `≤ ${formatUsdPerMonth(r.budgetUsdPerMonth)}` },
    { label: 'Run length', value: formatDuration(n.durationSec) },
  ];

  return {
    title: 'The numbers',
    groups: [
      { heading: 'Traffic', rows: traffic },
      ...(data.length > 0 ? [{ heading: 'Data', rows: data }] : []),
      { heading: 'To pass', rows: requirements },
    ],
    during: n.surprises.length > 0 ? { lead: 'During the run:', items: n.surprises.map(surprise) } : null,
  };
}

/** The numbers, on a sticky note stuck to the page. */
export function NumbersBox({ numbers, variant }: NumbersBoxProps) {
  const headingId = useId();
  const text = numbersText(numbers);
  return (
    <section className="numbers-box" data-variant={variant} aria-labelledby={headingId}>
      <h2 id={headingId} className="numbers-box__title hand">
        {text.title}
      </h2>
      {text.groups.map((group) => (
        <div key={group.heading} className="numbers-box__group">
          <h3 className="numbers-box__heading">{group.heading}</h3>
          <dl className="numbers-box__rows">
            {group.rows.map((row, i) => (
              <div key={`${row.label}:${i}`} className="numbers-box__row">
                <dt>{row.label}</dt>
                <dd className="num">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {text.during && (
        <div className="numbers-box__during">
          <p className="numbers-box__during-lead">
            <span aria-hidden>⚠ </span>
            {text.during.lead}
          </p>
          <ul>
            {text.during.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
