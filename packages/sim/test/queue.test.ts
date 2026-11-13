import { describe, expect, it } from 'vitest';
import { TICK_SEC } from '../src/catalog.ts';
import { createRng } from '../src/math.ts';
import { newStation, probeWait, stepStation } from '../src/queue.ts';

// 8 workers × 10 ms: 800 req/s capacity, 1 s timeout.
const SERVERS = 8;
const SERVICE_SEC = 0.01;
const TIMEOUT_SEC = 1;

/** Runs a station at a constant utilization from empty; returns its last tick and the share of arrivals that failed. */
function run(utilization: number, seconds = 1) {
  const station = newStation();
  const rps = 800 * utilization;
  let failed = 0;
  let last = stepStation(station, rps, SERVERS, SERVICE_SEC, TIMEOUT_SEC);
  failed += last.failed;
  const ticks = Math.round(seconds / TICK_SEC);
  for (let i = 1; i < ticks; i++) {
    last = stepStation(station, rps, SERVERS, SERVICE_SEC, TIMEOUT_SEC);
    failed += last.failed;
  }
  return { tick: last.tick, failedShare: failed / (rps * ticks * TICK_SEC) };
}

function meanWait(utilization: number): number {
  const { tick } = run(utilization);
  const rng = createRng(7);
  let total = 0;
  let n = 0;
  for (let i = 0; i < 20_000; i++) {
    const wait = probeWait(tick, rng, TIMEOUT_SEC);
    if (wait !== null) {
      total += wait;
      n++;
    }
  }
  return total / n;
}

describe('station near 100% utilization', () => {
  it('queues heavily just below, at and just above capacity, with no jump at ρ = 1', () => {
    const below = meanWait(1 - 1e-6);
    const at = meanWait(1);
    const above = meanWait(1 + 1e-6);
    // Waits at full load are uniform over the timeout: about half of it on average.
    expect(at).toBeGreaterThan(0.4);
    expect(below).toBeCloseTo(at, 2);
    expect(above).toBeCloseTo(at, 2);
  });

  it('makes latency climb monotonically up to and through capacity', () => {
    const waits = [0.5, 0.9, 0.99, 0.999, 1, 1.01].map(meanWait);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(waits[0]).toBeLessThan(0.001);
  });

  it('times out a small, continuous share of requests at ρ → 1⁻ and ρ = 1, rather than all or none', () => {
    const below = run(1 - 1e-9).failedShare;
    const at = run(1).failedShare;
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(0.01);
    expect(below).toBeCloseTo(at, 6);
  });

  it('fails only the excess, plus that small share, once an overload has filled the queue', () => {
    // At 150% the backlog fills to a timeout's worth of work after 2 s; by 20 s the excess dominates.
    const { failedShare } = run(1.5, 20);
    expect(failedShare).toBeGreaterThan(0.3 - 0.01);
    expect(failedShare).toBeLessThan(1 / 3);
  });

  it('never makes a request wait past the timeout', () => {
    const { tick } = run(1.5, 20);
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const wait = probeWait(tick, rng, TIMEOUT_SEC);
      if (wait !== null) expect(wait).toBeLessThanOrEqual(TIMEOUT_SEC);
    }
  });
});
