/**
 * How much traffic each edge and node shows, and how that maps to particles on screen. Edge flows come straight from
 * the engine's per-edge rates.
 */
import type { Design } from '@five-nines/sim';
import { edgeKey } from '../canvas/draft.ts';
import { isFailingRate, type LiveFrame } from '../canvas/types.ts';

export interface EdgeFlow {
  key: string;
  from: string;
  to: string;
  rps: number;
  /** The part of `rps` that is writes, drawn in its own colour. */
  writeRps: number;
}

/** The flow on every edge of `design` for a live frame. Edges the frame doesn't know about carry nothing. */
export function edgeFlows(design: Design, frame: LiveFrame): EdgeFlow[] {
  return design.edges.map((edge) => {
    const key = edgeKey(edge);
    const flow = frame.edges[key];
    const rps = Math.max(0, flow?.rps ?? 0);
    return { key, from: edge.from, to: edge.to, rps, writeRps: Math.min(rps, Math.max(0, flow?.writeRps ?? 0)) };
  });
}

/** Per-node failure rates for a live frame, leaving out nodes that aren't failing (see `isFailingRate`). */
export function nodeFailures(frame: LiveFrame): { nodeId: string; failedRps: number }[] {
  const out: { nodeId: string; failedRps: number }[] = [];
  for (const [nodeId, node] of Object.entries(frame.nodes)) {
    if (isFailingRate(node.failedRps)) out.push({ nodeId, failedRps: node.failedRps });
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
