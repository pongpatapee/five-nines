import { describe, expect, it } from 'vitest';
import { evaluateDesign } from '../src/evaluate.ts';
import { getLevel } from '../src/levels/index.ts';
import { simulate } from '../src/simulate.ts';
import { balanced, CRASH_AT_30, makeLevel, singleServer } from './fixtures.ts';

describe('capacity and queueing', () => {
  it('serves everything when under capacity', () => {
    // large = 8 vCPU × 100 req/s = 800 req/s capacity, 300 offered.
    const result = simulate(makeLevel(), singleServer('large'));
    expect(result.availability).toBeGreaterThan(0.99999);
    expect(result.causes).toEqual([]);
    expect(result.totalRequests).toBeCloseTo(300 * 60, 6);
  });

  it('fails the excess when overloaded, once the queue is full', () => {
    // small = 200 req/s capacity, 300 offered: a third should fail.
    const result = simulate(makeLevel(), singleServer('small'));
    expect(result.availability).toBeCloseTo(2 / 3, 1);
    expect(result.causes).toEqual([expect.objectContaining({ nodeId: 'app', reason: 'timeout' })]);
    // The queue absorbs the first second of excess (capacity × timeout) before anything fails.
    expect(result.causes[0]!.firstAtSec).toBeGreaterThan(1);
    expect(result.causes[0]!.firstAtSec).toBeLessThan(3);
  });

  it('makes latency climb with utilization even below capacity', () => {
    const p99At = (rps: number) =>
      simulate(makeLevel({ workload: { traffic: [{ atSec: 0, rps }] } }), singleServer('medium')).latency.p99Ms!;
    const light = p99At(100); // 25% busy
    const busy = p99At(360); // 90% busy
    expect(busy).toBeGreaterThan(light * 2);
  });

  it('pins p99 near the timeout when overloaded', () => {
    const result = simulate(makeLevel(), singleServer('small'));
    expect(result.latency.p99Ms).toBeGreaterThan(900);
  });

  it('drains a backlog after a spike passes', () => {
    const level = makeLevel({
      durationSec: 30,
      workload: {
        traffic: [
          { atSec: 0, rps: 300 },
          { atSec: 5, rps: 300 },
          { atSec: 5.1, rps: 1000 },
          { atSec: 6, rps: 1000 },
          { atSec: 6.1, rps: 300 },
        ],
      },
    });
    const result = simulate(level, singleServer('large'));
    const last = result.timeline.at(-1)!;
    expect(Math.max(...result.timeline.map((frame) => frame.nodes['app']!.instances[0]!.queued))).toBeGreaterThan(0);
    expect(last.nodes['app']!.instances[0]!.queued).toBe(0);
    expect(result.availability).toBeGreaterThan(0.99999);
  });
});

describe('load balancing', () => {
  it('splits traffic evenly across instances', () => {
    const result = simulate(makeLevel({ workload: { traffic: [{ atSec: 0, rps: 1000 }] } }), balanced(4, 'small'));
    const frame = result.timeline.at(-1)!;
    expect(frame.nodes['lb']!.arrivalRps).toBeCloseTo(1000, 6);
    for (const instance of frame.nodes['app']!.instances) expect(instance.utilization).toBeCloseTo(250 / 200, 6);
  });

  it('round-robins by instance, not by size', () => {
    const level = makeLevel({ workload: { traffic: [{ atSec: 0, rps: 1600 }] } });
    const design = balanced(1, 'xlarge');
    design.nodes.push({ id: 'tiny', kind: 'appServer', size: 'small', instances: 1 });
    design.edges.push({ from: 'lb', to: 'tiny' });
    const result = simulate(level, design);
    // 1,800 req/s of capacity for 1,600 offered, but the small server gets 800 against its 200.
    expect(result.causes.map((cause) => cause.nodeId)).toEqual(['tiny']);
    expect(result.availability).toBeCloseTo(1 - 600 / 1600, 1);
  });
});

describe('instance failure', () => {
  const level = (durationSec = 60) =>
    makeLevel({ durationSec, events: CRASH_AT_30, workload: { traffic: [{ atSec: 0, rps: 1000 }] } });

  it('loses the crashed share of traffic until health checks remove it', () => {
    const result = simulate(level(), balanced(4, 'large', { healthCheckIntervalSec: 5 }));
    // Checks run every 5s, so the crash at 30s fails checks at 30s and 35s: 5s of a quarter of 1,000 req/s.
    expect(result.failedRequests).toBeCloseTo(1250, 6);
    expect(result.causes).toEqual([expect.objectContaining({ nodeId: 'app', reason: 'instance_down', firstAtSec: 30 })]);
    expect(result.events.map((event) => [event.kind, event.atSec])).toEqual([
      ['instanceFailed', 30],
      ['removedFromRotation', 35],
    ]);
  });

  it('detects failures more slowly with a longer health-check interval', () => {
    const fast = simulate(level(90), balanced(4, 'large', { healthCheckIntervalSec: 5 }));
    const slow = simulate(level(90), balanced(4, 'large', { healthCheckIntervalSec: 30 }));
    expect(slow.failedRequests).toBeGreaterThan(fast.failedRequests * 2);
  });

  it('hides the crash entirely when the load balancer retries refused connections', () => {
    const result = simulate(level(), balanced(4, 'large', { healthCheckIntervalSec: 5, retryOnConnectFailure: true }));
    expect(result.failedRequests).toBeLessThan(1);
  });

  it('overloads the survivors when there is no spare capacity', () => {
    // 4 large = 3,200 req/s; after a crash, 3 large = 2,400 req/s for 3,000 offered.
    const tight = makeLevel({ events: CRASH_AT_30, workload: { traffic: [{ atSec: 0, rps: 3000 }] } });
    const result = simulate(tight, balanced(4, 'large', { retryOnConnectFailure: true }));
    expect(result.causes.map((cause) => cause.reason)).toContain('timeout');
    expect(result.availability).toBeLessThan(0.99);
  });

  it('fails everything with no healthy backend left', () => {
    const result = simulate(level(), balanced(1, 'xlarge', { healthCheckIntervalSec: 5 }));
    expect(result.causes.map((cause) => cause.reason)).toEqual(['instance_down', 'no_healthy_backend']);
    expect(result.availability).toBeCloseTo(0.5, 1);
  });
});

