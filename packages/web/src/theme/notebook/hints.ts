/**
 * What Erasmus says when the math matters: the hint ladders (before any failed run, and after one), the p99 explanation, the failover
 * arithmetic after a crash and the napkin-math step. The game decides the situation and its numbers
 * (`theme/situations.ts`, `@five-nines/sim`'s estimate working); this file only words them.
 *
 * The concept and fix rungs are written per level and per kind of failure, with a general line for each kind as
 * the fallback. CI checks every level has its own line for every failure its known wrong answers produce.
 */
import {
  APP_SERVER_SIZES,
  AVAILABILITY_TIERS,
  COMFORTABLE_UTILIZATION,
  HOT_UTILIZATION,
  utilizationZone,
  type EstimateWorking,
  type Level,
  type NapkinSolution,
  type NapkinStep,
} from '@five-nines/sim';
import { capitalize, formatCount, formatEstimate, formatMs, formatPercent, formatSeconds, formatSimTime, formatUsd } from '../../format.ts';
import type { EstimateResult, MentorEstimateScript, MentorLadderScript } from '../contract.ts';
import { COMPONENT_NAMES } from './names.ts';
import { bigCount } from './numbers.tsx';
import type { FailoverSituation, FailureStory, HintTopic, LatencySituation, LevelTrap } from '../situations.ts';

// ---------------------------------------------------------------------------- numbers, said aloud

/** "87% busy", "130% busy, over capacity", "with nothing left to serve it". */
export function busy(utilization: number): string {
  if (!Number.isFinite(utilization)) return 'with nothing left to serve it';
  const pct = formatPercent(utilization);
  return utilization > 1 ? `${pct} busy, over capacity` : `${pct} busy`;
}

/** "1 second", "0.43 seconds", "1.9 seconds", "9 seconds", "59 seconds". */
function seconds(sec: number): string {
  const text = Number.isInteger(Math.round(sec * 10) / 10) ? String(Math.round(sec)) : formatSeconds(sec).replace(/ s$/, '');
  return `${text} ${text === '1' ? 'second' : 'seconds'}`;
}

/** "app instance 2", or just "app" for a single-instance server. */
function instanceName(nodeId: string, instance: number, rotationSize: number): string {
  return rotationSize > 1 ? `${nodeId} instance ${instance + 1}` : nodeId;
}

// ---------------------------------------------------------------------------- latency

export function mentorLatency(s: LatencySituation): string {
  const at = formatSimTime(s.atSec);
  const over = s.p99Ms > s.requiredMs;
  if (!over) {
    return s.busiest
      ? `p99 is climbing: ${formatMs(s.p99Ms)} at ${at}, close to the ${formatMs(s.requiredMs)} limit, with ${s.busiest.nodeId} ${busy(s.busiest.utilization)}.`
      : `p99 is climbing: ${formatMs(s.p99Ms)} at ${at}, close to the ${formatMs(s.requiredMs)} limit.`;
  }
  if (!s.busiest) return `p99 hit ${formatMs(s.p99Ms)} at ${at}, over the ${formatMs(s.requiredMs)} limit.`;
  const queue =
    s.busiest.utilization >= 0.7
      ? ' Past about 70% busy, requests start waiting for a free worker, and the wait grows fast.'
      : '';
  return `p99 hit ${formatMs(s.p99Ms)} at ${at} (limit ${formatMs(s.requiredMs)}) while ${s.busiest.nodeId} was ${busy(s.busiest.utilization)}.${queue}`;
}

// ---------------------------------------------------------------------------- failover

export function failoverLines(s: FailoverSituation): string[] {
  const dead = instanceName(s.nodeId, s.instance, s.rotationSize);
  const lines = [`${dead} crashed at ${formatSimTime(s.crashedAtSec)}.`];

  if (s.balancerId === null || s.healthCheckIntervalSec === null) {
    lines.push('No load balancer in front, so nothing could route around it.');
  } else {
    const checks = `${s.balancerId} checks every ${s.healthCheckIntervalSec} s and needs ${s.checksToRemove} failed checks in a row`;
    if (s.removedAtSec === null) {
      lines.push(`${checks}; it never took ${dead} out of rotation.`);
    } else {
      const window = seconds(s.removedAtSec - s.crashedAtSec);
      const when = s.removedAtSec > s.asOfSec ? 'will take it out of rotation' : 'took it out of rotation';
      lines.push(`${checks}: it ${when} at ${formatSimTime(s.removedAtSec)}, ${window} after the crash.`);
    }
  }

  const lost = `${formatCount(s.lostRequests)} requests (${share(s.lostShare)} of ${s.wholeRun ? 'the run' : 'all so far'})`;
  if (s.retries) {
    lines.push(
      s.lostRequests >= 1
        ? `Retries sent its share to the other instances. Still lost: ${lost}.`
        : 'Retries sent its share to the other instances: nobody noticed.',
    );
  } else if (s.balancerId !== null && s.rotationSize > 1) {
    lines.push(`Meanwhile 1 in ${s.rotationSize} requests went to a dead server and failed: ${lost}.`);
  } else {
    lines.push(`Every request failed while it was down: ${lost}.`);
  }
  return lines;
}

/** "1.0%", "0.34%": enough digits to compare with the 0.1% a pass allows. */
function share(fraction: number): string {
  return formatPercent(fraction, fraction < 0.01 ? 2 : 1);
}

/** What a pass allows to fail: "0.1%". */
const PASS_BUDGET = formatPercent(1 - AVAILABILITY_TIERS.pass, 1);

// ---------------------------------------------------------------------------- the hint ladder

