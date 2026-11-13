/**
 * What Erasmus says when the maths matters: the hint ladder after a failed run, the p99 explanation, the failover
 * arithmetic after a crash and the napkin-maths step. The game decides the situation and its numbers
 * (`theme/situations.ts`, `@five-nines/sim`'s estimate working); this file only words them.
 *
 * The concept and fix rungs are written per level and per kind of failure, with a general line for each kind as
 * the fallback. CI checks every level has its own line for every failure its known wrong answers produce.
 */
import { AVAILABILITY_TIERS, COMPONENT_LABELS, type EstimateWorking } from '@five-nines/sim';
import { formatCount, formatMs, formatPercent, formatSeconds, formatSimTime, formatUsd } from '../../format.ts';
import type { EstimateResult, MentorEstimateScript, MentorLadderScript } from '../contract.ts';
import type { FailoverSituation, FailureStory, HintTopic, LatencySituation } from '../situations.ts';

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
      return `Look at ${story.nodeId}, the ${COMPONENT_LABELS[story.kind].toLowerCase()}: from ${formatSimTime(story.firstAtSec)} its requests started failing.`;
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
      return story.peakUtilization === null
        ? `${story.nodeId} couldn't keep up: requests waited in its queue past the ${formatMs(story.timeoutMs)} timeout.`
        : `${story.nodeId} got as far as ${busy(story.peakUtilization)}. Work arrived faster than it finished, the queue grew, and requests waited past the ${formatMs(story.timeoutMs)} timeout.`;
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
};

export const MENTOR_LADDER: MentorLadderScript = {
  where,
  why,
  concept: (levelId, topic) => LEVEL_HINTS[levelId]?.[topic]?.concept ?? GENERAL[topic].concept,
  fix: (levelId, topic) => LEVEL_HINTS[levelId]?.[topic]?.fix ?? GENERAL[topic].fix,
  stepLabels: { where: 'Where it broke', why: 'Why', concept: 'The idea', fix: 'The fix' },
  more: 'Another hint',
};

/** The general lines, exported so tests can tell a level's own line from the fallback. */
export const GENERAL_HINTS = GENERAL;

// ---------------------------------------------------------------------------- napkin maths

function ask(w: EstimateWorking): { question: string; unit: string } {
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
        question: `Napkin first. At the peak, what share of reads must a cache catch so that a ${w.databaseSize} database (${formatCount(w.databaseReadsPerSec)} reads a second, one write costs ${w.writeCost} reads) keeps up?`,
        unit: '%',
      };
    case 'readsAtPeak':
      return {
        question: `Napkin first. How many reads per second reach the data tier at the peak, before any cache or replica?`,
        unit: 'reads/s',
      };
    case 'readAfterWriteReadsAtPeak':
      return {
        question: `Napkin first. On payday, how many reads per second are users checking their own fresh transfer? Those are the reads that can't afford a stale copy.`,
        unit: 'reads/s',
      };
  }
}

function working(w: EstimateWorking): string {
  switch (w.quantity) {
    case 'busyVcpusAtPeak':
      return `${formatCount(w.peakRps)} req/s × ${formatMs(w.cpuMsPerRequest)} = ${round(w.result)} vCPU-seconds of work every second: ${round(w.result)} vCPUs busy. Add headroom to stay under 70%.`;
    case 'serversWithSpare':
      return `One ${w.size} server does ${w.vcpu} ÷ ${formatMs(w.cpuMsPerRequest)} = ${formatCount(w.perServerRps)} req/s. ${formatCount(w.peakRps)} ÷ ${formatCount(w.perServerRps)} rounds up to ${w.needed}, plus one spare: ${w.result}.`;
    case 'cacheHitRateNeeded':
      return `${formatCount(w.writesPerSec)} writes × ${w.writeCost} = ${formatCount(w.writesPerSec * w.writeCost)} read-equivalents, leaving ${formatCount(w.readsLeft)} reads for the database. ${formatCount(w.readsPerSec)} reads arrive, so the cache must catch 1 − ${formatCount(w.readsLeft)} ÷ ${formatCount(w.readsPerSec)} = ${round(w.result)}%, more for headroom.`;
    case 'readsAtPeak':
      return `${formatCount(w.peakRps)} req/s × ${formatPercent(w.readShare)} reads = ${formatCount(w.result)} reads a second.`;
    case 'readAfterWriteReadsAtPeak':
      return `${formatCount(w.peakRps)} req/s × ${formatPercent(w.readShare)} reads × ${formatPercent(w.readAfterWriteShare)} checking their own write = ${formatCount(w.result)} reads a second.`;
  }
}

function verdict({ close, guess, answer }: EstimateResult): { exclaim: string; line: string } {
  if (close) {
    return guess === answer || Math.abs(guess - answer) < 1e-9
      ? { exclaim: 'Spot on.', line: "That's a napkin worth keeping. Bonus mark." }
      : { exclaim: 'Close enough.', line: 'Within 10%: that is all a napkin needs. Bonus mark.' };
  }
  return guess > answer
    ? { exclaim: 'Too high.', line: "Overestimating costs money. Here's the working; the numbers are all in the briefing." }
    : { exclaim: 'Too low.', line: "Underestimating costs nines. Here's the working; the numbers are all in the briefing." };
}

/** Answers keep the precision a napkin would: 3.5, 50, 72.7, 19,200. */
function round(value: number): string {
  return Math.abs(value) >= 100 ? formatCount(value) : String(Number(value.toFixed(1)));
}

export const MENTOR_ESTIMATE: MentorEstimateScript = {
  ask,
  working,
  verdict,
  bonus: 'napkin bonus',
};
