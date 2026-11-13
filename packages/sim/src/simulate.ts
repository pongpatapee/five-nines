/**
 * The simulation engine.
 *
 * Load is modelled as fluid flow, ticked every TICK_SEC. Each tick, the request rate is pushed through the
 * design and every app-server instance updates its backlog. Failures are counted as exact fractions of the
 * flow, so availability can be graded down to five nines. Below capacity, queueing delay follows the M/M/c
 * model (Erlang C) for a pool of `vcpu` workers.
 *
 * Latency percentiles can't be computed in closed form across several hops, so each tick also walks a few
 * sampled "probe" requests through the design using the same per-instance state. Probes only measure the
 * latency of successful requests; they never decide availability.
 *
 * In levels with a data workload, requests that an app server finishes go on to the data tier (`data-tier.ts`); in
 * levels with payments, they charge a payment, directly or through a queue (`payments.ts`).
 */
import {
  APP_SERVER_SIZES,
  AVAILABILITY_TIERS,
  CLIENTS_ID,
  CONNECT_FAIL_MS,
  HEALTH_CHECK,
  HOP_LATENCY_MS,
  LOAD_BALANCER,
  PROBES_PER_TICK,
  TICK_SEC,
} from './catalog.ts';
import { DataTier, type DataTierSummary } from './data-tier.ts';
import { PaymentTier, type PaymentSummary } from './payments.ts';
import { buildGraph, edgeKey, type Graph } from './graph.ts';
import { createRng, interpolate, pick, sampleExponential, WeightedSamples, type Rng } from './math.ts';
import { DOWN_TICK, newStation, probeWait, stepStation, type StationState, type StationTick } from './queue.ts';
import type { AppServerSpec, Design, Level, LoadBalancerSpec, ScenarioEvent } from './schema.ts';

export type FailureReason =
  /** A load balancer received more requests than it can handle. */
  | 'overloaded'
  /**
   * The request waited in an app server's queue past the timeout: either the backlog was longer than the instance
   * could clear in time (sustained overload), or random queueing near capacity. One reason, because to the player
   * both are the same thing: that server can't keep up.
   */
  | 'timeout'
  /** The request was sent to, or was queued on, a crashed instance. */
  | 'instance_down'
  /** A load balancer had no instance in rotation. */
  | 'no_healthy_backend'
  /** A read returned data older than the level allows, or missed the reader's own write. */
  | 'stale_read'
  /** The payment provider refused a call over its rate limit while the customer waited on it. */
  | 'rate_limited'
  /** A queue was full and refused the message. */
  | 'queue_full'
  /** A queued message waited past the level's processing deadline. */
  | 'deadline_missed';

export interface FailureCause {
  nodeId: string;
  reason: FailureReason;
  requests: number;
  /** When this cause had failed its first whole request. */
  firstAtSec: number;
  /** The last tick in which this cause failed a noticeable number of requests. */
  lastAtSec: number;
}

export interface SimEvent {
  atSec: number;
  kind:
    | 'instanceFailed'
    | 'removedFromRotation'
    | 'restoredToRotation'
    /** Read replicas fell behind the primary by more than `REPLICATION.alertLagSec`. */
    | 'replicationLagHigh'
    | 'replicationLagRecovered'
    /** A cache node restarted (a scripted event). Empty afterwards unless replicated. */
    | 'cacheRestarted'
    /** One value of a shard key started, or stopped, taking a share of all data operations (a scripted event). */
    | 'hotKeyStarted'
    | 'hotKeyEnded'
    /** A queue filled up and started refusing messages. */
    | 'queueFull';
  /** The node concerned. Empty for events that concern the whole data set (hot keys). */
  nodeId: string;
  /** The instance concerned, for crashes and rotation changes. */
  instance?: number;
  /** The load balancer that changed its rotation, for rotation events. */
  balancerId?: string;
  /** The shard key whose value turned hot, for hot key events. */
  shardKey?: string;
  /** What turned hot, as the level words it ("a celebrity's post"), for hot key events. */
  label?: string;
  message: string;
}

