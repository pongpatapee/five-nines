/**
 * Payments: every request an app server finishes also charges a payment at the level's external provider
 * (`workload.payments`). An app server either calls the provider itself, while the customer waits, or puts the order
 * on a queue and answers at once.
 *
 * - The provider has a hard rate limit. Calls beyond it are refused: a customer waiting on a direct call gets an
 *   error (`rate_limited`); a worker just puts the message back and tries again later.
 * - A queue holds up to its size in messages. When it is full, new orders are refused (`queue_full`).
 * - Its workers take messages off in arrival order, each keeping `QUEUE.workerConcurrency` charges in flight, so a
 *   worker drains concurrency ÷ provider latency messages a second, and the queue at most what the provider allows.
 * - An order must be charged within the level's deadline (`requirements.processWithinSec`) of being accepted.
 *   Messages that wait longer expire (`deadline_missed`). Messages still queued when the run ends are judged by when
 *   the workers would get to them at the rate they were draining.
 *
 * The queue is a fluid FIFO: a list of chunks, one per tick, each with the time it arrived.
 */
import { HOP_LATENCY_MS, QUEUE, QUEUE_SIZES, TICK_SEC } from './catalog.ts';
import type { Graph } from './graph.ts';
import type { Rng } from './math.ts';
import type { Level, PaymentProviderSpec, PaymentWorkload, QueueSpec } from './schema.ts';
import type { EdgeFrame, FailureReason, NodeFrame, SimEvent } from './simulate.ts';

export interface PaymentTierSink {
  fail(nodeId: string, reason: FailureReason, requests: number, atSec: number): void;
  log(event: SimEvent): void;
}

interface Chunk {
  atSec: number;
  messages: number;
}

interface QueueNode {
  spec: QueueSpec;
  provider: ProviderNode;
  maxDepth: number;
  /** Messages a second the workers could charge if the provider let them. */
  workerRps: number;
  chunks: Chunk[];
  /** Index of the oldest chunk still queued. */
  head: number;
  depth: number;
  enqueueRps: number;
  /** Charges the workers tried this tick, and those the provider accepted, per second. */
  attemptRps: number;
  drainRps: number;
  /** Share of this tick's arrivals refused because the queue was full. */
  refusedShare: number;
  expiredRps: number;
  full: boolean;
  peakDepth: number;
  peakWaitSec: number;
}

interface ProviderNode {
  spec: PaymentProviderSpec;
  /** Direct calls from app servers this tick, per second. */
  directRps: number;
  /** Share of all calls the provider accepted this tick. */
  acceptedShare: number;
  acceptedRps: number;
  offeredRps: number;
}

type Route = { appId: string; queue: QueueNode; provider: null } | { appId: string; queue: null; provider: ProviderNode };

export interface PaymentSummary {
  /** Per queue: the most messages it held at once. */
  peakQueueDepth: Record<string, number>;
  /** Per queue: the longest any message waited before it was charged or expired, seconds. */
  peakQueueWaitSec: Record<string, number>;
}

export class PaymentTier {
  private readonly payments: PaymentWorkload;
  private readonly deadlineSec: number;
  private readonly sink: PaymentTierSink;
  private readonly providers = new Map<string, ProviderNode>();
  private readonly queues = new Map<string, QueueNode>();
  private readonly routes = new Map<string, Route>();
  private readonly edgeFlows = new Map<string, EdgeFrame>();
  /** The end of the tick last stepped. */
  private nowSec = 0;

  constructor(level: Level, payments: PaymentWorkload, graph: Graph, sink: PaymentTierSink) {
    this.payments = payments;
    this.deadlineSec = level.requirements.processWithinSec ?? Infinity;
    this.sink = sink;

    for (const node of graph.nodes.values()) {
      if (node.kind === 'paymentProvider') {
        this.providers.set(node.id, { spec: node, directRps: 0, acceptedShare: 1, acceptedRps: 0, offeredRps: 0 });
      }
    }
    const providerOf = (id: string) =>
      graph.children.get(id)!.map((child) => this.providers.get(child)).find((p) => p !== undefined) ?? null;
    for (const node of graph.nodes.values()) {
      if (node.kind !== 'queue') continue;
      // Validation guarantees every queue sends to a provider.
      const provider = providerOf(node.id);
      if (!provider) continue;
      this.queues.set(node.id, {
        spec: node,
        provider,
        maxDepth: QUEUE_SIZES[node.size].maxDepth,
        workerRps: node.workers * workerThroughput(payments),
        chunks: [],
        head: 0,
        depth: 0,
        enqueueRps: 0,
        attemptRps: 0,
        drainRps: 0,
        refusedShare: 0,
        expiredRps: 0,
        full: false,
        peakDepth: 0,
        peakWaitSec: 0,
      });
    }
    for (const node of graph.nodes.values()) {
      if (node.kind !== 'appServer') continue;
      const queue = graph.children.get(node.id)!.map((child) => this.queues.get(child)).find((q) => q !== undefined);
      if (queue) {
        this.routes.set(node.id, { appId: node.id, queue, provider: null });
        continue;
      }
      const provider = providerOf(node.id);
      if (provider) this.routes.set(node.id, { appId: node.id, queue: null, provider });
    }
  }

