/** Deterministic pseudo-random numbers (mulberry32): the same seed gives the same sequence everywhere. */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleExponential(rng: Rng, rate: number): number {
  return -Math.log(1 - rng()) / rate;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/**
 * Erlang C: the probability that a request arriving at an M/M/c queue has to wait.
 * `servers` is c, `offeredLoad` is λ·S in erlangs. Returns 1 when the queue is at or over capacity.
 */
export function erlangC(servers: number, offeredLoad: number): number {
  if (offeredLoad <= 0) return 0;
  if (offeredLoad >= servers) return 1;
  // Erlang B by its stable recursion, then convert to Erlang C.
  let erlangB = 1;
  for (let k = 1; k <= servers; k++) {
    erlangB = (offeredLoad * erlangB) / (k + offeredLoad * erlangB);
  }
  return (servers * erlangB) / (servers - offeredLoad * (1 - erlangB));
}

/** Linear interpolation over (atSec, rps) points, clamped at both ends. */
export function interpolate(points: readonly { atSec: number; rps: number }[], atSec: number): number {
  const first = points[0]!;
  if (atSec <= first.atSec) return first.rps;
  for (let i = 1; i < points.length; i++) {
    const right = points[i]!;
    if (atSec <= right.atSec) {
      const left = points[i - 1]!;
      return left.rps + ((right.rps - left.rps) * (atSec - left.atSec)) / (right.atSec - left.atSec);
    }
  }
  return points[points.length - 1]!.rps;
}

/** Weighted latency samples with percentile queries. */
export class WeightedSamples {
  private values: number[] = [];
  private weights: number[] = [];

  add(value: number, weight: number): void {
    this.values.push(value);
    this.weights.push(weight);
  }

  get size(): number {
    return this.values.length;
  }

  /** The smallest value whose cumulative weight reaches q of the total, or null if there are no samples. */
  quantile(q: number): number | null {
    if (this.values.length === 0) return null;
    const order = this.values.map((_, i) => i).sort((a, b) => this.values[a]! - this.values[b]!);
    const total = this.weights.reduce((sum, w) => sum + w, 0);
    const target = q * total;
    let cumulative = 0;
    for (const i of order) {
      cumulative += this.weights[i]!;
      if (cumulative >= target) return this.values[i]!;
    }
    return this.values[order[order.length - 1]!]!;
  }

  clear(): void {
    this.values = [];
    this.weights = [];
  }
}