export interface InstanceFrame {
  up: boolean;
  /** Arrival rate divided by capacity. Above 1 means overloaded. */
  utilization: number;
  queued: number;
}

export interface NodeFrame {
  arrivalRps: number;
  /** Requests that failed at this node during the second, by any reason. */
  failedRps: number;
  /** App-server instances, or the machines of a cache, database or replica group. Empty for load balancers. */
  instances: InstanceFrame[];
  /** Instances a load balancer currently routes to. */
  inRotation?: number;
  /** Databases: reads per second arriving. Read replicas: reads they serve. */
  readRps?: number;
  /** Databases: writes per second arriving. Read replicas: writes they replay. */
  writeRps?: number;
  /** Caches: share of lookups served from memory. */
  hitRate?: number;
  /** Caches: share of lookups that waited for a fetch already in flight (request coalescing). */
  coalescedRate?: number;
  /** Caches and read replicas: reads per second they served that were stale. */
  staleRps?: number;
  /** Read replicas: how far behind the primary they are, in seconds. */
  replicationLagSec?: number;
  /** Sharded databases: each shard's share of the reads and writes (instances are the shards, in the same order). */
  shardShares?: number[];
  /** Queues: messages waiting, the most they hold, and how long the oldest has waited. */
  queueDepth?: number;
  maxQueueDepth?: number;
  oldestWaitSec?: number;
  /** Queues: the level's deadline to charge an order (`requirements.processWithinSec`), if it has one. */
  deadlineSec?: number;
  /** Queues: messages per second the workers charged, and the most they could if the provider allowed. */
  drainRps?: number;
  workerRps?: number;
  /** Payment providers: calls per second accepted, and the limit. */
  acceptedRps?: number;
  rateLimitRps?: number;
}

/** Traffic along one connection. */
export interface EdgeFrame {
  rps: number;
  /** The part of `rps` that is writes (to a database, or replicated to replicas). */
  writeRps: number;
}

/** One second of the run, for playback and charts. */
export interface TimelineFrame {
  /** The start of the second. */
  atSec: number;
  offeredRps: number;
  failedRps: number;
  p99Ms: number | null;
  nodes: Record<string, NodeFrame>;
  /** Keyed by `edgeKey`. Every edge of the design. */
  edges: Record<string, EdgeFrame>;
}

export interface SimulationResult {
  totalRequests: number;
  failedRequests: number;
  availability: number;
  /** Latency of successful requests. Null if none succeeded. */
  latency: { p50Ms: number | null; p99Ms: number | null };
  /**
   * The root cause first: the cause that failed the most requests up to the end of the second in which the error
   * budget ran out (over the whole run if it never did). It's the cause that spent the budget, whatever order the
   * causes started in. The rest follow in order of onset. Causes that failed less than one request are left out.
   */
  causes: FailureCause[];
  /**
   * The second in which cumulative failures exceeded the error budget for a pass (0.1% of all requests in the run),
   * or null if they never did.
   */
  errorBudgetExhaustedAtSec: number | null;
  events: SimEvent[];
  timeline: TimelineFrame[];
  /** Run-wide numbers for caches and replicas. Empty in levels without a data tier. */
  dataTier: DataTierSummary;
  /** Run-wide numbers for queues. Empty in levels without payments. */
  payments: PaymentSummary;
}

/** Runs a validated design against a level. Deterministic: the same inputs always give the same result. */
export function simulate(level: Level, design: Design): SimulationResult {
  return new Simulation(level, design).run();
}

// ---------------------------------------------------------------------------

/** An app-server instance is a queueing station with one worker per vCPU. */
type InstanceState = StationState;
type InstanceTick = StationTick;

interface Target {
  nodeId: string;
  index: number;
  inRotation: boolean;
  failStreak: number;
  okStreak: number;
}

interface BalancerTick {
  arrivalRps: number;
  rotation: readonly Target[];
  dropFraction: number;
}

