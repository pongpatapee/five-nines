import { evaluateDesign, getLevel, type Design, type NodeFrame, type SimulationResult, type TimelineFrame } from '@five-nines/sim';
import type { GradedEvaluation } from '../../src/engine/index.ts';

/** Level 3 with five xlarge instances and no retries: a crash at t=61 exhausts the budget. */
export const LEVEL3_NO_RETRIES: Design = {
  nodes: [
    { id: 'lb', kind: 'loadBalancer', healthCheckIntervalSec: 5, retryOnConnectFailure: false },
    { id: 'app', kind: 'appServer', size: 'xlarge', instances: 5 },
  ],
  edges: [
    { from: 'clients', to: 'lb' },
    { from: 'lb', to: 'app' },
  ],
};

export function graded(levelId: string, design: Design): GradedEvaluation {
  const evaluation = evaluateDesign(getLevel(levelId)!, design);
  if (evaluation.status !== 'graded') throw new Error('expected a graded evaluation');
  return evaluation;
}

/** A hand-made simulation result with the given per-second offered and failed totals. */
export function syntheticSimulation(offered: number[], failed: number[]): SimulationResult {
  const timeline: TimelineFrame[] = offered.map((offeredRps, i) => ({
    atSec: i,
    offeredRps,
    failedRps: failed[i] ?? 0,
    p99Ms: 20,
    nodes: { app: node(offeredRps, failed[i] ?? 0) },
    edges: { 'clients->app': { rps: offeredRps, writeRps: 0 } },
  }));
  const totalRequests = offered.reduce((a, b) => a + b, 0);
  const failedRequests = failed.reduce((a, b) => a + b, 0);
  return {
    totalRequests,
    failedRequests,
    availability: 1 - failedRequests / totalRequests,
    latency: { p50Ms: 10, p99Ms: 20 },
    causes: [],
    events: [],
    timeline,
    dataTier: { cacheHitRate: {}, peakReplicationLagSec: {} },
  };
}

function node(arrivalRps: number, failedRps: number): NodeFrame {
  return { arrivalRps, failedRps, instances: [{ up: true, utilization: arrivalRps / 1000, queued: 0 }] };
}