function where(story: FailureStory): string {
  switch (story.topic) {
    case 'overload':
      if (story.hotShard) {
        return `Look at ${story.nodeId}, shard ${story.hotShard.index + 1} of ${story.hotShard.count}: from ${formatSimTime(story.firstAtSec)} its requests started failing.`;
      }
      return `Look at ${story.nodeId}, the ${COMPONENT_NAMES[story.kind].phrase}: from ${formatSimTime(story.firstAtSec)} its requests started failing.`;
    case 'rateLimit':
      return `Look at ${story.nodeId}: from ${formatSimTime(story.firstAtSec)} it refused payments.`;
    case 'queueFull':
      return `Look at ${story.nodeId}: from ${formatSimTime(story.firstAtSec)} it was full and turned orders away.`;
    case 'deadline':
      return `Look at ${story.nodeId}: from ${formatSimTime(story.firstAtSec)} orders in it ran out of time before being charged.`;
    case 'crash':
      return story.noneLeft
        ? `Look at ${story.nodeId}: from ${formatSimTime(story.firstAtSec)} it had no healthy instance left to send requests to.`
        : `Look at ${story.nodeId}: from ${formatSimTime(story.firstAtSec)} requests went to a crashed instance.`;
    case 'stale':
      return `Look at ${story.nodeId}: from ${formatSimTime(story.firstAtSec)} it handed out data that was out of date.`;
    case 'latency':
      return story.worst?.busiest
        ? `Look at the p99 line, then at ${story.worst.busiest.nodeId}: p99 over the run was ${formatMs(story.p99Ms)}, and the limit is ${formatMs(story.requiredMs)}. Nothing failed outright; it was just slow.`
        : `Look at the p99 line: ${formatMs(story.p99Ms)} over the run, against a limit of ${formatMs(story.requiredMs)}.`;
    case 'budget':
      return story.priciest
        ? `Look at the bill: ${formatUsd(story.costUsdPerMonth)} a month against ${formatUsd(story.budgetUsdPerMonth)}. The biggest line is ${story.priciest.nodeId}, at ${formatUsd(story.priciest.usdPerMonth)}.`
        : `Look at the bill: ${formatUsd(story.costUsdPerMonth)} a month against ${formatUsd(story.budgetUsdPerMonth)}.`;
  }
}

function why(story: FailureStory): string {
  switch (story.topic) {
    case 'overload':
      if (story.kind === 'loadBalancer') {
        return `More requests reached ${story.nodeId} than a load balancer can pass on.`;
      }
      if (story.hotShard) {
        const even = formatPercent(1 / story.hotShard.count);
        return `Shard ${story.hotShard.index + 1} was carrying ${formatPercent(story.hotShard.share)} of the data's traffic, where an even split is ${even}. The other shards had room to spare; that one queued requests past the ${formatMs(story.timeoutMs)} timeout.`;
      }
      if (story.cacheRestartAtSec !== null && story.kind !== 'cache') {
        const peak = story.peakUtilization === null ? '' : ` It got as far as ${busy(story.peakUtilization)}.`;
        return `The cache restarted empty at ${formatSimTime(story.cacheRestartAtSec)}, so every read missed and went to ${story.nodeId} at once.${peak} Refills queued behind the misses, and requests waited past the ${formatMs(story.timeoutMs)} timeout.`;
      }
      return story.peakUtilization === null
        ? `${story.nodeId} couldn't keep up: requests waited in its queue past the ${formatMs(story.timeoutMs)} timeout.`
        : `${story.nodeId} got as far as ${busy(story.peakUtilization)}. Work arrived faster than it finished, the queue grew, and requests waited past the ${formatMs(story.timeoutMs)} timeout.`;
    case 'rateLimit':
      return `${story.nodeId} takes at most ${formatCount(story.rateLimitRps)} calls a second, and it was sent up to ${formatCount(story.peakCallsRps)}. Every call over the limit was refused, and its order failed with it.`;
    case 'queueFull':
      return `${story.nodeId} holds ${formatCount(story.maxDepth)} orders. Orders arrived faster than ${story.workers} workers charged them (${formatCount(story.workerRps)} a second at most), so the backlog grew until there was no room left.`;
    case 'deadline': {
      const deadline = story.deadlineSec === null ? '' : ` Each order must be charged within ${seconds(story.deadlineSec)}.`;
      return `${story.workers} workers charge at most ${formatCount(story.workerRps)} orders a second, so the backlog drained too slowly.${deadline} The orders at the back of the line waited longer than that.`;
    }
    case 'crash': {
      const f = story.failover;
      if (!f) return `${story.nodeId} lost its last instance, and nothing was left to serve the traffic.`;
      const noticed =
        f.removedAtSec === null
          ? `${f.balancerId ?? 'Nothing'} never took it out of rotation`
          : `${f.balancerId} took ${seconds(f.removedAtSec - f.crashedAtSec)} to take it out of rotation (${f.checksToRemove} failed checks, ${f.healthCheckIntervalSec} s apart)`;
      const traffic = f.rotationSize > 1 ? `1 in ${f.rotationSize} requests` : 'every request';
      return `${noticed}. Until then ${traffic} hit a dead server: ${formatCount(f.lostRequests)} requests, ${share(f.lostShare)} of the run. A pass allows ${PASS_BUDGET}.`;
    }
    case 'stale': {
      const lag = story.peakLagSec === null ? '' : ` It fell as far as ${seconds(story.peakLagSec)} behind the primary.`;
      if (story.readAfterWrite) {
        const window =
          story.pinnedSec > 0
            ? ` The ${seconds(story.pinnedSec)} read-your-writes window didn't cover that.`
            : ' Nothing sent those reads to the primary.';
        return `Users read their own fresh writes from ${story.nodeId} before it had them.${lag}${window}`;
      }
      const limit = story.limitSec === null ? '' : ` The limit is ${seconds(story.limitSec)}.`;
      return `${story.nodeId} served reads that had missed a change.${lag}${limit}`;
    }
    case 'latency':
      return story.worst
        ? mentorLatency(story.worst)
        : `p99 was ${formatMs(story.p99Ms)}, over the ${formatMs(story.requiredMs)} limit.`;
    case 'budget':
      return `That's ${formatUsd(story.costUsdPerMonth - story.budgetUsdPerMonth)} a month over. Some of that capacity never gets used.`;
  }
}