interface CauseTally {
  nodeId: string;
  reason: FailureReason;
  requests: number;
  firstAtSec: number | null;
  lastAtSec: number;
  /** Failures in each second of the run, to find the cause that spent the error budget. */
  bySecond: number[];
}

/** A tick's failures below this many requests don't move a cause's lastAtSec. */
const NOTICEABLE_FAILURES_PER_TICK = 0.01;

class Simulation {
  private readonly level: Level;
  private readonly graph: Graph;
  private readonly rng: Rng;
  private readonly serviceMeanSec: number;
  private readonly timeoutSec: number;
  private readonly events: readonly ScenarioEvent[];
  private nextEvent = 0;

  private readonly instances = new Map<string, InstanceState[]>();
  private readonly targets = new Map<string, Target[]>();
  private readonly instanceTicks = new Map<string, InstanceTick[]>();
  private readonly balancerTicks = new Map<string, BalancerTick>();
  private readonly data: DataTier | null;
  private readonly payments: PaymentTier | null;
  /** This tick's traffic on each edge, keyed by `edgeKey`. */
  private readonly edgeFlows = new Map<string, EdgeFrame>();

  /** The second of the run the current tick is in. */
  private second = 0;
  private totalRequests = 0;
  private failedRequests = 0;
  private readonly tallies = new Map<string, CauseTally>();
  private readonly log: SimEvent[] = [];
  private readonly samples = new WeightedSamples();

  private readonly timeline: TimelineFrame[] = [];
  private readonly secondSamples = new WeightedSamples();
  private secondOffered = 0;
  private secondFailed = 0;
  private readonly secondFailedByNode = new Map<string, number>();

  constructor(level: Level, design: Design) {
    this.level = level;
    this.graph = buildGraph(design);
    this.rng = createRng(level.seed);
    this.serviceMeanSec = level.workload.cpuMsPerRequest / 1000;
    this.timeoutSec = level.workload.timeoutMs / 1000;
    this.events = [...level.events].sort((a, b) => a.atSec - b.atSec);

    for (const node of this.graph.nodes.values()) {
      if (node.kind === 'appServer') {
        this.instances.set(
          node.id,
          Array.from({ length: node.instances }, newStation),
        );
      }
    }
    for (const node of this.graph.nodes.values()) {
      if (node.kind === 'loadBalancer') {
        this.targets.set(
          node.id,
          this.graph.children.get(node.id)!.flatMap((childId) =>
            this.instances.get(childId)!.map((_, index) => ({
              nodeId: childId,
              index,
              inRotation: true,
              failStreak: 0,
              okStreak: 0,
            })),
          ),
        );
      }
    }
    const data = level.workload.data;
    this.data = data
      ? new DataTier(level, data, this.graph, {
          fail: (nodeId, reason, requests, atSec) => this.fail(nodeId, reason, requests, atSec),
          log: (event) => this.log.push(event),
        })
      : null;
    const payments = level.workload.payments;
    this.payments = payments
      ? new PaymentTier(level, payments, this.graph, {
          fail: (nodeId, reason, requests, atSec) => this.fail(nodeId, reason, requests, atSec),
          log: (event) => this.log.push(event),
        })
      : null;
    for (const edge of design.edges) this.edgeFlows.set(edgeKey(edge), { rps: 0, writeRps: 0 });
  }

