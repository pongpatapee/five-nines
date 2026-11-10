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
 */
import {
  APP_SERVER_SIZES,
  CONNECT_FAIL_MS,
  HEALTH_CHECK,
  HOP_LATENCY_MS,
  LOAD_BALANCER,
  PROBES_PER_TICK,
  TICK_SEC,
} from './catalog.ts';
import { buildGraph, type Graph } from './graph.ts';
import { createRng, erlangC, interpolate, pick, sampleExponential, WeightedSamples, type Rng } from './math.ts';
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
  | 'no_healthy_backend';

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
  kind: 'instanceFailed' | 'removedFromRotation' | 'restoredToRotation';
  nodeId: string;
  instance: number;
  /** The load balancer that changed its rotation, for rotation events. */
  balancerId?: string;
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
  /** App-server instances. Empty for load balancers. */
  instances: InstanceFrame[];
  /** Instances a load balancer currently routes to. */
  inRotation?: number;
}

/** One second of the run, for playback and charts. */
export interface TimelineFrame {
  /** The start of the second. */
  atSec: number;
  offeredRps: number;
  failedRps: number;
  p99Ms: number | null;
  nodes: Record<string, NodeFrame>;
}

export interface SimulationResult {
  totalRequests: number;
  failedRequests: number;
  availability: number;
  /** Latency of successful requests. Null if none succeeded. */
  latency: { p50Ms: number | null; p99Ms: number | null };
  /** Ordered by when each cause began. Causes that failed less than one request are left out. */
  causes: FailureCause[];
  events: SimEvent[];
  timeline: TimelineFrame[];
}

/** Runs a validated design against a level. Deterministic: the same inputs always give the same result. */
export function simulate(level: Level, design: Design): SimulationResult {
  return new Simulation(level, design).run();
}

// ---------------------------------------------------------------------------

interface InstanceState {
  up: boolean;
  /** Requests waiting for a free vCPU. */
  backlog: number;
  arrivalRps: number;
  utilization: number;
}

/**
 * What a request arriving at an instance this tick experiences.
 * Flow accounting and probes both read it, so they agree on who fails.
 */
interface InstanceTick {
  up: boolean;
  /** Share of arrivals rejected because the backlog can't be cleared before the timeout. */
  overflowFraction: number;
  /** Wait behind the backlog left over from earlier ticks. */
  backlogWaitSec: number;
  /** Erlang C: chance of waiting for a free vCPU at all. */
  waitProbability: number;
  /** μ − λ: the rate of the exponential queueing delay for those who wait. */
  drainRate: number;
}