/** The general concept and fix for each kind of failure, when a level has nothing more specific. */
const GENERAL: Record<HintTopic, { concept: string; fix: string }> = {
  overload: {
    concept:
      "Utilization is load ÷ capacity. Below 100% a box keeps up; at 100% and over, its queue grows every second until requests time out.",
    fix: 'Give the busiest box more capacity than its peak load, with headroom: a bigger one, more of them, or less traffic sent its way.',
  },
  crash: {
    concept:
      "Machines die. A load balancer only stops sending traffic to a dead one after enough failed health checks, and until then every request it sends there fails, unless something retries it.",
    fix: 'Run one more instance than the peak needs, and let the load balancer retry refused connections.',
  },
  stale: {
    concept:
      'Replicas copy the primary a little late, and later still when busy. A read that must be fresh has to go somewhere that already has the write.',
    fix: 'Send the reads that must be fresh to the primary, and keep the replicas from running hot.',
  },
  rateLimit: {
    concept:
      "Someone else's service sets its own limit. Call it in step with your traffic and a spike sends it more than it allows; the calls over the limit are refused.",
    fix: 'Put the calls on a queue and let workers make them at a rate the provider accepts, answering the customer as soon as the order is queued.',
  },
  queueFull: {
    concept: 'A queue buys time, not capacity: during a spike its backlog grows by arrivals minus what the workers drain. It must hold the biggest backlog.',
    fix: 'Give the queue room for the whole backlog of the spike, or drain it faster so the backlog stays smaller.',
  },
  deadline: {
    concept:
      'An order waits for every order ahead of it. The backlog ÷ the drain rate is how long the last one waits, so the workers must clear the backlog within the deadline.',
    fix: 'Add workers until the drain rate clears the backlog within the deadline, without asking more of the provider than its limit.',
  },
  latency: {
    concept:
      'Waiting time grows roughly with 1 ÷ (1 − busy): double from 50% to 75% busy, ten times by 95%. Keep the busiest box around 70% at the peak.',
    fix: 'Bring the busiest box down to about 70% at the peak. The inspector gauge shows the arithmetic.',
  },
  budget: {
    concept: 'Every box bills you every month, busy or not. Size for the peak plus sensible headroom, no more.',
    fix: 'Find the box with the most spare capacity and size it down, or get the same capacity a cheaper way.',
  },
};

type LevelHints = Partial<Record<HintTopic, { concept: string; fix: string }>>;

