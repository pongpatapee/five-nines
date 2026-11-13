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
 * A sample from an exponential distribution of `rate` truncated to [0, maxSec]. Rate 0 is uniform over the range, and
 * the formula stays accurate as the rate approaches it.
 */
export function sampleTruncatedExponential(rng: Rng, rate: number, maxSec: number): number {
  const u = rng();
  if (rate === 0) return u * maxSec;
  return -Math.log1p(u * Math.expm1(-rate * maxSec)) / rate;
}

/** Erlang B: the chance that every one of `servers` is busy in a loss system offered `offeredLoad` erlangs. */
export function erlangB(servers: number, offeredLoad: number): number {
  // The stable recursion B(k) = a·B(k−1) / (k + a·B(k−1)), from B(0) = 1.
  let b = 1;
  for (let k = 1; k <= servers; k++) b = (offeredLoad * b) / (k + offeredLoad * b);
  return b;
}

/** What a request arriving at a pool of servers waits, in steady state. See `queueDelay`. */
export interface QueueDelay {
  /** Chance of finding every server busy and having to wait at all, including those who then wait too long. */
  waitProbability: number;
  /** Chance of waiting longer than the timeout. */
  lateProbability: number;
  /** cμ − λ. Waits that end within the timeout are exponential at this rate, truncated at the timeout. */
  decayRate: number;
}

/**
 * Queueing delay at an M/M/c queue whose requests give up after waiting `timeoutSec` (M/M/c+D): `servers` workers
 * each serving `serviceRps`, Poisson arrivals at `arrivalRps` (at most servers × serviceRps). Requests that give up
 * leave without being served, as in the rest of the engine.
 *
 * Unlike the plain M/M/c queue (Erlang C), this one is stable at full load, so delay and timeouts stay finite and
 * continuous as utilization reaches 100%. With a = λ/μ, θ = cμ − λ, ρ = λ/(cμ) and T the timeout, the steady state
 * has P(j busy, no wait) ∝ a^j/j! for j < c, and the wait a new arrival would face has density
 * λ·P(c − 1 busy)·e^(−θx) up to T and decays at rate cμ beyond it. Normalizing by the no-wait states, with
 * B = Erlang B(c − 1, a):
 *
 *   joining  = B·λ·∫₀ᵀ e^(−θx) dx = B·λT·(1 − e^(−θT)) / (θT)      (waits, and is served in time)
 *   late     = B·ρ·e^(−θT)                                           (would wait past T)
 *   P(wait)  = (joining + late) / (1 + joining + late)
 *
 * As T → ∞ below full load, P(wait) is Erlang C. At full load (θ = 0) waits are uniform over the timeout.
 */
export function queueDelay(servers: number, arrivalRps: number, serviceRps: number, timeoutSec: number): QueueDelay {
  const capacityRps = servers * serviceRps;
  const decayRate = Math.max(0, capacityRps - arrivalRps);
  if (!(arrivalRps > 0)) return { waitProbability: 0, lateProbability: 0, decayRate };
  const b = erlangB(servers - 1, arrivalRps / serviceRps);
  const z = decayRate * timeoutSec;
  const joining = b * arrivalRps * timeoutSec * (z > 0 ? -Math.expm1(-z) / z : 1);
  const late = b * (arrivalRps / capacityRps) * Math.exp(-z);
  const norm = 1 + joining + late;
  return { waitProbability: (joining + late) / norm, lateProbability: late / norm, decayRate };
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
