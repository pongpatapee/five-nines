/**
 * The field guide: a reference section at the back of the notebook. One entry per component the player has met (what
 * it does, how its capacity works with a worked example, its spec table, and its gotchas) and one per concept. The
 * game decides which entries are met and builds the spec tables from the catalog; this file words and draws them.
 * Every figure in the worked examples is computed from the catalog, so the guide can't drift from the game.
 */
import {
  APP_SERVER_SIZES,
  AVAILABILITY_TIERS,
  CACHE,
  CACHE_SIZES,
  cacheCapacityKeys,
  COMFORTABLE_UTILIZATION,
  COMPONENT_LABELS,
  DATABASE_SIZES,
  HEALTH_CHECK,
  HOT_UTILIZATION,
  LOAD_BALANCER,
  QUEUE,
  REPLICATION,
  SHARDING,
  ZipfKeys,
  type ComponentKind,
} from '@five-nines/sim';
import { useEffect, useId, useRef } from 'react';
import { formatCount, formatPercent } from '../../format.ts';
import type { ConceptId, GuideEntryId } from '../../guide/guide.ts';
import type { FieldGuideProps, FieldGuideScript } from '../contract.ts';
import { CastLine } from './Characters.tsx';

const n = formatCount;
const pct = (fraction: number) => formatPercent(fraction);
/** "2.5", "0.77": a figure at worked-example precision. */
const fig = (value: number) => String(Number(value.toFixed(2)));

interface ComponentCopy {
  does: string;
  capacity: string;
  /** Lines of worked arithmetic. */
  example: readonly string[];
  gotchas: readonly string[];
}

interface ConceptCopy {
  name: string;
  what: string;
  example: string;
}

