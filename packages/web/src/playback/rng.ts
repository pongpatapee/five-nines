/** A small seeded PRNG (mulberry32), so particle jitter looks the same on every replay. */
export type Rng = () => number;

/** Returns a generator of floats in [0, 1), fully determined by `seed`. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max). */
export function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}