  run(): SimulationResult {
    const totalTicks = Math.round(this.level.durationSec / TICK_SEC);
    const ticksPerSecond = Math.round(1 / TICK_SEC);
    for (let tick = 0; tick < totalTicks; tick++) {
      this.second = Math.floor(tick / ticksPerSecond);
      this.step(tick);
      if ((tick + 1) % ticksPerSecond === 0 || tick === totalTicks - 1) {
        this.recordSecond(Math.floor(tick / ticksPerSecond));
      }
    }
    if (this.payments) {
      // Whatever is still queued is judged by when it would be charged; it belongs to the run's last second.
      const before = this.failedRequests;
      this.payments.finish(this.level.durationSec);
      const last = this.timeline[this.timeline.length - 1];
      if (last) {
        last.failedRps += this.failedRequests - before;
        for (const [nodeId, failed] of this.secondFailedByNode) {
          const node = last.nodes[nodeId];
          if (node) node.failedRps += failed;
        }
        this.secondFailedByNode.clear();
        this.secondFailed = 0;
      }
    }

    const errorBudgetExhaustedAtSec = this.errorBudgetExhaustedAt();
    const causes = rankCauses(
      [...this.tallies.values()].filter((tally): tally is CauseTally & { firstAtSec: number } => tally.firstAtSec !== null),
      errorBudgetExhaustedAtSec,
    );

    const availability =
      this.totalRequests > 0 ? Math.min(1, Math.max(0, 1 - this.failedRequests / this.totalRequests)) : 1;

    return {
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests,
      availability,
      latency: { p50Ms: this.samples.quantile(0.5), p99Ms: this.samples.quantile(0.99) },
      causes,
      errorBudgetExhaustedAtSec,
      events: this.log,
      timeline: this.timeline,
      dataTier: this.data?.summary() ?? { cacheHitRate: {}, peakReplicationLagSec: {} },
      payments: this.payments?.summary() ?? { peakQueueDepth: {}, peakQueueWaitSec: {} },
    };
  }

  private step(tick: number): void {
    const atSec = round(tick * TICK_SEC);
    this.applyEvents(tick, atSec);
    this.runHealthChecks(tick, atSec);

    const offeredRps = interpolate(this.level.workload.traffic, atSec + TICK_SEC / 2);
    const requests = offeredRps * TICK_SEC;
    this.totalRequests += requests;
    this.secondOffered += requests;

    this.flow(offeredRps, atSec);

    if (requests > 0) {
      const weight = requests / PROBES_PER_TICK;
      for (let i = 0; i < PROBES_PER_TICK; i++) {
        const latencyMs = this.probe();
        if (latencyMs !== null) {
          this.samples.add(latencyMs, weight);
          this.secondSamples.add(latencyMs, weight);
        }
      }
    }
  }

  // --- Scenario events and health checks ------------------------------------

  private applyEvents(tick: number, atSec: number): void {
    while (this.nextEvent < this.events.length && Math.round(this.events[this.nextEvent]!.atSec / TICK_SEC) <= tick) {
      const event = this.events[this.nextEvent++]!;
      switch (event.kind) {
        case 'instanceFailure':
          this.crashBusiestInstance(atSec);
          break;
        case 'cacheRestart':
          this.data?.restartBusiestCache(atSec);
          break;
        case 'hotKey':
          this.data?.startHotKey(event, atSec);
          break;
      }
    }
  }

  private crashBusiestInstance(atSec: number): void {
    let busiest: { nodeId: string; index: number; state: InstanceState } | null = null;
    for (const [nodeId, states] of this.instances) {
      for (const [index, state] of states.entries()) {
        if (state.up && (busiest === null || state.arrivalRps > busiest.state.arrivalRps)) {
          busiest = { nodeId, index, state };
        }
      }
    }
    if (busiest === null) return;
    const { nodeId, index, state } = busiest;
    state.up = false;
    // Requests queued on the instance die with it.
    this.fail(nodeId, 'instance_down', state.backlog, atSec);
    state.backlog = 0;
    this.log.push({
      atSec,
      kind: 'instanceFailed',
      nodeId,
      instance: index,
      message: `${describeInstance(this.graph, nodeId, index)} crashed.`,
    });
  }