  /** Whether requests finishing on this app server go on to charge a payment. */
  serves(appId: string): boolean {
    return this.routes.has(appId);
  }

  /** Pushes this tick's orders through. `outflows` is the requests each app server finished. */
  step(outflows: ReadonlyMap<string, number>, atSec: number): void {
    this.edgeFlows.clear();
    for (const provider of this.providers.values()) provider.directRps = 0;
    for (const queue of this.queues.values()) queue.enqueueRps = 0;
    for (const route of this.routes.values()) {
      const rps = outflows.get(route.appId) ?? 0;
      if (route.queue) {
        route.queue.enqueueRps += rps;
        this.addEdge(route.appId, route.queue.spec.id, rps);
      } else {
        route.provider.directRps += rps;
        this.addEdge(route.appId, route.provider.spec.id, rps);
      }
    }

    // 1. Orders join their queue, unless it's full.
    const endSec = atSec + TICK_SEC;
    this.nowSec = endSec;
    for (const [id, queue] of this.queues) {
      const arriving = queue.enqueueRps * TICK_SEC;
      const accepted = Math.min(arriving, Math.max(0, queue.maxDepth - queue.depth));
      const refused = arriving - accepted;
      queue.refusedShare = arriving > 0 ? refused / arriving : 0;
      this.sink.fail(id, 'queue_full', refused, atSec);
      if (accepted > 0) {
        queue.chunks.push({ atSec: atSec + TICK_SEC / 2, messages: accepted });
        queue.depth += accepted;
      }
      if (!queue.full && refused >= 1) {
        queue.full = true;
        this.sink.log({ atSec, kind: 'queueFull', nodeId: id, message: `${id} is full: ${formatCount(queue.maxDepth)} messages waiting, new orders refused.` });
      } else if (queue.full && queue.depth < queue.maxDepth * 0.9) {
        queue.full = false;
      }
      queue.attemptRps = Math.min(queue.workerRps, queue.depth / TICK_SEC);
    }

    // 2. The provider accepts calls up to its limit, the same share of each caller's.
    for (const provider of this.providers.values()) {
      let offered = provider.directRps;
      for (const queue of this.queues.values()) if (queue.provider === provider) offered += queue.attemptRps;
      provider.offeredRps = offered;
      provider.acceptedShare = offered > this.payments.rateLimitRps ? this.payments.rateLimitRps / offered : 1;
      provider.acceptedRps = offered * provider.acceptedShare;
      this.sink.fail(provider.spec.id, 'rate_limited', provider.directRps * (1 - provider.acceptedShare) * TICK_SEC, atSec);
    }

    // 3. Workers charge from the head of each queue; then whatever has waited past the deadline expires.
    for (const [id, queue] of this.queues) {
      queue.drainRps = queue.attemptRps * queue.provider.acceptedShare;
      this.addEdge(id, queue.provider.spec.id, queue.drainRps);
      let toDrain = queue.drainRps * TICK_SEC;
      while (toDrain > 0 && queue.head < queue.chunks.length) {
        const chunk = queue.chunks[queue.head]!;
        const taken = Math.min(chunk.messages, toDrain);
        chunk.messages -= taken;
        toDrain -= taken;
        queue.depth -= taken;
        if (taken > 0) queue.peakWaitSec = Math.max(queue.peakWaitSec, Math.min(endSec - chunk.atSec, this.deadlineSec));
        if (chunk.messages <= 1e-9) queue.head++;
      }
      let expired = 0;
      while (queue.head < queue.chunks.length && endSec - queue.chunks[queue.head]!.atSec > this.deadlineSec) {
        expired += queue.chunks[queue.head]!.messages;
        queue.head++;
      }
      if (expired > 0) {
        queue.peakWaitSec = Math.max(queue.peakWaitSec, this.deadlineSec);
        queue.depth = Math.max(0, queue.depth - expired);
        this.sink.fail(id, 'deadline_missed', expired, atSec);
      }
      queue.expiredRps = expired / TICK_SEC;
      if (queue.depth <= 1e-9) queue.depth = 0;
      queue.peakDepth = Math.max(queue.peakDepth, queue.depth);
      compact(queue);
    }
  }