function componentCopy(kind: ComponentKind): ComponentCopy {
  switch (kind) {
    case 'appServer': {
      const cpuMs = 0.5;
      const perVcpu = 1000 / cpuMs;
      const { vcpu } = APP_SERVER_SIZES.medium;
      return {
        does: 'Runs your code. Every request needs some CPU time on one of its vCPUs.',
        capacity:
          'Each vCPU works on one request at a time. A request that needs C ms of CPU lets one vCPU finish 1,000 ÷ C requests a second, and a server does that times its vCPUs. Requests that find every vCPU busy wait in line.',
        example: [
          `At ${cpuMs} ms a request: 1,000 ÷ ${cpuMs} = ${n(perVcpu)} req/s per vCPU.`,
          `A medium server has ${vcpu} vCPUs: ${vcpu} × ${n(perVcpu)} = ${n(vcpu * perVcpu)} req/s, flat out.`,
        ],
        gotchas: [
          `Flat out is not the target: past about ${pct(COMFORTABLE_UTILIZATION)} busy the line grows and p99 climbs. Size for the peak, with headroom.`,
          'A request that waits longer than the timeout fails.',
          'More instances behind a load balancer add capacity; a bigger size does too, until the biggest runs out.',
        ],
      };
    }
    case 'loadBalancer':
      return {
        does: 'Spreads requests evenly over every app-server instance behind it.',
        capacity: `It passes on up to ${n(LOAD_BALANCER.maxRps)} requests a second and adds ${LOAD_BALANCER.latencyMs} ms. Round robin: every instance gets the same share, whatever its size.`,
        example: ['5,000 req/s over 5 instances: 1,000 each.', 'One crashes: until the balancer notices, 1 in 5 requests still goes to it.'],
        gotchas: [
          `It keeps sending a crashed instance its share until health checks notice: ${HEALTH_CHECK.unhealthyThreshold} failed checks in a row, one every interval. With 5-second checks that's up to ${5 * HEALTH_CHECK.unhealthyThreshold} seconds of failures.`,
          'Shorter checks shrink that window but never close it. "Retry on connection failure" sends a refused request to another instance once, a millisecond later: safe, because a refused request never started.',
        ],
      };
    case 'cache': {
      const { memoryGb } = CACHE_SIZES.medium;
      const itemKb = 100;
      const fits = cacheCapacityKeys(memoryGb, itemKb);
      const keys = 2_000_000;
      const caught = new ZipfKeys(keys, 1).topShare(fits);
      return {
        does: 'Keeps popular data in memory. App servers look there first; only the misses go to the database.',
        capacity: `Every size does ${n(CACHE.opsPerSec)} lookups a second: memory decides how many items fit (memory ÷ item size), and it keeps the most popular ones. How popular the keys are decides the hit rate: when a few are very popular, a small slice of them catches most reads; when all are equally likely, it catches almost none. The expiry (TTL) decides how long a cached copy lives: a key read less often than once per TTL has usually expired by its next read.`,
        example: [
          `${memoryGb} GB of ${itemKb} KB articles holds ${n(memoryGb * 1_000_000)} ÷ ${itemKb} = ${n(fits)} of them.`,
          `If a few of ${n(keys)} articles get most reads, those ${n(fits)} get about ${pct(caught)} of them, once the cache is warm. The database sees the rest.`,
        ],
        gotchas: [
          'It starts empty and only fills as data is read.',
          'A restart empties it (unless it is replicated), and every read misses at once: the stampede. Coalescing misses sends one read per key to the database instead of thousands.',
          'A cached copy can be as old as the TTL. Invalidate on write deletes it when the data changes, so a long TTL stays fresh.',
          'Writes always go to the database.',
        ],
      };
    }
    case 'database': {
      const large = DATABASE_SIZES.large;
      const cost = large.readsPerSec / large.writesPerSec;
      const writes = 1_000;
      return {
        does: 'The primary: every write goes here, and any read not sent elsewhere.',
        capacity: `Each size does a fixed number of reads a second, or of writes. Reads and writes share the machine, so a write costs reads/s ÷ writes/s reads: ${n(large.readsPerSec)} ÷ ${n(large.writesPerSec)} = ${fig(cost)} for a large one.`,
        example: [
          `A large database taking ${n(writes)} writes a second: ${n(writes)} × ${fig(cost)} = ${n(writes * cost)} reads' worth of work.`,
          `That leaves ${n(large.readsPerSec)} − ${n(writes * cost)} = ${n(large.readsPerSec - writes * cost)} reads a second for reads.`,
        ],
        gotchas: [
          'Past its capacity, requests queue and time out. No size takes everything.',
          'Read replicas add read capacity; only shards add write capacity.',
        ],
      };
    }
    case 'readReplicas': {
      const large = DATABASE_SIZES.large;
      const cost = large.readsPerSec / large.writesPerSec;
      const [reads, writes, count] = [19_200, 800, 3];
      const each = reads / count;
      const replay = writes * cost * REPLICATION.replayCost;
      const busy = (each + replay) / large.readsPerSec;
      return {
        does: 'Copies of the primary that serve reads, a little behind it.',
        capacity: `The reads split evenly over the replicas, and each also replays every write at ${pct(REPLICATION.replayCost)} of what it cost the primary. Same sizes and prices as the database, up to ${REPLICATION.maxCount} replicas.`,
        example: [
          `${n(reads)} reads over ${count} large replicas: ${n(each)} each.`,
          `${n(writes)} writes replayed at ${fig(cost)} × ${REPLICATION.replayCost} reads: ${n(replay)} more. ${n(each + replay)} ÷ ${n(large.readsPerSec)} = ${pct(busy)} busy.`,
        ],
        gotchas: [
          `Replicas lag: ${REPLICATION.baseLagSec} s idle, ${REPLICATION.baseLagSec} s ÷ (1 − busy) when busy (${pct(busy)} busy is ${fig(REPLICATION.baseLagSec / (1 - busy))} s), and further behind every second they're overloaded. They lag most exactly when traffic peaks.`,
          "A user reading their own fresh write from a replica can miss it. Read-your-writes pinning sends that user's reads to the primary for a while after they write, and the primary must have room for them.",
        ],
      };
    }
    case 'shards': {
      const large = DATABASE_SIZES.large;
      const [writes, count] = [15_000, 5];
      return {
        does: 'Splits the data over several primaries. The shard key decides which shard owns each record, and every read and write of it goes there.',
        capacity: `Shards × one database's capacity, if the key spreads the work evenly: ${SHARDING.minCount} to ${SHARDING.maxCount} shards, each priced as a database.`,
        example: [`${n(writes)} writes over ${count} large shards: ${n(writes / count)} each, ${pct(writes / count / large.writesPerSec)} of ${n(large.writesPerSec)}.`],
        gotchas: [
          'A key that lumps the busy records together loads one shard and idles the rest. A key that only grows (a timestamp) sends every new write to the newest shard.',
          'One very hot value lives on one shard, however many shards there are.',
        ],
      };
    }
    case 'queue': {
      const latencySec = 0.3;
      const perWorker = QUEUE.workerConcurrency / latencySec;
      const [arrive, drain, spikeSec] = [10_000, 2_200, 30];
      return {
        does: 'Holds work so app servers can answer at once. Workers take it off in arrival order and do it later.',
        capacity: `Each worker keeps ${QUEUE.workerConcurrency} calls in flight, so it does ${QUEUE.workerConcurrency} ÷ the call's time a second. The backlog grows by arrivals minus the drain; the size is how many messages it holds before it refuses more.`,
        example: [
          `Calls taking ${latencySec * 1000} ms: ${QUEUE.workerConcurrency} ÷ ${latencySec} s = ${n(perWorker)} a second per worker.`,
          `${n(arrive)} orders a second for ${spikeSec} s, drained at ${n(drain)}: the backlog grows ${n(arrive - drain)} a second, to ${n((arrive - drain) * spikeSec)}.`,
        ],
        gotchas: [
          'A queue buys time, not capacity: the last order in waits backlog ÷ drain rate.',
          "Workers past what's downstream allows are paid for and idle.",
        ],
      };
    }
    case 'paymentProvider':
      return {
        does: "Someone else's service that charges cards.",
        capacity: 'It accepts a fixed number of calls a second, each taking its own time; calls over the limit are refused. The level sets both. It costs nothing in your budget.',
        example: ['A limit of 2,500 a second, sent 10,000 a second: 7,500 refused, every second.'],
        gotchas: ['Calling it while the customer waits adds its whole latency to every request.'],
      };
  }
}