/** Per level: the concept as this page teaches it, and the change that fixes it here. */
export const LEVEL_HINTS: Readonly<Record<string, LevelHints>> = {
  '01-hello-traffic': {
    overload: {
      concept:
        "A server's capacity is vCPUs ÷ CPU time per request: a small one does 2 ÷ 10 ms = 200 req/s. Send it 350 and the extra piles up in the queue.",
      fix: 'Pick a size whose capacity is comfortably above 350 req/s. Select the server and watch the gauge: aim for under 70%.',
    },
    latency: {
      concept:
        "A medium server does 400 req/s, so at 350 it's about 88% busy. Never overloaded, but most requests arrive to find every vCPU taken and wait.",
      fix: 'One size up. Doubling the vCPUs halves the utilization, and the waiting drops by far more than half.',
    },
    budget: {
      concept: 'Twice the capacity you need is twice the bill, for requests that never come.',
      fix: 'One size down: the smallest server that stays under about 70% busy at 350 req/s.',
    },
  },
  '02-scale-out': {
    overload: {
      concept:
        "5,000 req/s × 10 ms = 50 vCPUs of work, and the biggest server has 16. No single machine can do it, so scale out. Round robin gives every instance the same share, whatever its size.",
      fix: 'A load balancer in front of identical servers with about 64 vCPUs between them, so each runs under 80% at the peak.',
    },
    latency: {
      concept: 'Close to full load, queues grow fast. A pool with many vCPUs copes better, but it still needs headroom.',
      fix: 'Add capacity until each instance sits under about 80% busy at 5,000 req/s.',
    },
    budget: {
      concept: "Headroom is good; paying for a whole server you never use isn't.",
      fix: 'Drop instances until the gauge reads about 75 to 80% at the peak.',
    },
  },
  '03-pull-the-plug': {
    crash: {
      concept:
        "Health checks alone don't get the nines. With 5-second checks the balancer needs up to 10 seconds to notice, and meanwhile 1 in 5 requests hits the dead server: about 1% of the run. Shorter checks shrink the window; they can't close it.",
      fix: "Keep a spare server (N+1) and turn on 'Retry on connection failure' at the load balancer. A dead server refuses the connection at once, so the retry lands elsewhere a millisecond later.",
    },
    overload: {
      concept: 'After the crash the survivors carry everything. With exactly enough servers, losing one leaves too little.',
      fix: "Run one more server than the peak needs. The inspector's 'after the crash' reading shows what the survivors face.",
    },
    latency: {
      concept: 'After the crash, the survivors run hotter, and p99 follows them up.',
      fix: 'Size the pool so the survivors stay under about 80% busy after losing one.',
    },
    budget: {
      concept: "A spare costs money too, so the size of each piece matters: smaller pieces make a cheaper spare.",
      fix: 'Compare five xlarge servers with ten large ones: the same spare capacity, a different bill.',
    },
  },
  '04-read-all-about-it': {
    overload: {
      concept:
        "The database is the bottleneck: 24,700 reads a second at the peak against a large database's 10,000. Reads are skewed, so a cache holding a small slice of the articles catches most of them.",
      fix: 'Put a cache between the app servers and the database: enough memory for the popular articles (8 GB holds 80,000), and a TTL long enough that they are still cached when read again.',
    },
    latency: {
      concept: 'At the spike the database runs close to full, and the misses queue.',
      fix: 'Raise the hit rate (more memory or a longer TTL), so fewer reads reach the database.',
    },
    budget: {
      concept: 'A bigger database costs far more than the cache memory that would spare it.',
      fix: 'Keep the large database and spend on cache memory instead.',
    },
  },
  '05-cache-miss': {
    overload: {
      concept:
        'Nothing is popular here: 100 million profiles, read uniformly, so a cache barely ever hits. Extra read capacity has to come from copies of the database.',
      fix: 'Add read replicas and send the app servers\' reads there: 19,200 reads a second need about three large ones, since each also replays every write.',
    },
    stale: {
      concept:
        "A replica lags 0.2 s ÷ (1 − busy) while it keeps up, and falls further behind every second it's overloaded. Past the 1-second limit, its reads count as failures.",
      fix: 'Add replicas until each is about 75% busy at the peak. That keeps the lag under a second.',
    },
    latency: {
      concept: 'Replicas near full load answer slowly.',
      fix: 'One more replica takes a share of the reads off every other one.',
    },
    budget: {
      concept: 'Once reads go to replicas, the primary only takes the writes.',
      fix: 'A medium primary is plenty for 800 writes a second; spend the rest on replicas.',
    },
  },
  '06-bank-balance': {
    stale: {
      concept:
        'A balance check comes about 1.5 s after the transfer, and replicas are half a second behind or more. Read-your-writes pinning sends a user\'s reads to the primary for a while after their own write. The window has to beat the worst lag, payday included.',
      fix: "Turn on read-your-writes pinning on the replicas with a window longer than the worst lag: 5 seconds.",
    },
    overload: {
      concept:
        'Pinned balance checks and every write land on the primary: about 3,700 reads and 1,000 writes a second on payday.',
      fix: 'Size the primary for the pinned reads plus the writes (a large one), and leave the other reads on two large replicas.',
    },
    latency: {
      concept: 'On payday the primary or the replicas run hot, and the queues show in p99.',
      fix: 'Check the gauges at payday load: keep the primary and the replicas under about 85%.',
    },
    budget: {
      concept: 'Replicas plus pinning beat buying the biggest primary.',
      fix: 'A large primary with two large replicas, rather than more or bigger machines.',
    },
  },
  '07-the-write-wall': {
    overload: {
      concept:
        "Every write goes to the primary, and 15,000 a second is more than any one database takes. Sharding splits the data, so each shard takes only its share of the writes. But the shard key decides the shares: a key whose busy values sit together (the newest posts, one viral post) piles the writes onto one shard.",
      fix: 'Shard by a key with many values and no giant among them: user ID spreads the writes evenly, viral post or not. Then size the shards so each is under about 80% busy: 15,000 writes ÷ 4,000 per large shard is 3.75, so five large ones.',
    },
    latency: {
      concept: 'Writes queue on a shard that runs close to full, and p99 shows it.',
      fix: 'One more shard, or a size up, to bring the busiest shard under about 80% at the peak.',
    },
    budget: {
      concept: 'Each shard is billed as a whole database. More small shards and fewer big ones can do the same work for different money.',
      fix: 'Compare five large shards with ten medium ones: the same capacity, a similar bill. Drop any shard the gauge says you do not need.',
    },
  },
  '08-thundering-herd': {
    overload: {
      concept:
        "A warm cache hides how many reads there are. When it restarts, about 30,000 reads a second all miss at once; refills queue behind the misses, so even the popular items keep missing. The database has to survive that minute, or the cache must not empty.",
      fix: 'Pick one: coalesce misses so each key goes to the database once, with a database big enough to refill the cache; or replicate the cache so a restart keeps its contents; or a database that can take every read on its own.',
    },
    latency: {
      concept: 'While the cache refills, the database runs hot and its queue shows in p99.',
      fix: 'More headroom on the database during the refill, or a cache that does not empty (replicated).',
    },
    budget: {
      concept: 'Protecting against the restart is cheaper than buying a database for the worst minute.',
      fix: 'Coalescing is free; a cache replica costs twice the memory price. Either beats the biggest database.',
    },
  },
  '09-stale-prices': {
    stale: {
      concept:
        "A cached price can be as old as the TTL. Prices change 48 times a second, so with a 60-second TTL lots of reads see a price that changed more than 5 seconds ago. Invalidating on write deletes the cached value as soon as its price changes.",
      fix: "Turn on 'Invalidate on write' at the cache. Then a long TTL is safe again: values leave the cache when they change, not when they expire.",
    },
    overload: {
      concept:
        'A short TTL keeps prices fresh by throwing values away, so the hit rate falls and the misses swamp the database. A medium database needs the cache to catch about 80% of reads.',
      fix: 'Keep a long TTL for a high hit rate, and keep prices fresh with invalidation instead of expiry.',
    },
    latency: {
      concept: 'The database runs hot on the misses, and p99 shows it.',
      fix: 'Raise the hit rate (a longer TTL with invalidation) so fewer reads reach the database.',
    },
    budget: {
      concept: 'A bigger database pays for the misses a better cache setting would avoid.',
      fix: 'Keep the medium database and fix the hit rate: a long TTL with invalidation on write.',
    },
  },
  '10-flash-sale': {
    rateLimit: {
      concept:
        'The provider takes 2,500 charges a second, and the sale sends 10,000 orders a second. Charging while the customer waits passes the spike straight to the provider. A queue lets you accept the order now and charge it later, at the provider\'s pace.',
      fix: 'App servers put each order on a queue and answer at once; workers take orders off the queue and call the provider. Size the workers to drain the sale within the 2-minute deadline.',
    },
    queueFull: {
      concept:
        "During the sale the backlog grows by 10,000 − the drain rate every second. At 2,200 a second that's 7,800 more each second, about 234,000 after 30 seconds: more than a medium queue holds.",
      fix: 'A queue big enough for the whole backlog: the large one holds a million.',
    },
    deadline: {
      concept:
        "The sale brings 300,000 orders in 30 seconds. The last one must be charged within 2 minutes of arriving, so all of them within 150 seconds: 300,000 ÷ 150 = 2,000 a second, and normal traffic keeps coming on top. Each worker charges 30 ÷ 0.3 s = 100 a second.",
      fix: 'About 22 workers: enough to drain 2,200 a second, under the provider\'s 2,500 limit.',
    },
    overload: {
      concept: 'App servers only put orders on the queue, which takes almost no time, so the spike should not tax them.',
      fix: 'Check that the app servers send orders to the queue rather than calling the provider themselves.',
    },
    latency: {
      concept: "A customer who waits for the charge waits the provider's 300 ms. A queued order answers in a couple of milliseconds.",
      fix: 'Answer when the order is queued, and charge it later.',
    },
    budget: {
      concept: "Workers past the provider's limit are paid for and never used: the provider decides how fast you can charge.",
      fix: 'Size the workers between the 2,000 a second the deadline needs and the 2,500 the provider allows: 20 to 25 of them.',
    },
  },
};

// ---------------------------------------------------------------------------- hints before any failed run

/** The traffic the level peaks at: a spike's top if it has one, otherwise the sustained rate. */
const peakOf = (trap: LevelTrap) => Math.max(trap.numbers.traffic.sustainedRps, ...trap.numbers.traffic.spikes.map((s) => s.rps));
const readsAtPeak = (trap: LevelTrap) => Math.round(peakOf(trap) * (trap.numbers.data?.readShare ?? 0));
const writesAtPeak = (trap: LevelTrap) => peakOf(trap) - readsAtPeak(trap);

