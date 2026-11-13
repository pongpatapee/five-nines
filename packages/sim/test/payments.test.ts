/** Payments: a rate-limited provider, called directly or through a queue with workers and a deadline. */
import { describe, expect, it } from 'vitest';
import { QUEUE } from '../src/catalog.ts';
import { designCostUsdPerMonth } from '../src/cost.ts';
import { workerThroughput } from '../src/payments.ts';
import { peakLoad } from '../src/peak-load.ts';
import type { Design, Level } from '../src/schema.ts';
import { simulate } from '../src/simulate.ts';
import { validateDesign } from '../src/validate.ts';
import { makeLevel } from './fixtures.ts';

/** 1,000 orders a second, 10,000 for 30 seconds from t=20; the provider takes 2,500 a second, 300 ms each. */
function saleLevel(processWithinSec = 120, durationSec = 200): Level {
  return makeLevel({
    components: ['appServer', 'loadBalancer', 'queue', 'paymentProvider'],
    durationSec,
    workload: {
      cpuMsPerRequest: 0.1,
      traffic: [
        { atSec: 0, rps: 1_000 },
        { atSec: 19.999, rps: 1_000 },
        { atSec: 20, rps: 10_000 },
        { atSec: 50, rps: 10_000 },
        { atSec: 50.001, rps: 1_000 },
      ],
      payments: { rateLimitRps: 2_500, latencyMs: 300 },
    },
    requirements: { processWithinSec },
  });
}

const direct: Design = {
  nodes: [
    { id: 'app', kind: 'appServer', size: 'xlarge', instances: 1 },
    { id: 'payments', kind: 'paymentProvider' },
  ],
  edges: [
    { from: 'clients', to: 'app' },
    { from: 'app', to: 'payments' },
  ],
};

function queued(workers: number, size: 'small' | 'medium' | 'large' = 'large'): Design {
  return {
    nodes: [
      { id: 'app', kind: 'appServer', size: 'xlarge', instances: 1 },
      { id: 'queue', kind: 'queue', size, workers },
      { id: 'payments', kind: 'paymentProvider' },
    ],
    edges: [
      { from: 'clients', to: 'app' },
      { from: 'app', to: 'queue' },
      { from: 'queue', to: 'payments' },
    ],
  };
}

describe('workers', () => {
  it('charge as many orders a second as they keep in flight ÷ the time a charge takes', () => {
    expect(workerThroughput({ rateLimitRps: 1, latencyMs: 300 })).toBeCloseTo(QUEUE.workerConcurrency / 0.3, 9);
  });

  it('cost per worker on top of the queue', () => {
    expect(designCostUsdPerMonth(queued(10))).toBe(480 + 120 + 10 * QUEUE.workerUsdPerMonth);
  });
});

describe('calling the provider directly', () => {
  it('waits for the charge, and fails what the rate limit refuses', () => {
    const result = simulate(saleLevel(), direct);
    expect(result.latency.p50Ms!).toBeGreaterThan(300);
    expect(result.causes[0]).toMatchObject({ nodeId: 'payments', reason: 'rate_limited' });
    // 7,500 a second refused for 30 seconds.
    expect(result.causes[0]!.requests).toBeCloseTo(7_500 * 30, -3);
    const sale = result.timeline[30]!.nodes['payments']!;
    expect(sale.acceptedRps).toBeCloseTo(2_500, 6);
    expect(sale.rateLimitRps).toBe(2_500);
  });
});