const DOWN_TICK: InstanceTick = {
  up: false,
  overflowFraction: 1,
  backlogWaitSec: 0,
  waitProbability: 0,
  drainRate: 0,
};

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
          Array.from({ length: node.instances }, () => ({ up: true, backlog: 0, arrivalRps: 0, utilization: 0 })),
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
  }

  run(): SimulationResult {
    const totalTicks = Math.round(this.level.durationSec / TICK_SEC);
    const ticksPerSecond = Math.round(1 / TICK_SEC);
    for (let tick = 0; tick < totalTicks; tick++) {
      this.step(tick);
      if ((tick + 1) % ticksPerSecond === 0 || tick === totalTicks - 1) {
        this.recordSecond(Math.floor(tick / ticksPerSecond));
      }
    }

    const causes: FailureCause[] = [...this.tallies.values()]
      .filter((tally): tally is CauseTally & { firstAtSec: number } => tally.firstAtSec !== null)
      .map(({ nodeId, reason, requests, firstAtSec, lastAtSec }) => ({
        nodeId,
        reason,
        requests,
        firstAtSec,
        lastAtSec,
      }))
      .sort((a, b) => a.firstAtSec - b.firstAtSec || b.requests - a.requests);

    const availability =
      this.totalRequests > 0 ? Math.min(1, Math.max(0, 1 - this.failedRequests / this.totalRequests)) : 1;

    return {
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests,
      availability,
      latency: { p50Ms: this.samples.quantile(0.5), p99Ms: this.samples.quantile(0.99) },
      causes,
      events: this.log,
      timeline: this.timeline,
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
    const arrivals = new Map<string, number[]>();
    for (const node of this.graph.nodes.values()) {
      arrivals.set(node.id, new Array(node.kind === 'appServer' ? node.instances : 1).fill(0));
    }
    arrivals.get(this.graph.entryId)![0] = offeredRps;

    for (const id of this.graph.order) {
      const node = this.graph.nodes.get(id)!;
      const incoming = arrivals.get(id)!;
      switch (node.kind) {
        case 'loadBalancer':
          this.balance(node, sum(incoming), arrivals, atSec);
          break;
        case 'appServer':
          this.serve(node, incoming, atSec);
          break;
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

  private serve(spec: AppServerSpec, incoming: readonly number[], atSec: number): void {
    const servers = APP_SERVER_SIZES[spec.size].vcpu;
    const capacityRps = servers / this.serviceMeanSec;
    const ticks = this.instances.get(spec.id)!.map((state, index) => {
      const arrivalRps = incoming[index]!;
      state.arrivalRps = arrivalRps;
      state.utilization = arrivalRps / capacityRps;
      if (!state.up) {
        this.fail(spec.id, 'instance_down', arrivalRps * TICK_SEC, atSec);
        return DOWN_TICK;
      }

      // Fluid backlog: what can't be served this tick waits. Anything that couldn't be served before the
      // timeout is rejected now, attributed to this tick's arrivals.
      const arriving = arrivalRps * TICK_SEC;
      let backlog = state.backlog + arriving;
      backlog -= Math.min(backlog, capacityRps * TICK_SEC);
      const overflow = Math.max(0, backlog - capacityRps * this.timeoutSec);
      backlog -= overflow;
      state.backlog = backlog;

      // Random queueing on top of the backlog, from the M/M/c model. Only defined below capacity.
      const backlogWaitSec = backlog / capacityRps;
      let waitProbability = 0;
      let drainRate = 0;
      if (arrivalRps > 0 && arrivalRps < capacityRps) {
        waitProbability = erlangC(servers, arrivalRps * this.serviceMeanSec);
        drainRate = capacityRps - arrivalRps;
      }
      const lateProbability =
        waitProbability * Math.exp(-drainRate * Math.max(0, this.timeoutSec - backlogWaitSec));

      this.fail(spec.id, 'timeout', overflow + (arriving - overflow) * lateProbability, atSec);
      return {
        up: true,
        overflowFraction: arriving > 0 ? overflow / arriving : 0,
        backlogWaitSec,
        waitProbability,
        drainRate,
      };
    });
    this.instanceTicks.set(spec.id, ticks);
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
          if (!tick.up || this.rng() < tick.overflowFraction) return null;
          let waitSec = tick.backlogWaitSec;
          if (this.rng() < tick.waitProbability) waitSec += sampleExponential(this.rng, tick.drainRate);
          if (waitSec > this.timeoutSec) return null;
          const serviceSec = sampleExponential(this.rng, 1 / this.serviceMeanSec);
          return latencyMs + (waitSec + serviceSec) * 1000;
        }
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
      tally = { nodeId, reason, requests: 0, firstAtSec: null, lastAtSec: atSec };
      this.tallies.set(key, tally);
    }
    tally.requests += requests;
    if (tally.firstAtSec === null && tally.requests >= 1) tally.firstAtSec = atSec;
    if (requests >= NOTICEABLE_FAILURES_PER_TICK) tally.lastAtSec = atSec;
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
      }
    }
    this.timeline.push({
      atSec: second,
      offeredRps: this.secondOffered,
      failedRps: this.secondFailed,
      p99Ms: this.secondSamples.quantile(0.99),
      nodes,
    });
    this.secondOffered = 0;
    this.secondFailed = 0;
    this.secondFailedByNode.clear();
    this.secondSamples.clear();
  }
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