/**
 * Where to look and why it's hard, per level, before the player has run anything: about the level's main trap
 * (`LEVEL_TRAPS`), quoting the level's own numbers. The concept and fix rungs are the level's lines for that trap.
 */
const BEFORE_RUN: Readonly<Record<string, { where(trap: LevelTrap): string; why(trap: LevelTrap): string }>> = {
  '01-hello-traffic': {
    where: (t) => `The one app server, at the peak: ${formatCount(peakOf(t))} requests a second, each needing ${formatMs(t.numbers.cpuMsPerRequest)} of CPU.`,
    why: (t) =>
      `One vCPU finishes 1,000 ÷ ${formatCount(t.numbers.cpuMsPerRequest)} = ${formatCount(1000 / t.numbers.cpuMsPerRequest)} requests a second. Too few vCPUs and requests queue until they time out; too many and you pay for idle ones.`,
  },
  '02-scale-out': {
    where: (t) => `The app tier at the peak: ${formatCount(peakOf(t))} requests a second.`,
    why: (t) => {
      const vcpus = (peakOf(t) * t.numbers.cpuMsPerRequest) / 1000;
      return `That's ${formatCount(peakOf(t))} × ${formatMs(t.numbers.cpuMsPerRequest)} = ${formatCount(vcpus)} vCPUs of work, and the biggest server has ${APP_SERVER_SIZES.xlarge.vcpu}. No one machine can do it.`;
    },
  },
  '03-pull-the-plug': {
    where: () => 'The app servers, the moment one of them crashes.',
    why: () =>
      'Two things go wrong at once: the balancer keeps sending the dead server its share until health checks notice, and the survivors must carry the whole load without it.',
  },
  '04-read-all-about-it': {
    where: (t) => `The database at the spike: ${formatCount(peakOf(t))} requests a second, ${formatPercent(t.numbers.data?.readShare ?? 0)} of them reads.`,
    why: (t) =>
      `${formatCount(readsAtPeak(t))} reads a second, plus the writes, is more than any database size takes. Every read lands on it unless something catches it first.`,
  },
  '05-cache-miss': {
    where: (t) => `The database at the peak: ${formatCount(readsAtPeak(t))} reads a second.`,
    why: (t) =>
      `The obvious fix may not work here. ${capitalize(bigCount(t.numbers.data?.keys?.count ?? 0))} ${t.numbers.data?.keys?.label ?? 'items'}, all equally likely: no small set of them gets most reads, so a copy kept in memory is rarely asked for again.`,
  },
  '06-bank-balance': {
    where: (t) =>
      `The balance checks right after a transfer: ${formatPercent(t.numbers.data?.readAfterWrite?.share ?? 0)} of reads come about ${t.numbers.data?.readAfterWrite?.meanGapSec ?? 0} s after the user's own write.`,
    why: () =>
      "Replicas are a little behind the primary, and further behind when busy. A user checking a transfer they just made can read the balance from before it, and that counts as a failure here.",
  },
  '07-the-write-wall': {
    where: (t) => `The writes: ${formatCount(writesAtPeak(t))} a second, and every one goes to a primary.`,
    why: () =>
      'Replicas and caches only help reads. This is more writes than any one database takes, and where they land depends on how the data is split.',
  },
  '08-thundering-herd': {
    where: () => 'The database, the moment the cache restarts.',
    why: () =>
      'A warm cache hides how many reads there are. When it empties, every read misses at once and goes straight to the database.',
  },
  '09-stale-prices': {
    where: (t) => `The prices in the cache: a read must see a price at most ${t.numbers.requirements.maxStalenessSec ?? 0} s out of date.`,
    why: () =>
      'A cached copy can be as old as its expiry. A short expiry keeps prices fresh, but throws away copies the database needs the cache to keep.',
  },
  '10-flash-sale': {
    where: (t) => `The payment provider during the sale: it takes at most ${formatCount(t.numbers.payments?.rateLimitRps ?? 0)} charges a second.`,
    why: (t) =>
      `Charging while the customer waits sends the whole spike, ${formatCount(peakOf(t))} orders a second, straight to the provider, and it refuses the rest.`,
  },
};

/** The level's own lines, exported so tests can check every level has them. */
export const BEFORE_RUN_HINTS = BEFORE_RUN;

export const MENTOR_LADDER: MentorLadderScript = {
  where,
  why,
  beforeRun: {
    where: (trap) => BEFORE_RUN[trap.levelId]?.where(trap) ?? 'Start with the busiest part of the design at the peak.',
    why: (trap) => BEFORE_RUN[trap.levelId]?.why(trap) ?? GENERAL[trap.topic].concept,
  },
  concept: (levelId, topic) => LEVEL_HINTS[levelId]?.[topic]?.concept ?? GENERAL[topic].concept,
  fix: (levelId, topic) => LEVEL_HINTS[levelId]?.[topic]?.fix ?? GENERAL[topic].fix,
  stepLabels: {
    level: { where: 'Where to look', why: 'Why it\'s hard', concept: 'The idea', fix: 'The fix' },
    run: { where: 'Where it broke', why: 'Why', concept: 'The idea', fix: 'The fix' },
  },
  more: 'Another hint',
};

/** The general lines, exported so tests can tell a level's own line from the fallback. */
export const GENERAL_HINTS = GENERAL;

// ---------------------------------------------------------------------------- napkin math

/** "1 hour", "2 minutes", "30 seconds", "90 seconds": a duration as said aloud, in whole hours or minutes when it is one. */
function duration(sec: number): string {
  if (sec >= 3600 && sec % 3600 === 0) return sec === 3600 ? '1 hour' : `${sec / 3600} hours`;
  if (sec >= 60 && sec % 60 === 0) return sec === 60 ? '1 minute' : `${sec / 60} minutes`;
  return seconds(sec);
}