  /**
   * At the end of the run: messages still queued are judged by when the workers would reach them, draining at the
   * rate the queue could manage at the end. Those that would be charged after their deadline fail now.
   */
  finish(endSec: number): void {
    if (!Number.isFinite(this.deadlineSec)) return;
    for (const [id, queue] of this.queues) {
      const rate = this.drainCapacity(queue);
      let ahead = 0;
      let late = 0;
      for (let i = queue.head; i < queue.chunks.length; i++) {
        const chunk = queue.chunks[i]!;
        const doneAtSec = rate > 0 ? endSec + (ahead + chunk.messages) / rate : Infinity;
        if (doneAtSec - chunk.atSec > this.deadlineSec) late += chunk.messages;
        ahead += chunk.messages;
      }
      this.sink.fail(id, 'deadline_missed', late, endSec - TICK_SEC);
    }
  }

  /** Walks a sampled request's payment from an app server: the latency it adds in ms, or null if it failed. */
  probe(appId: string, rng: Rng): number | null {
    const route = this.routes.get(appId)!;
    if (route.queue) {
      if (rng() < route.queue.refusedShare) return null;
      return HOP_LATENCY_MS + QUEUE.enqueueMs;
    }
    if (rng() >= route.provider.acceptedShare) return null;
    return HOP_LATENCY_MS + this.payments.latencyMs;
  }

  /** Live stats of a queue or the provider for the timeline, without `failedRps`. */
  frame(nodeId: string): Omit<NodeFrame, 'failedRps'> | null {
    const queue = this.queues.get(nodeId);
    if (queue) {
      const oldest = queue.chunks[queue.head];
      return {
        arrivalRps: queue.enqueueRps,
        instances: [
          {
            up: true,
            utilization: queue.workerRps > 0 ? queue.attemptRps / queue.workerRps : 0,
            queued: queue.depth,
          },
        ],
        queueDepth: queue.depth,
        maxQueueDepth: queue.maxDepth,
        oldestWaitSec: oldest ? Math.max(0, this.nowSec - oldest.atSec) : 0,
        ...(Number.isFinite(this.deadlineSec) ? { deadlineSec: this.deadlineSec } : {}),
        drainRps: queue.drainRps,
        workerRps: queue.workerRps,
      };
    }
    const provider = this.providers.get(nodeId);
    if (provider) {
      return {
        arrivalRps: provider.offeredRps,
        instances: [
          { up: true, utilization: provider.offeredRps / this.payments.rateLimitRps, queued: 0 },
        ],
        acceptedRps: provider.acceptedRps,
        rateLimitRps: this.payments.rateLimitRps,
      };
    }
    return null;
  }

  edges(): ReadonlyMap<string, EdgeFrame> {
    return this.edgeFlows;
  }

  summary(): PaymentSummary {
    const peakQueueDepth: Record<string, number> = {};
    const peakQueueWaitSec: Record<string, number> = {};
    for (const [id, queue] of this.queues) {
      peakQueueDepth[id] = queue.peakDepth;
      peakQueueWaitSec[id] = queue.peakWaitSec;
    }
    return { peakQueueDepth, peakQueueWaitSec };
  }

  // -------------------------------------------------------------------------

  /**
   * How fast a queue can drain with its workers flat out: their throughput, or their share of the provider's limit
   * when everyone calling it (the direct callers as they are now, and every queue's workers flat out) asks for more.
   */
  private drainCapacity(queue: QueueNode): number {
    const provider = queue.provider;
    let demand = provider.directRps;
    for (const other of this.queues.values()) if (other.provider === provider) demand += other.workerRps;
    return demand > this.payments.rateLimitRps ? queue.workerRps * (this.payments.rateLimitRps / demand) : queue.workerRps;
  }

  private addEdge(from: string, to: string, rps: number): void {
    const key = `${from}->${to}`;
    const edge = this.edgeFlows.get(key);
    // Orders change state (a charge): drawn like writes.
    if (edge) {
      edge.rps += rps;
      edge.writeRps += rps;
    } else this.edgeFlows.set(key, { rps, writeRps: rps });
  }
}

/** Charges one worker makes a second: the charges it keeps in flight ÷ how long each takes. */
export function workerThroughput(payments: PaymentWorkload): number {
  return QUEUE.workerConcurrency / (payments.latencyMs / 1000);
}

/** Drops chunks already drained, once they are a good share of the list. */
function compact(queue: QueueNode): void {
  if (queue.head > 256 && queue.head * 2 > queue.chunks.length) {
    queue.chunks = queue.chunks.slice(queue.head);
    queue.head = 0;
  }
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
