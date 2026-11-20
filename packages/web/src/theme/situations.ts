/**
 * What the cast reacts to, worked out from real level data and engine output. Pure and theme-independent: the game
 * decides *which* situation applies, a theme's script decides how its characters say it. So no theme can make a
 * character claim something the simulation didn't do.
 */
import {
  CLIENTS_ID,
  designCostUsdPerMonth,
  HEALTH_CHECK,
  levelNumbers,
  LOAD_BALANCER,
  nodeCostUsdPerMonth,
  peakLoad,
  type Chapter,
  type ComponentKind,
  type Design,
  type DesignIssue,
  type FailureReason,
  type Grade,
  type Level,
  type LevelNumbers,
  type LoadBalancerSpec,
  type QueueSpec,
  type ReadReplicasSpec,
  type SimEvent,
  type SimulationResult,
  type TimelineFrame,
} from '@five-nines/sim';
import { nodeCopies } from '../components/registry.ts';
import type { GradedEvaluation } from '../engine/index.ts';
import type { GuideEntryId } from '../guide/guide.ts';
import type { LevelAccess } from '../progression/index.ts';
import type { CastScript } from './contract.ts';

/**
 * The level's stress, for the troublemaker's tease. Most specific first: the first scripted event (a crash, a cache
 * restart, a hot key), then the data the level checks for freshness (read-your-writes, then a staleness limit), then
 * a traffic spike, then a traffic surge.
 */
export type LevelStress =
  | { kind: 'crash'; atSec: number }
  | { kind: 'cacheRestart'; atSec: number }
  | { kind: 'hotKey'; atSec: number; label: string; share: number }
  | { kind: 'readAfterWrite'; share: number }
  | { kind: 'staleness'; limitSec: number }
  | { kind: 'spike'; atSec: number; peakRps: number }
  | { kind: 'surge'; fromRps: number; toRps: number };

/** Null when the level has none of these (flat traffic, no events, no freshness rules). */
export function levelStress(level: Level): LevelStress | null {
  const event = level.events[0];
  switch (event?.kind) {
    case 'instanceFailure':
      return { kind: 'crash', atSec: event.atSec };
    case 'cacheRestart':
      return { kind: 'cacheRestart', atSec: event.atSec };
    case 'hotKey':
      return { kind: 'hotKey', atSec: event.atSec, label: event.label, share: event.share };
    case undefined:
      break;
  }
  const readAfterWrite = level.workload.data?.readAfterWrite;
  if (readAfterWrite) return { kind: 'readAfterWrite', share: readAfterWrite.share };
  const staleness = level.requirements.maxStalenessSec;
  if (staleness !== undefined) return { kind: 'staleness', limitSec: staleness };
  const traffic = level.workload.traffic;
  const rates = traffic.map((point) => point.rps);
  const start = rates[0] ?? 0;
  const peak = Math.max(0, ...rates);
  const end = rates[rates.length - 1] ?? 0;
  const spike = traffic.find((point) => point.rps === peak);
  if (spike && peak > end && spike.atSec > 0) return { kind: 'spike', atSec: spike.atSec, peakRps: peak };
  if (peak > start) return { kind: 'surge', fromRps: start, toRps: peak };
  return null;
}

/**
 * The boss's verdict on a graded run. A failed run is judged on its first failed check in the engine's order
 * (availability, latency, budget), so the boss always complains about the thing that actually went wrong.
 */
export type Verdict =
  | {
      kind: 'availability';
      availability: number;
      staleReads: boolean;
      /** Whether the root cause turned paying customers' orders away (refused, or never charged in time). */
      lostOrders: boolean;
    }
  | { kind: 'latency'; p99Ms: number | null; requiredMs: number }
  | { kind: 'budget'; costUsdPerMonth: number; budgetUsdPerMonth: number }
  | { kind: 'praise'; grade: Exclude<Grade, 'fail'> };