function conceptCopy(id: ConceptId): ConceptCopy {
  switch (id) {
    case 'nines': {
      const requests = 1_000_000;
      return {
        name: 'Availability and the nines',
        what: `Availability is good requests ÷ all requests. A pass needs ${formatPercent(AVAILABILITY_TIERS.pass, 1)} (three nines), a star ${formatPercent(AVAILABILITY_TIERS.star, 2)}, mastered ${formatPercent(AVAILABILITY_TIERS.mastered, 3)}. A request that fails, times out or returns stale data is not good.`,
        example: `A run of ${n(requests)} requests: a pass allows ${n(requests * (1 - AVAILABILITY_TIERS.pass))} failures, mastered only ${n(requests * (1 - AVAILABILITY_TIERS.mastered))}.`,
      };
    }
    case 'p99':
      return {
        name: 'p99 latency',
        what: 'p99 is the time 99 requests in 100 beat: line every request up by how long it took, and read off the one 1% from the slow end. It shows what your unluckiest users wait, which an average hides.',
        example: 'Of 1,000 requests, the 990th fastest is the p99. Ten slow ones barely move it; fifty slow ones set it.',
      };
    case 'utilization': {
      const rps = 350;
      const cpuMs = 10;
      const medium = (APP_SERVER_SIZES.medium.vcpu * 1000) / cpuMs;
      const large = (APP_SERVER_SIZES.large.vcpu * 1000) / cpuMs;
      return {
        name: `The ${pct(COMFORTABLE_UTILIZATION)} rule`,
        what: `Utilization is load ÷ capacity. Under about ${pct(COMFORTABLE_UTILIZATION)} busy, requests rarely wait. Past ${pct(HOT_UTILIZATION)} the line grows fast and p99 shoots up; at 100% it never stops growing. Size for about ${pct(COMFORTABLE_UTILIZATION)} at the peak.`,
        example: `${rps} req/s at ${cpuMs} ms each: a medium server (${n(medium)} req/s) is ${pct(rps / medium)} busy, never overloaded but slow; a large one (${n(large)} req/s) is ${pct(rps / large)} busy.`,
      };
    }
    case 'errorBudget': {
      const [rps, sec, servers] = [5_000, 180, 5];
      const total = rps * sec;
      const budget = total * (1 - AVAILABILITY_TIERS.pass);
      return {
        name: 'The error budget',
        what: 'The failures a grade allows, counted in requests: all requests × (1 − the target). Every failure spends some, and once it is spent, the grade is gone.',
        example: `${n(rps)} req/s for ${sec} s is ${n(total)} requests; a pass allows ${formatPercent(1 - AVAILABILITY_TIERS.pass, 1)}: ${n(budget)}. Lose 1 of ${servers} servers with no retries and ${n(rps / servers)} requests a second fail: the budget is gone in under a second.`,
      };
    }
  }
}