describe('timeline', () => {
  it('attributes failures to the node where they happened, per second', () => {
    const level = makeLevel({ events: CRASH_AT_30, workload: { traffic: [{ atSec: 0, rps: 1000 }] } });
    const result = simulate(level, balanced(4, 'large', { healthCheckIntervalSec: 5 }));
    const second = result.timeline.find((frame) => frame.atSec === 31)!;
    expect(second.nodes['app']!.failedRps).toBeCloseTo(250, 6);
    expect(second.nodes['lb']!.failedRps).toBe(0);
    expect(second.failedRps).toBeCloseTo(250, 6);
    expect(result.timeline.find((frame) => frame.atSec === 40)!.nodes['app']!.failedRps).toBeCloseTo(0, 6);
  });
});

describe('determinism and grading', () => {
  it('produces identical results for identical inputs', () => {
    const level = makeLevel({ events: CRASH_AT_30 });
    expect(simulate(level, balanced(3, 'small'))).toEqual(simulate(level, balanced(3, 'small')));
  });

  it('reports every failing check', () => {
    const evaluation = evaluateDesign(makeLevel({ requirements: { budgetUsdPerMonth: 10 } }), singleServer('small'));
    expect(evaluation).toMatchObject({ status: 'graded', grade: 'fail', failedChecks: ['availability', 'latency', 'budget'] });
  });

  it('reports when the error budget ran out', () => {
    // 60s × 1,000 req/s = 60,000 requests, so the budget is 60. The crash fails 250 req/s from t=30.
    const level = makeLevel({ events: CRASH_AT_30, workload: { traffic: [{ atSec: 0, rps: 1000 }] } });
    const failing = evaluateDesign(level, balanced(4, 'large', { healthCheckIntervalSec: 5 }));
    expect(failing.status === 'graded' && failing.errorBudgetExhaustedAtSec).toBe(30);
    const passing = evaluateDesign(level, balanced(4, 'large', { retryOnConnectFailure: true }));
    expect(passing.status === 'graded' && passing.errorBudgetExhaustedAtSec).toBeNull();
  });

  it('does not simulate an invalid design', () => {
    const evaluation = evaluateDesign(makeLevel(), { nodes: [], edges: [] });
    expect(evaluation.status).toBe('invalid');
  });
});

describe('root cause', () => {
  it('blames the overload that spent the error budget, not stale reads that started earlier', () => {
    // Two large replicas on level 5: as they near full load their lag passes the staleness limit and a trickle of
    // stale reads starts at ~50s. They overload at ~74s, and the timeouts exhaust the budget within seconds.
    const level = getLevel('05-cache-miss')!;
    const design = level.antiSolutions.find((anti) => anti.name === 'Two large read replicas')!.design;
    const result = simulate(level, design);
    const stale = result.causes.find((cause) => cause.reason === 'stale_read')!;
    const root = result.causes[0]!;
    expect(stale.firstAtSec).toBeLessThan(root.firstAtSec);
    expect(root).toMatchObject({ nodeId: 'replicas', reason: 'timeout' });
    expect(root.firstAtSec).toBeLessThanOrEqual(result.errorBudgetExhaustedAtSec!);
  });

  it('still blames stale reads when they are what spent the budget', () => {
    const level = getLevel('06-bank-balance')!;
    const design = level.antiSolutions.find((anti) => anti.name === 'Every read from the replicas')!.design;
    expect(simulate(level, design).causes[0]).toMatchObject({ nodeId: 'replicas', reason: 'stale_read' });
  });

  it('lists the other causes in order of onset after the root cause', () => {
    // A crash at 30s; three surviving small servers can't carry 1,000 req/s, so timeouts follow.
    const level = makeLevel({ events: CRASH_AT_30, workload: { traffic: [{ atSec: 0, rps: 700 }] } });
    const result = simulate(level, balanced(4, 'small', { healthCheckIntervalSec: 5 }));
    const rest = result.causes.slice(1).map((cause) => cause.firstAtSec);
    expect(rest).toEqual([...rest].sort((a, b) => a - b));
  });
});
