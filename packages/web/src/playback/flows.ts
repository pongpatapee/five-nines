/**
 * How much traffic each edge and node shows, and how that maps to particles on screen.
 *
 * The engine reports per-node totals, not per-edge flows, so edge flow is derived:
 * - the clients → entry edge carries everything offered;
 * - any other edge carries an equal share of its target's arrivals (target `arrivalRps` / number of incoming edges).
 */
import { CLIENTS_ID, type Design } from '@five-nines/sim';
import { edgeKey } from '../canvas/draft.ts';
import type { LiveFrame } from '../canvas/types.ts';

export interface EdgeFlow {
  key: string;
  from: string;
  to: string;
  rps: number;
}

/** Number of incoming edges per node id. */
export function incomingCounts(design: Design): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of design.edges) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  return counts;
}

/** The flow on every edge of `design` for a live frame. */
export function edgeFlows(design: Design, frame: LiveFrame, incoming = incomingCounts(design)): EdgeFlow[] {
  return design.edges.map((edge) => {
    let rps: number;
    if (edge.from === CLIENTS_ID) rps = frame.offeredRps;
    else rps = (frame.nodes[edge.to]?.arrivalRps ?? 0) / Math.max(1, incoming.get(edge.to) ?? 1);
    return { key: edgeKey(edge), from: edge.from, to: edge.to, rps: Math.max(0, rps) };
  });
}

/** Per-node failure rates for a live frame, leaving out nodes that aren't failing. */
export function nodeFailures(frame: LiveFrame): { nodeId: string; failedRps: number }[] {
  const out: { nodeId: string; failedRps: number }[] = [];
  for (const [nodeId, node] of Object.entries(frame.nodes)) {
    if (node.failedRps > 0) out.push({ nodeId, failedRps: node.failedRps });
  }
  return out;
}

/** Tuning for the particle layer. All rates are per second of particle time (see `particlePace`). */
export interface ParticleTuning {
  /** Seconds a dot takes to travel an edge at pace 1. */
  travelSec: number;
  /** Dots per second = `dotGain × sqrt(rps)`, capped at `maxDotRate`. */
  dotGain: number;
  maxDotRate: number;
  /** Hard cap on dots alive on one edge. */
  maxDotsPerEdge: number;
  /** ✕ marks per second = `markGain × sqrt(failedRps)`, capped at `maxMarkRate`. */
  markGain: number;
  maxMarkRate: number;
  /** Seconds a ✕ mark lives. */
  markLifeSec: number;
}

export const FULL_MOTION: ParticleTuning = {
  travelSec: 1.3,
  dotGain: 0.6,
  maxDotRate: 44,
  maxDotsPerEdge: 60,
  markGain: 0.45,
  maxMarkRate: 14,
  markLifeSec: 1.3,
};

/** For `prefers-reduced-motion`: a fraction of the particles, so the canvas stays readable without busy motion. */
export const REDUCED_MOTION: ParticleTuning = {
  travelSec: 1.6,
  dotGain: 0.2,
  maxDotRate: 10,
  maxDotsPerEdge: 16,
  markGain: 0.15,
  maxMarkRate: 4,
  markLifeSec: 1.3,
};

/** Sqrt-scaled, capped spawn rate: doubling traffic doesn't double the dots, and huge flows don't flood the edge. */
export function spawnRate(rps: number, gain: number, max: number): number {
  if (!(rps > 0)) return 0;
  return Math.min(max, gain * Math.sqrt(rps));
}

export function dotRate(rps: number, tuning: ParticleTuning): number {
  return spawnRate(rps, tuning.dotGain, tuning.maxDotRate);
}

export function markRate(failedRps: number, tuning: ParticleTuning): number {
  return spawnRate(failedRps, tuning.markGain, tuning.maxMarkRate);
}

/**
 * How fast particle time runs relative to real time, for a playback speed in simulated seconds per real second.
 * Paused is 0; 4× (the default) is 1; it grows with the square root of speed so 16× feels faster without becoming a
 * blur, and the freeze's slow motion visibly slows the dots.
 */
export function particlePace(speed: number): number {
  return speed > 0 ? Math.sqrt(speed / 4) : 0;
}