export const FIELD_GUIDE_SCRIPT: FieldGuideScript = {
  title: 'Field guide',
  more: 'More in the field guide',
  entryName: (id: GuideEntryId) =>
    id in COMPONENT_LABELS ? COMPONENT_LABELS[id as ComponentKind] : conceptCopy(id as ConceptId).name,
};

const anchor = (id: GuideEntryId) => `field-guide-${id}`;

/**
 * Scrolls `container` so `target` sits at its top. Unlike `scrollIntoView`, which scrolls every scrollable ancestor,
 * this leaves the page behind the guide where it was.
 */
function scrollWithin(container: HTMLElement, target: HTMLElement): void {
  const padding = Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top - padding;
  container.scrollTo({ top: container.scrollTop + offset });
}

/** The field guide, laid open over the page. */
export function FieldGuide({ components, concepts, unmet, focus, onClose }: FieldGuideProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    const target = focus ? body?.querySelector<HTMLElement>(`#${anchor(focus)}`) : null;
    if (body && target) {
      scrollWithin(body, target);
      target.focus({ preventScroll: true });
    } else {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [focus]);
  const jump = (id: GuideEntryId) => {
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`#${anchor(id)}`);
    if (!body || !target) return;
    scrollWithin(body, target);
    target.focus({ preventScroll: true });
  };

  return (
    <section className="field-guide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="field-guide__head">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="field-guide__title hand">
          {FIELD_GUIDE_SCRIPT.title}
        </h2>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>
      <nav className="field-guide__contents" aria-label="Field guide contents">
        <ul>
          {[...components.map((entry) => entry.kind), ...concepts].map((id) => (
            <li key={id}>
              <button type="button" className="field-guide__jump" onClick={() => jump(id)}>
                {FIELD_GUIDE_SCRIPT.entryName(id)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div ref={bodyRef} className="field-guide__body">
        <h3 className="field-guide__part hand">Components</h3>
        {components.map(({ kind, table }) => {
          const copy = componentCopy(kind);
          return (
            <article key={kind} id={anchor(kind)} tabIndex={-1} className="field-guide__entry" aria-labelledby={`${anchor(kind)}-name`}>
              <h4 id={`${anchor(kind)}-name`} className="field-guide__name">
                {COMPONENT_LABELS[kind]}
              </h4>
              <p className="field-guide__does">{copy.does}</p>
              <p>{copy.capacity}</p>
              <div className="field-guide__example">
                <b className="field-guide__label">Worked example</b>
                {copy.example.map((line) => (
                  <p key={line} className="num">
                    {line}
                  </p>
                ))}
              </div>
              <table className="field-guide__table">
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i} className="num">{cell}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="field-guide__gotchas">
                <b className="field-guide__label">Watch out</b>
                <ul>
                  {copy.gotchas.map((gotcha) => (
                    <li key={gotcha}>{gotcha}</li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
        {concepts.length > 0 && <h3 className="field-guide__part hand">Concepts</h3>}
        {concepts.map((id) => {
          const copy = conceptCopy(id);
          return (
            <article key={id} id={anchor(id)} tabIndex={-1} className="field-guide__entry" aria-labelledby={`${anchor(id)}-name`}>
              <h4 id={`${anchor(id)}-name`} className="field-guide__name">
                {copy.name}
              </h4>
              <p>{copy.what}</p>
              <div className="field-guide__example">
                <b className="field-guide__label">Example</b>
                <p className="num">{copy.example}</p>
              </div>
            </article>
          );
        })}
        {unmet > 0 && (
          <CastLine role="mentor" size={48} className="field-guide__unmet">
            {`${unmet} more ${unmet === 1 ? 'entry' : 'entries'} to come. They fill in as you reach new pages.`}
          </CastLine>
        )}
      </div>
    </section>
  );
}

/** Copy for tests: every component and concept has its words. */
export const FIELD_GUIDE_COPY = { componentCopy, conceptCopy };