export function verdictFor(evaluation: Pick<GradedEvaluation, 'grade' | 'checks' | 'failedChecks' | 'simulation'>): Verdict {
  const { grade, checks } = evaluation;
  if (grade !== 'fail') return { kind: 'praise', grade };
  switch (evaluation.failedChecks[0]) {
    case 'latency':
      return { kind: 'latency', p99Ms: checks.latency.p99Ms, requiredMs: checks.latency.requiredMs };
    case 'budget':
      return {
        kind: 'budget',
        costUsdPerMonth: checks.budget.costUsdPerMonth,
        budgetUsdPerMonth: checks.budget.budgetUsdPerMonth,
      };
    default:
      return {
        kind: 'availability',
        availability: checks.availability.value,
        staleReads: evaluation.simulation.causes[0]?.reason === 'stale_read',
        lostOrders: ORDER_LOSSES.has(evaluation.simulation.causes[0]?.reason ?? 'overloaded'),
      };
  }
}

const ORDER_LOSSES: ReadonlySet<FailureReason> = new Set(['rate_limited', 'queue_full', 'deadline_missed']);

/** The design checks, as the mentor sees them. */
export interface CheckSummary {
  errors: number;
  warnings: number;
}

export function checkSummary(issues: readonly DesignIssue[]): CheckSummary {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

/**
 * How an event reads on the timeline and in the postmortem. The scripted events (a crashed instance, a restarted
 * cache, a hot key) are the troublemaker's doing; every other event (rotation changes, replica lag, a full queue) is
 * the system's, in the engine's words.
 */
export function eventCaption(event: SimEvent, script: CastScript): { text: string; byTroublemaker: boolean } {
  if (event.kind === 'instanceFailed' && event.instance !== undefined) {
    return { text: script.troublemakerCrash(event.nodeId, event.instance), byTroublemaker: true };
  }
  if (event.kind === 'cacheRestarted') {
    return { text: script.troublemakerCacheRestart(event.nodeId), byTroublemaker: true };
  }
  if (event.kind === 'hotKeyStarted' && event.label !== undefined) {
    return { text: script.troublemakerHotKey(event.label), byTroublemaker: true };
  }
  return { text: event.message, byTroublemaker: false };
}

/** A scripted event the troublemaker caused, pinned to the node it struck, for its note on the canvas. */
export type Strike =
  | { kind: 'crash'; nodeId: string; instance: number; atSec: number }
  | { kind: 'cacheRestart'; nodeId: string; atSec: number }
  | { kind: 'hotKey'; nodeId: string; label: string; atSec: number };

/** How long a strike's note stays pinned to its node during playback, in simulated seconds. */
export const STRIKE_NOTE_SEC = 12;

/**
 * The troublemaker's strikes still worth a note at `timeSec`: struck within the last `STRIKE_NOTE_SEC`, the latest
 * per node. A hot key concerns the whole data set rather than one node, so its note goes on the design's shards (or,
 * failing that, its database).
 */
export function recentStrikes(events: readonly SimEvent[], timeSec: number, design: Design): Strike[] {
  const byNode = new Map<string, Strike>();
  const dataNode = design.nodes.find((node) => node.kind === 'shards') ?? design.nodes.find((node) => node.kind === 'database');
  for (const event of events) {
    if (event.atSec > timeSec || timeSec - event.atSec > STRIKE_NOTE_SEC) continue;
    let strike: Strike | null = null;
    if (event.kind === 'instanceFailed' && event.instance !== undefined) {
      strike = { kind: 'crash', nodeId: event.nodeId, instance: event.instance, atSec: event.atSec };
    } else if (event.kind === 'cacheRestarted') {
      strike = { kind: 'cacheRestart', nodeId: event.nodeId, atSec: event.atSec };
    } else if (event.kind === 'hotKeyStarted' && event.label !== undefined && dataNode) {
      strike = { kind: 'hotKey', nodeId: dataNode.id, label: event.label, atSec: event.atSec };
    }
    if (strike) byNode.set(strike.nodeId, strike);
  }
  return [...byNode.values()];
}

/** The mentor's hint for a failure reason, or the sign-off when there's none. */
export function mentorHint(reason: FailureReason | null | undefined, script: CastScript): string {
  return reason ? script.mentorHints[reason] : script.mentorSignOff;
}

/** The troublemaker's tease for a level, or null when it has no stress to tease. */
export function troublemakerTease(level: Level, script: CastScript): string | null {
  const stress = levelStress(level);
  return stress ? script.troublemakerTease(stress) : null;
}

// ---------------------------------------------------------------------------- latency

/** The busiest machine in a second of the run: the up instance with the highest utilization, by node. */
export interface Busiest {
  nodeId: string;
  utilization: number;
}

/** Why p99 was where it was in one second of the run: the requirement, and the busiest machine then. */
export interface LatencySituation {
  atSec: number;
  p99Ms: number;
  requiredMs: number;
  /** Null when no machine was measurably busy (nothing to blame but the route itself). */
  busiest: Busiest | null;
}

/** Below this, a machine isn't busy enough to explain a latency problem. */
const NOTABLY_BUSY = 0.05;

export function busiestAt(frame: Pick<TimelineFrame, 'nodes'>): Busiest | null {
  let best: Busiest | null = null;
  for (const [nodeId, node] of Object.entries(frame.nodes)) {
    for (const instance of node.instances) {
      if (instance.up && (best === null || instance.utilization > best.utilization)) {
        best = { nodeId, utilization: instance.utilization };
      }
    }
  }
  return best && best.utilization >= NOTABLY_BUSY ? best : null;
}

/** The latency situation in one second of the run. Null when no request succeeded that second. */
export function latencyAt(frame: TimelineFrame, requiredMs: number): LatencySituation | null {
  if (frame.p99Ms === null) return null;
  return { atSec: frame.atSec, p99Ms: frame.p99Ms, requiredMs, busiest: busiestAt(frame) };
}

/** The second with the worst p99 in the run, and why. */
export function worstLatency(timeline: readonly TimelineFrame[], requiredMs: number): LatencySituation | null {
  let worst: TimelineFrame | null = null;
  for (const frame of timeline) {
    if (frame.p99Ms !== null && (worst === null || frame.p99Ms > worst.p99Ms!)) worst = frame;
  }
  return worst ? latencyAt(worst, requiredMs) : null;
}

/** p99 within this share of the limit counts as climbing towards it. */
export const LATENCY_WARNING_SHARE = 0.8;

/** Whether p99 is worth a word during playback: over the limit, or climbing close to it. */
export function latencyWorthNoting(situation: LatencySituation | null): situation is LatencySituation {
  return situation !== null && situation.p99Ms > situation.requiredMs * LATENCY_WARNING_SHARE;
}

// ---------------------------------------------------------------------------- failover

/** What happened around a crashed instance: when it died, when the load balancer noticed, and what it cost. */
export interface FailoverSituation {
  crashedAtSec: number;
  nodeId: string;
  instance: number;
  /** The load balancer in front of the instance; null when there is none. */
  balancerId: string | null;
  healthCheckIntervalSec: number | null;
  /** Failed checks in a row before an instance leaves rotation. */
  checksToRemove: number;
  /** When the balancer took the instance out of rotation, or null if it never did. */
  removedAtSec: number | null;
  /** Whether the balancer retries refused connections on another instance. */
  retries: boolean;
  /** Instances in rotation before the crash: the dead one got 1 in this many of the balancer's requests. */
  rotationSize: number;
  /** Requests that failed at the crashed instance's server, up to `asOfSec`. */
  lostRequests: number;
  /** `lostRequests` over all requests up to `asOfSec`. */
  lostShare: number;
  /** The moment this describes: the freeze-frame, or the end of the run. */
  asOfSec: number;
  /** Whether this describes the whole run (the grade card) rather than a moment in it (the freeze-frame). */
  wholeRun: boolean;
}

/**
 * The run's first crash and the failover around it, counting losses up to `asOfSec` (default: the whole run). Null when
 * nothing crashed.
 */
export function failoverSituation(
  design: Design,
  simulation: Pick<SimulationResult, 'events' | 'causes' | 'timeline' | 'totalRequests'>,
  asOfSec?: number,
): FailoverSituation | null {
  const crash = simulation.events.find((event) => event.kind === 'instanceFailed');
  if (!crash || crash.instance === undefined) return null;
  const balancer = design.nodes.find(
    (node): node is LoadBalancerSpec =>
      node.kind === 'loadBalancer' && design.edges.some((edge) => edge.from === node.id && edge.to === crash.nodeId),
  );
  const removed = simulation.events.find(
    (event) =>
      event.kind === 'removedFromRotation' &&
      event.nodeId === crash.nodeId &&
      event.instance === crash.instance &&
      event.atSec >= crash.atSec,
  );
  const rotationSize = balancer
    ? design.edges
        .filter((edge) => edge.from === balancer.id)
        .reduce((sum, edge) => {
          const target = design.nodes.find((node) => node.id === edge.to);
          return sum + (target?.kind === 'appServer' ? target.instances : 0);
        }, 0)
    : 1;

  const end = simulation.timeline.length;
  const until = asOfSec === undefined ? end : Math.min(end, asOfSec);
  let lostRequests: number;
  let offered: number;
  if (asOfSec === undefined) {
    lostRequests = simulation.causes
      .filter((cause) => cause.nodeId === crash.nodeId && cause.reason === 'instance_down')
      .reduce((sum, cause) => sum + cause.requests, 0);
    offered = simulation.totalRequests;
  } else {
    lostRequests = 0;
    offered = 0;
    for (const frame of simulation.timeline) {
      if (frame.atSec >= until) break;
      offered += frame.offeredRps;
      if (frame.atSec >= Math.floor(crash.atSec)) lostRequests += frame.nodes[crash.nodeId]?.failedRps ?? 0;
    }
  }

  return {
    crashedAtSec: crash.atSec,
    nodeId: crash.nodeId,
    instance: crash.instance,
    balancerId: balancer?.id ?? null,
    healthCheckIntervalSec: balancer?.healthCheckIntervalSec ?? null,
    checksToRemove: HEALTH_CHECK.unhealthyThreshold,
    removedAtSec: removed?.atSec ?? null,
    retries: balancer?.retryOnConnectFailure ?? false,
    rotationSize,
    lostRequests,
    lostShare: offered > 0 ? lostRequests / offered : 0,
    asOfSec: asOfSec === undefined ? end : until,
    wholeRun: asOfSec === undefined,
  };
}

// ---------------------------------------------------------------------------- the hint ladder

/** What kind of failure a run had, for the mentor's hints. */
export type HintTopic =
  | 'overload'
  | 'crash'
  | 'stale'
  | 'rateLimit'
  | 'queueFull'
  | 'deadline'
  | 'latency'
  | 'budget';

export const HINT_TOPICS: readonly HintTopic[] = [
  'overload',
  'crash',
  'stale',
  'rateLimit',
  'queueFull',
  'deadline',
  'latency',
  'budget',
];

/** The rungs of the hint ladder, in the order the mentor offers them (docs/design.md, "Hints and iteration"). */
export const HINT_STEPS = ['where', 'why', 'concept', 'fix'] as const;
export type HintStep = (typeof HINT_STEPS)[number];

/** What went wrong in a failed run, with the numbers the mentor's hints quote. Derived from the first failed check. */
export type FailureStory =
  | {
      topic: 'overload';
      nodeId: string;
      kind: ComponentKind;
      firstAtSec: number;
      /** The node's highest utilization in the run, from the timeline. Null if it reported none. */
      peakUtilization: number | null;
      timeoutMs: number;
      /** Sharded databases: the shard that carried the most when things started failing, and its share. */
      hotShard: { index: number; share: number; count: number } | null;
      /** When the cache restarted, if that happened before things started failing. */
      cacheRestartAtSec: number | null;
    }
  | {
      topic: 'crash';
      nodeId: string;
      firstAtSec: number;
      /** True when the load balancer had nothing left in rotation at all. */
      noneLeft: boolean;
      failover: FailoverSituation | null;
    }
  | {
      topic: 'stale';
      nodeId: string;
      kind: ComponentKind;
      firstAtSec: number;
      /** Highest replication lag of the replicas that served the stale reads, if they were replicas. */
      peakLagSec: number | null;
      limitSec: number | null;
      /** Whether readers must see their own writes (read-after-write traffic). */
      readAfterWrite: boolean;
      /** The read-your-writes window on the design's replicas, 0 when off. */
      pinnedSec: number;
    }
  | {
      topic: 'rateLimit';
      nodeId: string;
      firstAtSec: number;
      /** The most calls a second the provider was sent, and its limit. */
      peakCallsRps: number;
      rateLimitRps: number;
    }
  | {
      topic: 'queueFull' | 'deadline';
      nodeId: string;
      firstAtSec: number;
      maxDepth: number;
      /** How long the longest-waiting order waited (capped at the deadline), and the deadline (null if none). */
      peakWaitSec: number;
      deadlineSec: number | null;
      /** What the workers could charge a second at most. */
      workerRps: number;
      workers: number;
    }
  | { topic: 'latency'; p99Ms: number | null; requiredMs: number; worst: LatencySituation | null }
  | {
      topic: 'budget';
      costUsdPerMonth: number;
      budgetUsdPerMonth: number;
      /** The most expensive component in the design. */
      priciest: { nodeId: string; usdPerMonth: number } | null;
    };

/** The story of a failed run, or null when it passed. */
export function failureStory(level: Level, design: Design, evaluation: GradedEvaluation): FailureStory | null {
  if (evaluation.grade !== 'fail') return null;
  const { checks, simulation } = evaluation;
  switch (evaluation.failedChecks[0]) {
    case 'latency':
      return {
        topic: 'latency',
        p99Ms: checks.latency.p99Ms,
        requiredMs: checks.latency.requiredMs,
        worst: worstLatency(simulation.timeline, checks.latency.requiredMs),
      };
    case 'budget': {
      const priciest = design.nodes
        .map((node) => ({ nodeId: node.id, usdPerMonth: nodeCostUsdPerMonth(node) }))
        .reduce<{ nodeId: string; usdPerMonth: number } | null>((best, n) => (best && best.usdPerMonth >= n.usdPerMonth ? best : n), null);
      return {
        topic: 'budget',
        costUsdPerMonth: checks.budget.costUsdPerMonth,
        budgetUsdPerMonth: checks.budget.budgetUsdPerMonth,
        priciest,
      };
    }
    default:
      break;
  }

  const cause = simulation.causes[0];
  const kindOf = (id: string): ComponentKind => design.nodes.find((node) => node.id === id)?.kind ?? 'appServer';
  if (!cause) {
    // Availability failed without a recorded cause can't happen; fall back to latency so the ladder still helps.
    return { topic: 'latency', p99Ms: checks.latency.p99Ms, requiredMs: checks.latency.requiredMs, worst: null };
  }
  switch (cause.reason) {
    case 'instance_down':
    case 'no_healthy_backend':
      return {
        topic: 'crash',
        nodeId: cause.nodeId,
        firstAtSec: cause.firstAtSec,
        noneLeft: cause.reason === 'no_healthy_backend',
        failover: failoverSituation(design, simulation),
      };
    case 'stale_read': {
      const replicas = design.nodes.find((node): node is ReadReplicasSpec => node.kind === 'readReplicas');
      return {
        topic: 'stale',
        nodeId: cause.nodeId,
        kind: kindOf(cause.nodeId),
        firstAtSec: cause.firstAtSec,
        peakLagSec: simulation.dataTier.peakReplicationLagSec[cause.nodeId] ?? null,
        limitSec: level.requirements.maxStalenessSec ?? null,
        readAfterWrite: level.workload.data?.readAfterWrite !== undefined,
        pinnedSec: replicas?.readYourWritesSec ?? 0,
      };
    }
    case 'timeout':
    case 'overloaded': {
      const restart = simulation.events.find((event) => event.kind === 'cacheRestarted' && event.atSec <= cause.firstAtSec);
      return {
        topic: 'overload',
        nodeId: cause.nodeId,
        kind: kindOf(cause.nodeId),
        firstAtSec: cause.firstAtSec,
        peakUtilization: peakUtilization(simulation.timeline, cause.nodeId, design),
        timeoutMs: level.workload.timeoutMs,
        hotShard: hotShardAt(simulation.timeline, cause.nodeId, cause.firstAtSec),
        cacheRestartAtSec: restart?.atSec ?? null,
      };
    }
    case 'rate_limited': {
      let peakCallsRps = 0;
      for (const frame of simulation.timeline) peakCallsRps = Math.max(peakCallsRps, frame.nodes[cause.nodeId]?.arrivalRps ?? 0);
      return {
        topic: 'rateLimit',
        nodeId: cause.nodeId,
        firstAtSec: cause.firstAtSec,
        peakCallsRps,
        rateLimitRps: level.workload.payments?.rateLimitRps ?? 0,
      };
    }
    case 'queue_full':
    case 'deadline_missed': {
      const queue = design.nodes.find((node): node is QueueSpec => node.id === cause.nodeId && node.kind === 'queue');
      const frame = simulation.timeline.find((f) => f.nodes[cause.nodeId]?.maxQueueDepth !== undefined)?.nodes[cause.nodeId];
      return {
        topic: cause.reason === 'queue_full' ? 'queueFull' : 'deadline',
        nodeId: cause.nodeId,
        firstAtSec: cause.firstAtSec,
        maxDepth: frame?.maxQueueDepth ?? 0,
        peakWaitSec: simulation.payments.peakQueueWaitSec[cause.nodeId] ?? 0,
        deadlineSec: level.requirements.processWithinSec ?? null,
        workerRps: frame?.workerRps ?? 0,
        workers: queue?.workers ?? 0,
      };
    }
  }
}

/** A sharded database's busiest shard in the second things started failing, if it carried clearly more than its share. */
function hotShardAt(
  timeline: readonly TimelineFrame[],
  nodeId: string,
  atSec: number,
): { index: number; share: number; count: number } | null {
  const shares = timeline[Math.min(timeline.length - 1, Math.max(0, Math.floor(atSec)))]?.nodes[nodeId]?.shardShares ?? [];
  const hottest = hottestShard(shares);
  return hottest?.hot ? { index: hottest.index, share: hottest.share, count: shares.length } : null;
}

/** A shard carrying this many times an even split counts as hot. */
const HOT_SHARD_FACTOR = 1.25;

/** The shard with the largest share, and whether it is hot: carrying clearly more than an even split. */
export function hottestShard(shares: readonly number[]): { index: number; share: number; hot: boolean } | null {
  if (shares.length === 0) return null;
  let index = 0;
  for (let k = 1; k < shares.length; k++) if (shares[k]! > shares[index]!) index = k;
  const share = shares[index]!;
  return { index, share, hot: share >= HOT_SHARD_FACTOR / shares.length };
}

/** A node's highest utilization over the run: its busiest machine, or a load balancer's share of its limit. */
function peakUtilization(timeline: readonly TimelineFrame[], nodeId: string, design: Design): number | null {
  const isBalancer = design.nodes.some((node) => node.id === nodeId && node.kind === 'loadBalancer');
  let peak: number | null = null;
  for (const frame of timeline) {
    const node = frame.nodes[nodeId];
    if (!node) continue;
    const values = isBalancer
      ? [node.arrivalRps / LOAD_BALANCER.maxRps]
      : node.instances.filter((instance) => instance.up).map((instance) => instance.utilization);
    for (const value of values) peak = peak === null ? value : Math.max(peak, value);
  }
  return peak;
}

/** One rung of the ladder, worded. */
export interface HintRung {
  step: HintStep;
  text: string;
}

export interface HintLadder {
  /** `level`: before any failed run, about the level's main trap. `run`: about what went wrong in a failed run. */
  kind: 'level' | 'run';
  topic: HintTopic;
  rungs: readonly HintRung[];
  /** The field-guide entry that explains the idea, or null when none does. */
  guide: GuideEntryId | null;
}

/** The mentor's four hints for a failed run, in order: where it broke, why, the concept, the fix. */
export function hintLadder(level: Level, story: FailureStory, script: CastScript): HintLadder {
  const words = script.mentorLadder;
  return {
    kind: 'run',
    topic: story.topic,
    rungs: [
      { step: 'where', text: words.where(story) },
      { step: 'why', text: words.why(story) },
      { step: 'concept', text: words.concept(level.id, story.topic) },
      { step: 'fix', text: words.fix(level.id, story.topic) },
    ],
    guide: storyGuideEntry(story),
  };
}

function storyGuideEntry(story: FailureStory): GuideEntryId | null {
  switch (story.topic) {
    case 'overload':
    case 'stale':
      return story.kind;
    case 'crash':
      return 'loadBalancer';
    case 'rateLimit':
    case 'queueFull':
    case 'deadline':
      return 'queue';
    case 'latency':
      return 'p99';
    case 'budget':
      return null;
  }
}

/**
 * Each level's main trap: the kind of failure a first design most likely runs into, and the field-guide entry for
 * the idea that avoids it. The hints before any failed run are about this (docs/design.md, "Hints and iteration").
 */
export const LEVEL_TRAPS: Readonly<Record<string, { topic: HintTopic; guide: GuideEntryId }>> = {
  '01-hello-traffic': { topic: 'overload', guide: 'appServer' },
  '02-scale-out': { topic: 'overload', guide: 'loadBalancer' },
  '03-pull-the-plug': { topic: 'crash', guide: 'loadBalancer' },
  '11-everything-links': { topic: 'overload', guide: 'database' },
  '04-read-all-about-it': { topic: 'overload', guide: 'cache' },
  '05-cache-miss': { topic: 'overload', guide: 'readReplicas' },
  '06-bank-balance': { topic: 'stale', guide: 'readReplicas' },
  '07-the-write-wall': { topic: 'overload', guide: 'shards' },
  '08-thundering-herd': { topic: 'overload', guide: 'cache' },
  '09-stale-prices': { topic: 'stale', guide: 'cache' },
  '10-flash-sale': { topic: 'rateLimit', guide: 'queue' },
};

/** A level's main trap, with the numbers the mentor's hints quote. */
export interface LevelTrap {
  levelId: string;
  topic: HintTopic;
  numbers: LevelNumbers;
  stress: LevelStress | null;
}

export function levelTrap(level: Level): LevelTrap | null {
  const trap = LEVEL_TRAPS[level.id];
  return trap ? { levelId: level.id, topic: trap.topic, numbers: levelNumbers(level), stress: levelStress(level) } : null;
}

/** The mentor's four hints before any failed run: where to look, why it's hard, the concept, the fix. */
export function levelHintLadder(level: Level, script: CastScript): HintLadder | null {
  const trap = levelTrap(level);
  if (!trap) return null;
  const words = script.mentorLadder;
  return {
    kind: 'level',
    topic: trap.topic,
    rungs: [
      { step: 'where', text: words.beforeRun.where(trap) },
      { step: 'why', text: words.beforeRun.why(trap) },
      { step: 'concept', text: words.concept(level.id, trap.topic) },
      { step: 'fix', text: words.fix(level.id, trap.topic) },
    ],
    guide: LEVEL_TRAPS[level.id]!.guide,
  };
}

/**
 * Money left under the budget: the second score (docs/ideas.md, "Cost as a second score"). Null when the design went
 * over budget (the boss's verdict already covers that).
 */
export interface SavingsSituation {
  savedUsdPerMonth: number;
  costUsdPerMonth: number;
  budgetUsdPerMonth: number;
  /** Saved ÷ budget, 0…1. */
  share: number;
  grade: Grade;
}

export function savingsSituation(evaluation: Pick<GradedEvaluation, 'grade' | 'checks'>): SavingsSituation | null {
  const { costUsdPerMonth, budgetUsdPerMonth, ok } = evaluation.checks.budget;
  if (!ok || budgetUsdPerMonth <= 0) return null;
  const savedUsdPerMonth = budgetUsdPerMonth - costUsdPerMonth;
  return { savedUsdPerMonth, costUsdPerMonth, budgetUsdPerMonth, share: savedUsdPerMonth / budgetUsdPerMonth, grade: evaluation.grade };
}

// ---------------------------------------------------------------------------- design trade-offs

/** One part of a design, as the trade-off line counts it: "6 medium app servers". */
export interface DesignPart {
  kind: ComponentKind;
  /** The size option, where the kind has one. */
  size: string | null;
  /** Machines it stands for (`nodeCopies`); a replicated cache counts once, with `replicated` among its options. */
  count: number;
  /** The switches that change how it behaves, where it has them. */
  options: readonly DesignOption[];
}

/** A design choice beyond size and count. */
export type DesignOption = 'replicated' | 'coalescing' | 'invalidates' | 'readYourWrites';

function designOptions(node: Design['nodes'][number]): DesignOption[] {
  if (node.kind === 'cache') {
    return [
      ...(node.replicated ? (['replicated'] as const) : []),
      ...(node.coalesceMisses ? (['coalescing'] as const) : []),
      ...(node.invalidateOnWrite ? (['invalidates'] as const) : []),
    ];
  }
  if (node.kind === 'readReplicas' && (node.readYourWritesSec ?? 0) > 0) return ['readYourWrites'];
  return [];
}

/** A design boiled down to the choices it made, for comparing it with others. */
export interface DesignSketch {
  /** The parts, in design order, the load balancer left out (it shows as `retries`). */
  parts: readonly DesignPart[];
  /** Whether it has a load balancer. */
  balanced: boolean;
  /** Whether its load balancer retries refused connections. */
  retries: boolean;
  /**
   * In a level with a crash: whether its app servers still keep up (at most 100% busy at the peak) after losing the
   * busiest one, worked out on paper (`peakLoad`). Always false in a level without one.
   */
  spare: boolean;
  costUsdPerMonth: number;
}

export function designSketch(level: Level, design: Design): DesignSketch {
  const balancers = design.nodes.filter((node): node is LoadBalancerSpec => node.kind === 'loadBalancer');
  const afterCrash = peakLoad(level, design).afterCrash;
  const appServers = design.nodes.filter((node) => node.kind === 'appServer');
  const spare =
    afterCrash !== null &&
    appServers.length > 0 &&
    appServers.every((node) => {
      const load = afterCrash[node.id];
      return load === undefined || load.utilization <= 1;
    });
  return {
    parts: design.nodes
      .filter((node) => node.id !== CLIENTS_ID && node.kind !== 'loadBalancer')
      .map((node) => ({
        kind: node.kind,
        size: 'size' in node && typeof node.size === 'string' ? node.size : null,
        count: node.kind === 'cache' ? 1 : nodeCopies(node),
        options: designOptions(node),
      })),
    balanced: balancers.length > 0,
    retries: balancers.some((node) => node.retryOnConnectFailure === true),
    spare,
    costUsdPerMonth: designCostUsdPerMonth(design),
  };
}

/** Two sketches make the same choices: the same parts, sizes and counts, the same flags. Cost follows from those. */
function sameChoices(a: DesignSketch, b: DesignSketch): boolean {
  const key = (s: DesignSketch) =>
    JSON.stringify([s.parts.map((p) => [p.kind, p.size, p.count, ...p.options]).sort(), s.balanced, s.retries, s.spare]);
  return key(a) === key(b);
}

/**
 * The player's passing design beside the level's reference solutions: what they chose and what it cost, and the other
 * designs that also pass. Only after a pass, so it never spoils a level still to solve.
 */
export interface DesignComparison {
  yours: DesignSketch;
  /** Whether the player's design makes the same choices as one of the references. */
  matchesReference: boolean;
  /** The references that choose differently, cheapest first. */
  others: readonly DesignSketch[];
}

export function designComparison(
  level: Level,
  design: Design,
  evaluation: Pick<GradedEvaluation, 'grade'>,
): DesignComparison | null {
  if (evaluation.grade === 'fail') return null;
  const yours = designSketch(level, design);
  const references = level.solutions.map((solution) => designSketch(level, solution.design));
  return {
    yours,
    matchesReference: references.some((reference) => sameChoices(reference, yours)),
    others: references
      .filter((reference) => !sameChoices(reference, yours))
      .sort((a, b) => a.costUsdPerMonth - b.costUsdPerMonth),
  };
}

/** Why a level is closed, with what the cast needs to say it. */
export type LockSituation =
  | { kind: 'previousLevel'; levelNumber: number; title: string }
  | { kind: 'chapter'; chapterNumber: number; chapterTitle: string; needed: number; have: number };

/** Null for an open level. */
export function lockSituation(
  access: LevelAccess,
  levels: readonly Pick<Level, 'id' | 'title'>[],
  chapters: readonly Chapter[],
): LockSituation | null {
  switch (access.kind) {
    case 'open':
      return null;
    case 'previousLevel': {
      const index = levels.findIndex((level) => level.id === access.levelId);
      return { kind: 'previousLevel', levelNumber: index + 1, title: levels[index]?.title ?? access.levelId };
    }
    case 'chapter': {
      const index = chapters.findIndex((chapter) => chapter.id === access.chapterId);
      return {
        kind: 'chapter',
        chapterNumber: index + 1,
        chapterTitle: chapters[index]?.title ?? access.chapterId,
        needed: access.needed,
        have: access.have,
      };
    }
  }
}