describe('a queue with workers', () => {
  it('accepts at once, then drains at the workers’ rate under the provider’s limit', () => {
    const result = simulate(saleLevel(), queued(22));
    expect(result.latency.p99Ms!).toBeLessThan(20);
    expect(result.availability).toBeGreaterThan(0.99999);
    const frame = result.timeline[40]!.nodes['queue']!;
    expect(frame.drainRps).toBeCloseTo(2_200, 6);
    expect(frame.queueDepth!).toBeGreaterThan(100_000);
    expect(result.timeline[40]!.edges['queue->payments']!.rps).toBeCloseTo(2_200, 6);
    expect(result.timeline[40]!.edges['app->queue']!.rps).toBeCloseTo(10_000, 6);
    // (10,000 − 2,200) × 30 at the end of the sale.
    expect(result.payments.peakQueueDepth['queue']).toBeCloseTo(7_800 * 30, -3);
    expect(result.payments.peakQueueWaitSec['queue']!).toBeCloseTo((7_800 * 30) / 2_200, -1);
  });

  it('never drains faster than the provider allows, however many workers', () => {
    const result = simulate(saleLevel(), queued(40));
    expect(result.timeline[40]!.nodes['queue']!.drainRps).toBeCloseTo(2_500, 6);
    expect(result.timeline[40]!.nodes['payments']!.acceptedRps).toBeCloseTo(2_500, 6);
    // Workers retry what the provider refuses: nothing fails.
    expect(result.causes).toEqual([]);
  });

  it('expires orders that wait past the deadline', () => {
    const result = simulate(saleLevel(), queued(10));
    expect(result.causes[0]).toMatchObject({ nodeId: 'queue', reason: 'deadline_missed' });
    // The first order to miss joined when the backlog ahead was 120 s of work.
    expect(result.causes[0]!.firstAtSec).toBeGreaterThan(120);
    expect(result.timeline[result.timeline.length - 1]!.nodes['queue']!.oldestWaitSec!).toBeLessThanOrEqual(120.1);
  });

  it('judges what is still queued at the end by when the workers would reach it', () => {
    // A run that ends while the sale's backlog is still draining: with 15 workers it can't make the deadline.
    const short = simulate(saleLevel(120, 80), queued(15));
    expect(short.causes.find((cause) => cause.reason === 'deadline_missed')).toMatchObject({ firstAtSec: 79.9 });
    const timelineFailed = short.timeline.reduce((sum, frame) => sum + frame.failedRps, 0);
    expect(timelineFailed).toBeCloseTo(short.failedRequests, 3);
    // With 22 it can.
    expect(simulate(saleLevel(120, 80), queued(22)).causes).toEqual([]);
  });

  it('refuses orders when full', () => {
    const result = simulate(saleLevel(), queued(22, 'medium'));
    const cause = result.causes[0]!;
    expect(cause).toMatchObject({ nodeId: 'queue', reason: 'queue_full' });
    // 100,000 messages hold (10,000 − 2,200) × 12.8 seconds of the sale.
    expect(cause.firstAtSec).toBeGreaterThan(32);
    expect(cause.firstAtSec).toBeLessThan(34);
    expect(result.events.find((event) => event.kind === 'queueFull')).toMatchObject({ nodeId: 'queue' });
  });

  it('works out the backlog and the wait on paper', () => {
    const load = peakLoad(saleLevel(), queued(22));
    const queue = load.nodes['queue']!;
    expect(queue.queue).toMatchObject({ drainRps: 2_200, maxDepth: 1_000_000, deadlineSec: 120 });
    expect(queue.queue!.peakBacklog).toBeCloseTo(7_800 * 30, -3);
    expect(queue.utilization).toBeCloseTo(queue.queue!.maxWaitSec / 120, 9);
    expect(load.nodes['payments']!.utilization).toBeCloseTo(2_200 / 2_500, 6);
    const direct = peakLoad(saleLevel(), { ...queued(22), edges: [{ from: 'clients', to: 'app' }, { from: 'app', to: 'payments' }] });
    expect(direct.nodes['payments']!.utilization).toBeCloseTo(4, 6);
  });
});

describe('payment wiring', () => {
  const codes = (design: Design) => validateDesign(design, saleLevel()).map((issue) => issue.code);

  it('accepts a direct call or a queue', () => {
    expect(codes(direct)).toEqual([]);
    expect(codes(queued(4))).toEqual([]);
  });

  it('needs every order charged, one way, by one provider', () => {
    expect(codes({ nodes: [direct.nodes[0]!], edges: [{ from: 'clients', to: 'app' }] })).toEqual(['needs_payment']);
    const both = queued(4);
    both.edges.push({ from: 'app', to: 'payments' });
    expect(codes(both)).toEqual(['duplicate_data_target']);
    const nowhere = queued(4);
    nowhere.edges.pop();
    expect(codes(nowhere)).toContain('needs_provider');
    const two = queued(4);
    two.nodes.push({ id: 'payments-2', kind: 'paymentProvider' });
    two.edges.push({ from: 'queue', to: 'payments-2' });
    expect(codes(two)).toContain('multiple_providers');
  });
});

describe('level checks', () => {
  it('rejects a level with both data and payments, or a hot key on a shard key it lacks', () => {
    expect(() =>
      makeLevel({
        workload: {
          payments: { rateLimitRps: 1, latencyMs: 1 },
          data: { readShare: 1, keys: { count: 1, zipf: 0, valueKb: 1 } },
        },
      }),
    ).toThrow(/not both/);
    expect(() =>
      makeLevel({
        workload: { data: { readShare: 1, keys: { count: 1, zipf: 0, valueKb: 1 } } },
        events: [{ atSec: 1, kind: 'hotKey', untilSec: 2, shardKey: 'userId', share: 0.5, label: 'x' }],
      }),
    ).toThrow(/unknown shard key/);
  });
});