/** "1:30": a moment in the run, as a clock reads it. */
export function clock(sec: number): string {
  const whole = Math.floor(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** "profile" from "profiles": what one key is. */
function singular(label: string): string {
  return label.endsWith('s') ? label.slice(0, -1) : label;
}

/** Per level: what a read of the reader's own fresh write is, in the story's words. */
const OWN_WRITE_READS: Readonly<Record<string, string>> = {
  '06-bank-balance': 'users checking a transfer they just made',
};

function ask(w: EstimateWorking, level: Level): { question: string; unit: string } {
  switch (w.quantity) {
    case 'busyVcpusAtPeak':
      return {
        question: `Before you draw anything: at the peak, ${formatCount(w.peakRps)} requests a second each need ${formatMs(w.cpuMsPerRequest)} of CPU. How many vCPUs does that keep busy?`,
        unit: 'vCPUs',
      };
    case 'serversWithSpare':
      return {
        question: `Napkin first. With ${w.size} servers (${w.vcpu} vCPUs, ${formatMs(w.cpuMsPerRequest)} of CPU per request), how many do you need so that losing any one still serves ${formatCount(w.peakRps)} req/s?`,
        unit: 'servers',
      };
    case 'cacheHitRateNeeded':
      return {
        question: `After the writes, ${a(w.databaseSize)} database has room for ${formatCount(w.readsLeft)} reads a second. At the peak, ${formatCount(w.readsPerSec)} reads arrive. What share must the cache catch?`,
        unit: '%',
      };
    case 'secondsBetweenKeyReads': {
      const spread = w.keysPopularity === 'uniform' ? ', all equally likely,' : '';
      return {
        question: `${capitalize(bigCount(w.keys))} ${w.keyLabel}${spread} and ${formatCount(w.readsPerSec)} reads a second at the peak. On average, how long between two reads of the same ${singular(w.keyLabel)}?`,
        unit: 'seconds',
      };
    }
    case 'pinnedPrimaryLoad': {
      const who = OWN_WRITE_READS[level.id] ?? 'users reading something they just wrote';
      return {
        question: `${formatCount(w.freshReadsPerSec)} reads a second are ${who}, so they must read from the primary. The primary also takes ${formatCount(w.writesPerSec)} writes a second, and each costs as much as ${est(w.writeCost)} reads. ${capitalize(a(w.databaseSize))} primary does ${formatCount(w.databaseReadsPerSec)} reads a second. How busy is it?`,
        unit: '%',
      };
    }
    case 'shardsAtFullLoad':
      return {
        question: `Napkin first. A ${w.size} database takes ${formatCount(w.shardWritesPerSec)} writes a second. How many ${w.size} shards' worth of work do ${formatCount(w.writesPerSec)} writes a second make, if they spread evenly?`,
        unit: 'shards',
      };
    case 'coldCacheOverload':
      return {
        question: `When the cache restarts empty during the run, ${formatCount(w.readsPerSec)} reads a second fall straight on ${a(w.databaseSize)} database that handles ${formatCount(w.databaseReadsPerSec)} reads a second. How many times its capacity is that?`,
        unit: 'times',
      };
    case 'queueDrainRateNeeded':
      return {
        question: `Napkin first. The sale sends ${formatCount(w.peakRps)} orders a second for ${seconds(w.spikeSec)}, and each must be charged within ${duration(w.deadlineSec)}. Say the workers start charging as orders arrive, and every order is charged by ${duration(w.deadlineSec)} after the sale ends. How many orders a second must they charge?`,
        unit: 'orders/s',
      };
  }
}

/** A line of arithmetic: `sum = result`, then a note in words. `sum` is null for a number read off the page. */
export interface WorkedLine {
  sum: string | null;
  result: string;
  note?: string;
  /** The line that states the step's result; on the last step, the answer. Defaults to the step's last line. */
  main?: boolean;
}

/** A numbered step: why it is taken, in plain words, then its arithmetic. */
export interface WorkedStep {
  reason: string;
  lines: readonly WorkedLine[];
}

export interface WorkedSolution {
  steps: readonly WorkedStep[];
  /** What the answer means for the design. */
  takeaway: string;
}

/** Words that once stood in for an explanation. CI checks no worked solution uses them. */
export const NAPKIN_JARGON = ['read-equivalent', 'equivalents'] as const;

/** "72.7%", "99.8%", "95%": percents at napkin precision. */
const pct = (fraction: number) => `${formatEstimate(fraction * 100)}%`;
const n = formatCount;
const est = formatEstimate;
/** "a large", "an xlarge". */
const a = (word: string) => `${/^[aeiox]/i.test(word) ? 'an' : 'a'} ${word}`;

/** "comfortable", "busy, past the 70% line", "hot, past the 85% line", "over capacity". */
function zoneWords(utilization: number): string {
  switch (utilizationZone(utilization)) {
    case 'comfortable':
      return 'comfortable';
    case 'busy':
      return `busy but under the ${pct(HOT_UTILIZATION)} hot line`;
    case 'hot':
      return `hot, past the ${pct(HOT_UTILIZATION)} line`;
    case 'overloaded':
      return 'over capacity';
  }
}

function workedStep(step: NapkinStep): WorkedStep {
  switch (step.kind) {
    case 'peak':
      return {
        reason: 'Size for the busiest moment, not the average: read the top of the traffic chart in the briefing.',
        lines: [{ sum: null, result: `${n(step.result)} req/s`, note: `at the peak, from ${formatSimTime(step.atSec)}` }],
      };
    case 'trafficAtEvent':
      return {
        reason: `What matters is the moment the cache restarts empty. It happens after the traffic has finished climbing, so use the full rate.`,
        lines: [{ sum: null, result: `${n(step.result)} req/s` }],
      };
    case 'cpuWork':
      return {
        reason: `Every request needs ${formatMs(step.cpuMsPerRequest)} of a vCPU's time. Add up the work that arrives each second.`,
        lines: [
          { sum: `${n(step.rps)} req/s × ${formatMs(step.cpuMsPerRequest)}`, result: `${n(step.result)} ms`, note: 'of CPU work every second' },
        ],
      };
    case 'vcpusBusy':
      return {
        reason: 'One vCPU does at most 1,000 ms of work in a second, so divide by 1,000 to count the vCPUs that work keeps busy.',
        lines: [{ sum: `${n(step.cpuMsPerSec)} ms ÷ 1,000 ms`, result: `${est(step.result)} vCPUs`, note: 'busy, flat out' }],
      };
    case 'serverCapacity':
      return {
        reason: `First, what one server can take. A vCPU finishes a ${formatMs(step.cpuMsPerRequest)} request ${est(step.perVcpuRps)} times a second, and ${a(step.size)} server has ${step.vcpu} vCPUs.`,
        lines: [
          { sum: `1,000 ms ÷ ${formatMs(step.cpuMsPerRequest)}`, result: `${est(step.perVcpuRps)} req/s`, note: 'per vCPU' },
          { sum: `${step.vcpu} vCPUs × ${est(step.perVcpuRps)} req/s`, result: `${n(step.result)} req/s`, note: 'per server, flat out' },
        ],
      };
    case 'serversNeeded':
      return {
        reason: "Divide the peak by what one server takes, then round up: you can't run part of a server.",
        lines: [
          { sum: `${n(step.rps)} ÷ ${n(step.perServerRps)}`, result: est(step.exact), main: false },
          { sum: null, result: `${step.result} servers`, note: 'rounded up' },
        ],
      };
    case 'spareServer':
      return {
        reason: 'Any server can die, so run one spare: lose one, and the rest still carry the peak. Engineers call it N+1.',
        lines: [{ sum: `${step.needed} + 1 spare`, result: `${step.result} servers` }],
      };
    case 'splitTraffic':
      if (step.readShare === 0) {
        return {
          reason: 'Every request here is a write: there are no reads to count.',
          lines: [{ sum: null, result: `${n(step.writes)} writes/s`, note: 'all of them' }],
        };
      }
      return {
        reason: `Every request is a read or a write, and a database treats them differently, so count them apart. ${pct(step.readShare)} are reads.`,
        lines: [
          { sum: `${n(step.rps)} × ${pct(step.readShare)}`, result: `${n(step.result)} reads/s`, main: true },
          { sum: `${n(step.rps)} − ${n(step.result)}`, result: `${n(step.writes)} writes/s` },
        ],
      };
    case 'writeCost':
      return {
        reason: `A write is more work than a read: it must be stored safely, not just looked up. ${capitalize(a(step.databaseSize))} database does ${n(step.databaseReadsPerSec)} reads a second or ${n(step.databaseWritesPerSec)} writes, so one write is as much work as several reads.`,
        lines: [
          {
            sum: `${n(step.databaseReadsPerSec)} ÷ ${n(step.databaseWritesPerSec)}`,
            result: est(step.result),
            note: `one write costs as much as ${est(step.result)} reads`,
          },
        ],
      };
    case 'writesFirst':
      return {
        reason: 'A cache only helps reads: every write still goes to the database. So the writes use up their share of its capacity first.',
        lines: [
          { sum: `${n(step.writes)} writes × ${est(step.writeCost)}`, result: `${n(step.writeWork)} reads' worth`, note: 'of work for the writes' },
          { sum: `${n(step.databaseReadsPerSec)} − ${n(step.writeWork)}`, result: `${n(step.result)} reads/s`, note: 'of room left for reads' },
        ],
      };
    case 'databaseShare':
      return {
        reason: "That's all the reads the database has room for. Compare it with the reads that arrive.",
        lines: [{ sum: `${n(step.readsLeft)} ÷ ${n(step.reads)}`, result: pct(step.result), note: 'of the reads can go to the database' }],
      };
    case 'cacheHitRate':
      return {
        reason: 'Every other read must be answered by the cache instead. That share is the hit rate the cache needs.',
        lines: [{ sum: `100% − ${pct(step.databaseShare)}`, result: `${est(step.result)}%`, note: 'hit rate' }],
      };
    case 'keyReadGap':
      return {
        reason: `The reads are spread evenly: every one of the ${n(step.keys)} ${step.keyLabel} is as likely as any other. So the same ${singular(step.keyLabel)} comes round again only once every ${step.keyLabel} has had its turn: ${step.keyLabel} ÷ reads a second.`,
        lines: [
          {
            sum: `${n(step.keys)} ÷ ${n(step.reads)} reads/s`,
            result: `${n(step.result)} s`,
            note: `between two reads of one ${singular(step.keyLabel)}, about ${Math.round(step.result / 60)} minutes`,
          },
        ],
      };
    case 'ownWriteReads':
      return {
        reason: `Of those reads, ${pct(step.share)} are users checking their own transfer just after making it. Those must see the fresh balance.`,
        lines: [{ sum: `${n(step.reads)} × ${pct(step.share)}`, result: `${n(step.result)} reads/s`, note: 'that must be fresh' }],
      };
    case 'totalWork':
      return {
        reason:
          step.context === 'pinnedPrimary'
            ? `Those reads go to the primary, and so does every write. A write is as much work as ${est(step.writeCost)} reads, so add it all up in reads.`
            : "Each shard serves reads and writes. Add up the work, counting each write as the reads it's worth.",
        lines: [
          { sum: `${n(step.writes)} writes × ${est(step.writeCost)}`, result: `${n(step.writeWork)} reads' worth`, note: 'for the writes' },
          { sum: `${n(step.reads)} reads + ${n(step.writeWork)}`, result: `${n(step.result)} reads' worth`, note: 'of work a second' },
        ],
      };
    case 'shardsOfWork':
      return {
        reason:
          step.unit === 'writes'
            ? `A shard is a whole database that owns a slice of the data. If the shard key spreads the writes evenly, each one takes up to ${n(step.shardCapacity)} writes a second.`
            : `A shard is a whole database that owns a slice of the data. If the work spreads evenly, each one takes up to ${n(step.shardCapacity)} reads' worth a second.`,
        lines: [{ sum: `${n(step.work)} ÷ ${n(step.shardCapacity)}`, result: `${est(step.result)} shards`, note: 'at full load' }],
      };
    case 'databaseBusy':
      return {
        reason: `Divide by what the database can do, ${n(step.databaseReadsPerSec)} reads a second, to see how busy it gets.`,
        lines: [{ sum: `${n(step.work)} ÷ ${n(step.databaseReadsPerSec)}`, result: `${est(step.result)}%`, note: 'busy' }],
      };
    case 'timesCapacity':
      return {
        reason: `An empty cache catches nothing, so every read falls straight through to the database. Compare that with the ${n(step.databaseReadsPerSec)} reads a second it can do.`,
        lines: [{ sum: `${n(step.reads)} ÷ ${n(step.databaseReadsPerSec)}`, result: `${est(step.result)}×`, note: 'its capacity, all at once' }],
      };
    case 'spikeOrders':
      return {
        reason: `Count the orders first: the sale sends ${n(step.rps)} a second for ${seconds(step.spikeSec)}.`,
        lines: [{ sum: `${n(step.rps)} × ${step.spikeSec} s`, result: `${n(step.result)} orders` }],
      };
    case 'drainWindow':
      return {
        reason: `The last order arrives as the sale ends, ${seconds(step.spikeSec)} in, and must be charged within ${seconds(step.deadlineSec)} of that. So the workers have the sale plus the deadline to charge them all.`,
        lines: [{ sum: `${step.spikeSec} s + ${step.deadlineSec} s`, result: seconds(step.result), note: 'from the start of the sale' }],
      };
    case 'drainRate':
      return {
        reason: 'Spread the orders over that time.',
        lines: [{ sum: `${n(step.orders)} ÷ ${step.windowSec} s`, result: `${n(step.result)} orders/s` }],
      };
  }
}

function takeaway(solution: NapkinSolution): string {
  const t = solution.takeaway;
  const answer = solution.working.result;
  switch (t.kind) {
    case 'vcpuHeadroom':
      return `${est(t.vcpus)} vCPUs is the work, not the size to buy. Past ${pct(HOT_UTILIZATION)} busy, requests queue and p99 climbs, so give it at least ${est(t.vcpus)} ÷ ${pct(HOT_UTILIZATION)} = ${est(t.atHot)} vCPUs, and nearer ${est(t.vcpus)} ÷ ${pct(COMFORTABLE_UTILIZATION)} = ${est(t.atComfortable)} to be comfortable.`;
    case 'survivors':
      return `With all ${t.servers} up, each runs ${pct(t.allUp)} busy. When one dies, the ${t.servers - 1} left run ${pct(t.oneDown)} busy: ${zoneWords(t.oneDown)}.`;
    case 'hitRateHeadroom':
      return `At exactly ${est(answer)}% the database runs 100% busy, and a full database is where the queues explode. Aim higher: a ${est(t.atHot)}% hit rate keeps it at ${pct(HOT_UTILIZATION)} busy, and ${est(t.atComfortable)}% at a comfortable ${pct(COMFORTABLE_UTILIZATION)}.`;
    case 'ttlCeiling':
      return `To keep values fresh by expiry alone, the TTL can't be longer than ${seconds(t.ttlSec)}, and with a ${seconds(t.ttlSec)} TTL even the biggest cache catches only about ${Math.round(t.hitRate)}% of reads at the peak: short of the ${est(t.needed)}% needed. So keep them fresh another way: invalidate on write, and keep the TTL long.`;
    case 'cacheExpiry':
      return `${n(t.gapSec)} s is about ${Math.round(t.gapSec / 60)} minutes. Even the longest expiry on offer, ${duration(t.longestTtlSec)} (${n(t.longestTtlSec)} s), runs out first, so a cached copy is almost always gone before anyone asks for it again: even the biggest cache catches only about ${Math.max(1, Math.round(t.hitRate * 100))}% of reads here. Add read capacity instead, with read replicas.`;
    case 'primaryHeadroom': {
      const smaller = t.smaller
        ? ` ${capitalize(a(t.smaller.size))} one would be ${pct(t.smaller.utilization)} busy: ${zoneWords(t.smaller.utilization)}.`
        : '';
      return t.utilization < COMFORTABLE_UTILIZATION
        ? `${pct(t.utilization)} is under the ${pct(COMFORTABLE_UTILIZATION)} line, so ${a(t.size)} primary is enough for the fresh reads and the writes.${smaller}`
        : `${pct(t.utilization)} is ${zoneWords(t.utilization)}: ${a(t.size)} primary is too small for the fresh reads and the writes.${smaller}`;
    }
    case 'wholeShards':
      return t.roundedUp === t.shards
        ? `You can't run ${est(t.atFullLoad)} shards: round up to ${t.shards}, each ${pct(t.utilization)} busy. That's only if the shard key spreads the writes evenly.`
        : `You can't run ${est(t.atFullLoad)} shards. ${t.roundedUp} would each run ${pct(t.roundedUpUtilization)} busy, ${zoneWords(t.roundedUpUtilization)}; ${t.shards} run ${pct(t.utilization)} each. That's only if the shard key spreads the writes evenly.`;
    case 'stampede':
      return `About ${Number(t.times.toFixed(1))} databases' worth of reads arrive at once, and the writes come on top. Past 100% the queue grows every second, refills wait behind the misses, and even the popular items keep missing: the stampede. Keep the misses off the database, or give it the capacity for that moment.`;
    case 'normalTraffic':
      return `That's only the sale. Normal traffic, ${n(t.normalRps)} orders a second, keeps arriving on top, so give the workers some room above ${n(t.drainRate)} a second.`;
  }
}

/** The estimate worked step by step, in Erasmus's words. */
export function workedSolution(solution: NapkinSolution): WorkedSolution {
  return { steps: solution.steps.map(workedStep), takeaway: takeaway(solution) };
}

/** The line of a step that states its result: the one marked `main`, else the last. */
export function mainLine(step: WorkedStep): WorkedLine {
  return step.lines.find((line) => line.main === true) ?? step.lines[step.lines.length - 1]!;
}

function verdict({ close, guess, answer }: EstimateResult): { exclaim: string; line: string } {
  if (close) {
    return guess === answer || Math.abs(guess - answer) < 1e-9
      ? { exclaim: 'Spot on.', line: "That's a napkin worth keeping. Bonus mark." }
      : { exclaim: 'Close enough.', line: 'Within 10%: that is all a napkin needs. Bonus mark.' };
  }
  return guess > answer
    ? { exclaim: 'Too high.', line: "Overestimating costs money. Here's the working, step by step." }
    : { exclaim: 'Too low.', line: "Underestimating costs nines. Here's the working, step by step." };
}


export const MENTOR_ESTIMATE: MentorEstimateScript = {
  ask,
  verdict,
  skipped: { exclaim: 'Skipped.', line: "No harm done. Here's how I'd work it out; the top bar brings the question back." },
  review: { exclaim: 'The working.', line: "Here's how I'd work it out, step by step." },
  revisit: 'Show the napkin working',
  bonus: 'napkin bonus',
};