  private runHealthChecks(tick: number, atSec: number): void {
    if (tick === 0) return;
    for (const [balancerId, targets] of this.targets) {
      const spec = this.graph.nodes.get(balancerId) as LoadBalancerSpec;
      if (tick % Math.round(spec.healthCheckIntervalSec / TICK_SEC) !== 0) continue;
      for (const target of targets) {
        const name = describeInstance(this.graph, target.nodeId, target.index);
        if (this.isUp(target)) {
          target.failStreak = 0;
          target.okStreak++;
          if (!target.inRotation && target.okStreak >= HEALTH_CHECK.healthyThreshold) {
            target.inRotation = true;
            this.logRotation('restoredToRotation', target, balancerId, atSec, `${balancerId} restored ${name} to rotation.`);
          }
        } else {
          target.okStreak = 0;
          target.failStreak++;
          if (target.inRotation && target.failStreak >= HEALTH_CHECK.unhealthyThreshold) {
            target.inRotation = false;
            this.logRotation(
              'removedFromRotation',
              target,
              balancerId,
              atSec,
              `${balancerId} removed ${name} from rotation after ${target.failStreak} failed health checks.`,
            );
          }
        }
      }
    }
  }

  private logRotation(kind: SimEvent['kind'], target: Target, balancerId: string, atSec: number, message: string) {
    this.log.push({ atSec, kind, nodeId: target.nodeId, instance: target.index, balancerId, message });
  }

  // --- Flow ------------------------------------------------------------------

  private flow(offeredRps: number, atSec: number): void {
    for (const edge of this.edgeFlows.values()) {
      edge.rps = 0;
      edge.writeRps = 0;
    }
    this.edgeFlows.get(edgeKey({ from: CLIENTS_ID, to: this.graph.entryId }))!.rps = offeredRps;

    const arrivals = new Map<string, number[]>();
    for (const node of this.graph.nodes.values()) {
      arrivals.set(node.id, new Array(node.kind === 'appServer' ? node.instances : 1).fill(0));
    }
    arrivals.get(this.graph.entryId)![0] = offeredRps;

    // The request tier in topological order. Data-tier nodes are stepped together afterwards, because a cache's
    // misses reach the database without an edge between them.
    const finished = new Map<string, number>();
    for (const id of this.graph.order) {
      const node = this.graph.nodes.get(id)!;
      const incoming = arrivals.get(id)!;
      switch (node.kind) {
        case 'loadBalancer':
          this.balance(node, sum(incoming), arrivals, atSec);
          break;
        case 'appServer':
          finished.set(id, this.serve(node, incoming, atSec));
          break;
        default:
          break;
      }
    }

    for (const tier of [this.data, this.payments]) {
      if (!tier) continue;
      tier.step(finished, atSec);
      for (const [key, flow] of tier.edges()) {
        const edge = this.edgeFlows.get(key);
        if (edge) Object.assign(edge, flow);
      }
    }
  }

  /** Round-robin across instances in rotation, optionally retrying once when an instance refuses the connection. */
  private balance(spec: LoadBalancerSpec, rps: number, arrivals: Map<string, number[]>, atSec: number): void {
    const dropped = Math.max(0, rps - LOAD_BALANCER.maxRps);
    this.fail(spec.id, 'overloaded', dropped * TICK_SEC, atSec);
    const forwarded = rps - dropped;

    const rotation = this.targets.get(spec.id)!.filter((target) => target.inRotation);
    this.balancerTicks.set(spec.id, { arrivalRps: rps, rotation, dropFraction: rps > 0 ? dropped / rps : 0 });
    if (rotation.length === 0) {
      this.fail(spec.id, 'no_healthy_backend', forwarded * TICK_SEC, atSec);
      return;
    }

    const send = (target: Target, share: number) => {
      this.edgeFlows.get(edgeKey({ from: spec.id, to: target.nodeId }))!.rps += share;
      if (this.isUp(target)) arrivals.get(target.nodeId)![target.index]! += share;
      else this.fail(target.nodeId, 'instance_down', share * TICK_SEC, atSec);
    };

    const share = forwarded / rotation.length;
    const retry = spec.retryOnConnectFailure && rotation.length > 1;
    for (const target of rotation) {
      if (this.isUp(target) || !retry) {
        send(target, share);
        continue;
      }
      // The retry goes to any other instance in rotation, and is not retried again.
      for (const other of rotation) {
        if (other !== target) send(other, share / (rotation.length - 1));
      }
    }
  }

