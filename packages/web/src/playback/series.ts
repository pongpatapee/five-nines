/**
 * Maths over the simulation timeline: interpolated live frames, cumulative totals at any playhead, the error budget
 * and availability so far.
 *
 * Time model: `timeline[i]` covers simulated second `[i, i + 1)`, and its values are totals over that second. A
 * playhead at `t` (seconds, 0…`durationSec`) has seen every whole second before `floor(t)` plus the elapsed fraction
 * of the current one, so cumulative quantities grow linearly within a second.
 */
import { AVAILABILITY_TIERS, type NodeFrame, type SimulationResult, type TimelineFrame } from '@five-nines/sim';
import type { LiveFrame } from '../canvas/types.ts';

/** Precomputed prefix sums so cumulative queries are O(1). */
export interface RunSeries {
  timeline: readonly TimelineFrame[];
  /** Length of the run in seconds: one per frame. */
  durationSec: number;
  /** `failedBefore[i]`: failed requests in seconds `[0, i)`. Length `durationSec + 1`. */
  failedBefore: number[];
  /** `offeredBefore[i]`: offered requests in seconds `[0, i)`. Length `durationSec + 1`. */
  offeredBefore: number[];
  /** Failed requests allowed for a pass: 0.1% of all requests in the run. */
  errorBudget: number;
  /**
   * The exact instant (within the engine's `errorBudgetExhaustedAtSec` second) at which cumulative failures reach the
   * budget, or null if they never do. Playback freezes here.
   */
  exhaustedAt: number | null;
}

export function prepareSeries(simulation: SimulationResult, errorBudgetExhaustedAtSec: number | null): RunSeries {
  const { timeline } = simulation;
  const failedBefore = [0];
  const offeredBefore = [0];
  for (const frame of timeline) {
    failedBefore.push(failedBefore[failedBefore.length - 1]! + frame.failedRps);
    offeredBefore.push(offeredBefore[offeredBefore.length - 1]! + frame.offeredRps);
  }
  const errorBudget = (1 - AVAILABILITY_TIERS.pass) * simulation.totalRequests;
  const series: RunSeries = {
    timeline,
    durationSec: timeline.length,
    failedBefore,
    offeredBefore,
    errorBudget,
    exhaustedAt: null,
  };
  series.exhaustedAt = exhaustionInstant(series, errorBudgetExhaustedAtSec);
  return series;
}

/** Where `t` falls: the whole second it is in and how far through it. `t` is clamped to the run. */
export function locate(durationSec: number, t: number): { index: number; fraction: number } {
  if (durationSec <= 0) return { index: 0, fraction: 0 };
  const clamped = clamp(t, 0, durationSec);
  if (clamped >= durationSec) return { index: durationSec - 1, fraction: 1 };
  const index = Math.floor(clamped);
  return { index, fraction: clamped - index };
}

function cumulative(before: readonly number[], values: (i: number) => number, durationSec: number, t: number): number {
  if (durationSec <= 0) return 0;
  const { index, fraction } = locate(durationSec, t);
  return before[index]! + fraction * values(index);
}

/** Failed requests from the start of the run up to the playhead. */
export function failedUpTo(series: RunSeries, t: number): number {
  return cumulative(series.failedBefore, (i) => series.timeline[i]!.failedRps, series.durationSec, t);
}

/** Offered requests from the start of the run up to the playhead. */
export function offeredUpTo(series: RunSeries, t: number): number {
  return cumulative(series.offeredBefore, (i) => series.timeline[i]!.offeredRps, series.durationSec, t);
}

/** Availability of the requests seen so far (1 before any traffic). */
export function availabilityUpTo(series: RunSeries, t: number): number {
  const offered = offeredUpTo(series, t);
  return offered > 0 ? Math.max(0, 1 - failedUpTo(series, t) / offered) : 1;
}

export interface BudgetUsage {
  budget: number;
  used: number;
  /** `used / budget`, unclamped (above 1 once exhausted). 0 when the budget is 0 and nothing failed. */
  fraction: number;
  exhausted: boolean;
}

export function budgetUsage(series: RunSeries, t: number): BudgetUsage {
  const used = failedUpTo(series, t);
  const budget = series.errorBudget;
  const fraction = budget > 0 ? used / budget : used > 0 ? Infinity : 0;
  const exhausted = series.exhaustedAt !== null && t >= series.exhaustedAt;
  return { budget, used, fraction, exhausted };
}

/**
 * Solves `failedUpTo(t) = budget` inside the second the engine reported, so the freeze lands where the budget bar
 * reaches 100%. Returns null when the engine says the budget held.
 */
export function exhaustionInstant(series: RunSeries, exhaustedAtSec: number | null): number | null {
  if (exhaustedAtSec === null || series.durationSec === 0) return null;
  const index = clamp(Math.floor(exhaustedAtSec), 0, series.durationSec - 1);
  const failed = series.timeline[index]!.failedRps;
  const needed = series.errorBudget - series.failedBefore[index]!;
  const fraction = failed > 0 ? clamp(needed / failed, 0, 1) : 0;
  return index + fraction;
}

/**
 * The live stats to show at playhead `t`, smoothly interpolated.
 *
 * Each frame's values are averages over its second, so they are placed at the middle of the second and linearly
 * blended between neighbours. Discrete state (instance up/down, rotation size) comes from the second the playhead
 * is in, so crashes appear crisply rather than fading.
 */
export function sampleFrame(timeline: readonly TimelineFrame[], t: number): LiveFrame | null {
  const n = timeline.length;
  if (n === 0) return null;
  const centred = clamp(t, 0, n) - 0.5;
  const i0 = clamp(Math.floor(centred), 0, n - 1);
  const i1 = Math.min(i0 + 1, n - 1);
  const f = centred < 0 ? 0 : clamp(centred - Math.floor(centred), 0, 1);
  const a = timeline[i0]!;
  const b = timeline[i1]!;
  const current = timeline[locate(n, t).index]!;

  const nodes: Record<string, NodeFrame> = {};
  for (const [id, discrete] of Object.entries(current.nodes)) {
    const na = a.nodes[id] ?? discrete;
    const nb = b.nodes[id] ?? discrete;
    const node: NodeFrame = {
      arrivalRps: lerp(na.arrivalRps, nb.arrivalRps, f),
      failedRps: lerp(na.failedRps, nb.failedRps, f),
      instances: discrete.instances.map((instance, k) => {
        const ia = na.instances[k] ?? instance;
        const ib = nb.instances[k] ?? instance;
        return {
          up: instance.up,
          utilization: lerp(ia.utilization, ib.utilization, f),
          queued: lerp(ia.queued, ib.queued, f),
        };
      }),
    };
    if (discrete.inRotation !== undefined) node.inRotation = discrete.inRotation;
    nodes[id] = node;
  }

  return {
    atSec: t,
    offeredRps: lerp(a.offeredRps, b.offeredRps, f),
    failedRps: lerp(a.failedRps, b.failedRps, f),
    nodes,
  };
}

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
