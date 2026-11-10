/**
 * The particle simulation behind the overlay: request dots travelling along edges and red ✕ marks popping off failing
 * nodes. Plain mutable state advanced in particle time; no DOM, so it is unit-testable. Drawing lives in
 * `ParticleLayer.tsx`.
 */
import type { Rect } from '../canvas/types.ts';
import { dotRate, markRate, type EdgeFlow, type ParticleTuning } from './flows.ts';
import { between, createRng, type Rng } from './rng.ts';

export interface Dot {
  /** Progress along the edge, 0 (source) to 1 (target). */
  u: number;
  /** Progress per particle-second. */
  speed: number;
  /** Sideways offset from the edge's centre line, in flow pixels. */
  lane: number;
}

export interface FailureMark {
  /** Flow coordinates. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageSec: number;
  spin: number;
}

/** Downward acceleration of ✕ marks, flow pixels per second². */
export const MARK_GRAVITY = 420;

export class ParticleSystem {
  readonly dots = new Map<string, Dot[]>();
  readonly marks: FailureMark[] = [];
  private readonly dotDebt = new Map<string, number>();
  private readonly markDebt = new Map<string, number>();
  private rng: Rng;
  private readonly seed: number;
  tuning: ParticleTuning;

  constructor(seed: number, tuning: ParticleTuning) {
    this.seed = seed;
    this.tuning = tuning;
    this.rng = createRng(seed);
  }

  /** Clears everything and restarts the RNG, so a replay from the start looks identical. */
  reset(): void {
    this.dots.clear();
    this.marks.length = 0;
    this.dotDebt.clear();
    this.markDebt.clear();
    this.rng = createRng(this.seed);
  }

  /**
   * Advances by `dt` particle-seconds: moves and retires existing particles, then spawns new ones for the current
   * flows. `nodeRects` (flow coordinates) positions new ✕ marks; failing nodes without a rect spawn nothing.
   */
  update(
    dt: number,
    flows: readonly EdgeFlow[],
    failures: readonly { nodeId: string; failedRps: number }[],
    nodeRects: Readonly<Record<string, Rect>>,
  ): void {
    if (!(dt > 0)) return;
    const { tuning, rng } = this;

    for (const [key, dots] of this.dots) {
      let write = 0;
      for (const dot of dots) {
        dot.u += dot.speed * dt;
        if (dot.u < 1) dots[write++] = dot;
      }
      dots.length = write;
      if (write === 0) this.dots.delete(key);
    }

    for (const flow of flows) {
      const debt = (this.dotDebt.get(flow.key) ?? 0) + dotRate(flow.rps, tuning) * dt;
      let count = Math.floor(debt);
      this.dotDebt.set(flow.key, debt - count);
      if (count === 0) continue;
      let dots = this.dots.get(flow.key);
      if (!dots) this.dots.set(flow.key, (dots = []));
      count = Math.min(count, tuning.maxDotsPerEdge - dots.length);
      for (let i = 0; i < count; i++) {
        const speed = between(rng, 0.88, 1.12) / tuning.travelSec;
        // Spread spawns across the step so dots don't bunch at low frame rates.
        dots.push({ u: rng() * speed * dt, speed, lane: between(rng, -3, 3) });
      }
    }

    let write = 0;
    for (const mark of this.marks) {
      mark.ageSec += dt;
      mark.vy += MARK_GRAVITY * dt;
      mark.x += mark.vx * dt;
      mark.y += mark.vy * dt;
      if (mark.ageSec < tuning.markLifeSec) this.marks[write++] = mark;
    }
    this.marks.length = write;

    for (const { nodeId, failedRps } of failures) {
      const debt = (this.markDebt.get(nodeId) ?? 0) + markRate(failedRps, tuning) * dt;
      const count = Math.floor(debt);
      this.markDebt.set(nodeId, debt - count);
      const rect = nodeRects[nodeId];
      if (!rect) continue;
      for (let i = 0; i < count; i++) {
        this.marks.push({
          x: rect.x + rect.width * between(rng, 0.15, 0.85),
          y: rect.y + rect.height * between(rng, 0.55, 0.9),
          vx: between(rng, -55, 55),
          vy: between(rng, -170, -90),
          ageSec: 0,
          spin: between(rng, -1, 1),
        });
      }
    }
  }

  dotCount(): number {
    let n = 0;
    for (const dots of this.dots.values()) n += dots.length;
    return n;
  }
}