  /** Steps every instance of an app server. Returns the requests per second it finished (arrivals minus failures). */
  private serve(spec: AppServerSpec, incoming: readonly number[], atSec: number): number {
    const servers = APP_SERVER_SIZES[spec.size].vcpu;
    let finished = 0;
    const ticks = this.instances.get(spec.id)!.map((state, index) => {
      const arrivalRps = incoming[index]!;
      if (!state.up) {
        state.arrivalRps = arrivalRps;
        state.utilization = arrivalRps / (servers / this.serviceMeanSec);
        this.fail(spec.id, 'instance_down', arrivalRps * TICK_SEC, atSec);
        return DOWN_TICK;
      }
      const { tick, failed } = stepStation(state, arrivalRps, servers, this.serviceMeanSec, this.timeoutSec);
      this.fail(spec.id, 'timeout', failed, atSec);
      finished += arrivalRps - failed / TICK_SEC;
      return tick;
    });
    this.instanceTicks.set(spec.id, ticks);
    return Math.max(0, finished);
  }

  // --- Probes ----------------------------------------------------------------

  /** Walks one sampled request through the design. Returns its latency, or null if it failed. */
  private probe(): number | null {
    let latencyMs = HOP_LATENCY_MS;
    let nodeId = this.graph.entryId;
    let index = 0;
    for (;;) {
      const node = this.graph.nodes.get(nodeId)!;
      switch (node.kind) {
        case 'loadBalancer': {
          latencyMs += LOAD_BALANCER.latencyMs;
          const { rotation, dropFraction } = this.balancerTicks.get(nodeId)!;
          if (rotation.length === 0 || this.rng() < dropFraction) return null;
          let target = pick(this.rng, rotation);
          if (!this.isUp(target)) {
            latencyMs += CONNECT_FAIL_MS;
            if (!node.retryOnConnectFailure || rotation.length < 2) return null;
            target = pick(this.rng, rotation.filter((other) => other !== target));
            if (!this.isUp(target)) return null;
          }
          latencyMs += HOP_LATENCY_MS;
          nodeId = target.nodeId;
          index = target.index;
          break;
        }
        case 'appServer': {
          const tick = this.instanceTicks.get(nodeId)![index]!;
          const waitSec = probeWait(tick, this.rng, this.timeoutSec);
          if (waitSec === null) return null;
          const serviceSec = sampleExponential(this.rng, 1 / this.serviceMeanSec);
          latencyMs += (waitSec + serviceSec) * 1000;
          for (const tier of [this.data, this.payments]) {
            if (!tier?.serves(nodeId)) continue;
            const tierMs = tier.probe(nodeId, this.rng);
            if (tierMs === null) return null;
            latencyMs += tierMs;
          }
          return latencyMs;
        }
        default:
          // Data-tier nodes are reached through the app server's data operation above.
          return null;
      }
    }
  }

  // --- Bookkeeping -----------------------------------------------------------

  private isUp(target: { nodeId: string; index: number }): boolean {
    return this.instances.get(target.nodeId)![target.index]!.up;
  }

  private fail(nodeId: string, reason: FailureReason, requests: number, atSec: number): void {
    if (!(requests > 0)) return;
    this.failedRequests += requests;
    this.secondFailed += requests;
    this.secondFailedByNode.set(nodeId, (this.secondFailedByNode.get(nodeId) ?? 0) + requests);
    const key = `${nodeId}\u0000${reason}`;
    let tally = this.tallies.get(key);
    if (tally === undefined) {
      tally = { nodeId, reason, requests: 0, firstAtSec: null, lastAtSec: atSec, bySecond: [] };
      this.tallies.set(key, tally);
    }
    tally.requests += requests;
    tally.bySecond[this.second] = (tally.bySecond[this.second] ?? 0) + requests;
    if (tally.firstAtSec === null && tally.requests >= 1) tally.firstAtSec = atSec;
    if (requests >= NOTICEABLE_FAILURES_PER_TICK) tally.lastAtSec = atSec;
  }

  private errorBudgetExhaustedAt(): number | null {
    const budget = (1 - AVAILABILITY_TIERS.pass) * this.totalRequests;
    let failed = 0;
    for (const frame of this.timeline) {
      failed += frame.failedRps;
      if (failed > budget) return frame.atSec;
    }
    return null;
  }

  private recordSecond(second: number): void {
    const nodes: Record<string, NodeFrame> = {};
    for (const node of this.graph.nodes.values()) {
      switch (node.kind) {
        case 'appServer': {
          const states = this.instances.get(node.id)!;
          nodes[node.id] = {
            arrivalRps: sum(states.map((state) => state.arrivalRps)),
            failedRps: this.secondFailedByNode.get(node.id) ?? 0,
            instances: states.map((state) => ({
              up: state.up,
              utilization: state.utilization,
              queued: state.backlog,
            })),
          };
          break;
        }
        case 'loadBalancer': {
          nodes[node.id] = {
            arrivalRps: this.balancerTicks.get(node.id)?.arrivalRps ?? 0,
            failedRps: this.secondFailedByNode.get(node.id) ?? 0,
            instances: [],
            inRotation: this.targets.get(node.id)!.filter((target) => target.inRotation).length,
          };
          break;
        }
        default: {
          const frame = this.data?.frame(node.id) ?? this.payments?.frame(node.id);
          if (frame) nodes[node.id] = { ...frame, failedRps: this.secondFailedByNode.get(node.id) ?? 0 };
          break;
        }
      }
    }
    const edges: Record<string, EdgeFrame> = {};
    for (const [key, flow] of this.edgeFlows) edges[key] = { ...flow };
    this.timeline.push({
      atSec: second,
      offeredRps: this.secondOffered,
      failedRps: this.secondFailed,
      p99Ms: this.secondSamples.quantile(0.99),
      nodes,
      edges,
    });
    this.secondOffered = 0;
    this.secondFailed = 0;
    this.secondFailedByNode.clear();
    this.secondSamples.clear();
  }
}

/**
 * Puts the cause that spent the error budget first, then the rest in order of onset.
 *
 * Order of onset alone misleads: a trickle of stale reads from a replica nearing full load starts before the
 * overload that then exhausts the budget, but the overload is what the player has to fix. So the root cause is the
 * one that failed the most requests by the end of the second the budget ran out (by the end of the run if it never
 * did), with the earlier onset winning a tie.
 */
function rankCauses(tallies: readonly (CauseTally & { firstAtSec: number })[], exhaustedAtSec: number | null): FailureCause[] {
  const spent = (tally: CauseTally) => {
    if (exhaustedAtSec === null) return tally.requests;
    let total = 0;
    for (let second = 0; second <= exhaustedAtSec; second++) total += tally.bySecond[second] ?? 0;
    return total;
  };
  const causes = tallies
    .map((tally) => ({ tally, spent: spent(tally) }))
    .sort((a, b) => a.tally.firstAtSec - b.tally.firstAtSec || b.tally.requests - a.tally.requests);
  const root = causes.reduce<(typeof causes)[number] | undefined>(
    (best, cause) => (best === undefined || cause.spent > best.spent ? cause : best),
    undefined,
  );
  const ordered = root === undefined ? causes : [root, ...causes.filter((cause) => cause !== root)];
  return ordered.map(({ tally: { nodeId, reason, requests, firstAtSec, lastAtSec } }) => ({
    nodeId,
    reason,
    requests,
    firstAtSec,
    lastAtSec,
  }));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function describeInstance(graph: Graph, nodeId: string, index: number): string {
  const node = graph.nodes.get(nodeId);
  return node?.kind === 'appServer' && node.instances > 1 ? `${nodeId} instance ${index + 1}` : nodeId;
}
