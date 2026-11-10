import type { Design } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import type { LiveFrame } from '../../src/canvas/types.ts';
import {
  dotRate,
  edgeFlows,
  FULL_MOTION,
  incomingCounts,
  markRate,
  nodeFailures,
  particlePace,
  REDUCED_MOTION,
  spawnRate,
} from '../../src/playback/flows.ts';
import { ParticleSystem } from '../../src/playback/particles.ts';
import { createRng } from '../../src/playback/rng.ts';

// clients → lb → (a, b); a and b → db? Not a real topology, but exercises shared targets.
const design: Design = {
  nodes: [
    { id: 'lb', kind: 'loadBalancer', healthCheckIntervalSec: 5, retryOnConnectFailure: true },
    { id: 'a', kind: 'appServer', size: 'small', instances: 1 },
    { id: 'b', kind: 'appServer', size: 'small', instances: 1 },
    { id: 'c', kind: 'appServer', size: 'small', instances: 1 },
  ],
  edges: [
    { from: 'clients', to: 'lb' },
    { from: 'lb', to: 'a' },
    { from: 'lb', to: 'b' },
    { from: 'a', to: 'c' },
    { from: 'b', to: 'c' },
  ],
};

function frame(): LiveFrame {
  const node = (arrivalRps: number, failedRps = 0) => ({ arrivalRps, failedRps, instances: [] });
  return {
    atSec: 0,
    offeredRps: 1000,
    failedRps: 30,
    nodes: { lb: node(990, 10), a: node(500, 20), b: node(490), c: node(800) },
  };
}

describe('edge flows', () => {
  it('counts incoming edges', () => {
    expect(Object.fromEntries(incomingCounts(design))).toEqual({ lb: 1, a: 1, b: 1, c: 2 });
  });

  it('gives clients → entry the offered rate, and other edges the target arrivals split by in-degree', () => {
    const flows = Object.fromEntries(edgeFlows(design, frame()).map((f) => [f.key, f.rps]));
    expect(flows).toEqual({ 'clients->lb': 1000, 'lb->a': 500, 'lb->b': 490, 'a->c': 400, 'b->c': 400 });
  });

  it('lists only failing nodes', () => {
    expect(nodeFailures(frame())).toEqual([
      { nodeId: 'lb', failedRps: 10 },
      { nodeId: 'a', failedRps: 20 },
    ]);
  });
});

describe('spawn rates', () => {
  it('are zero without traffic and grow with the square root of flow', () => {
    expect(spawnRate(0, 1, 100)).toBe(0);
    expect(spawnRate(-5, 1, 100)).toBe(0);
    expect(spawnRate(Number.NaN, 1, 100)).toBe(0);
    expect(spawnRate(400, 1, 100)).toBe(20);
    expect(spawnRate(1600, 1, 100)).toBe(40);
  });

  it('are capped so huge flows do not flood an edge', () => {
    expect(dotRate(1e9, FULL_MOTION)).toBe(FULL_MOTION.maxDotRate);
    expect(markRate(1e9, FULL_MOTION)).toBe(FULL_MOTION.maxMarkRate);
    // At the cap, the dots alive on an edge stay around the per-edge limit.
    expect(FULL_MOTION.maxDotRate * FULL_MOTION.travelSec).toBeLessThanOrEqual(FULL_MOTION.maxDotsPerEdge);
  });

  it('are lower with reduced motion', () => {
    expect(dotRate(5000, REDUCED_MOTION)).toBeLessThan(dotRate(5000, FULL_MOTION));
    expect(markRate(50, REDUCED_MOTION)).toBeLessThan(markRate(50, FULL_MOTION));
  });

  it('run particle time at pace 1 for 4×, 0 when paused, slower in slow motion', () => {
    expect(particlePace(0)).toBe(0);
    expect(particlePace(4)).toBe(1);
    expect(particlePace(16)).toBe(2);
    expect(particlePace(0.25)).toBe(0.25);
  });
});

describe('particle system', () => {
  const rects = { lb: { x: 0, y: 0, width: 200, height: 80 }, a: { x: 300, y: 0, width: 200, height: 80 } };
  const flows = edgeFlows(design, frame());
  const failures = nodeFailures(frame());

  function simulate(seed: number, seconds: number): ParticleSystem {
    const system = new ParticleSystem(seed, FULL_MOTION);
    for (let i = 0; i < seconds * 60; i++) system.update(1 / 60, flows, failures, rects);
    return system;
  }

  it('settles near rate × travel time dots per edge, within the cap', () => {
    const system = simulate(1, 5);
    const expected = dotRate(1000, FULL_MOTION) * FULL_MOTION.travelSec;
    const dots = system.dots.get('clients->lb')!.length;
    expect(dots).toBeGreaterThan(expected * 0.7);
    expect(dots).toBeLessThanOrEqual(FULL_MOTION.maxDotsPerEdge);
    for (const dot of system.dots.get('clients->lb')!) expect(dot.u).toBeLessThan(1);
  });

  it('spawns failure marks only at failing nodes it can place, and retires them', () => {
    const system = simulate(1, 3);
    expect(system.marks.length).toBeGreaterThan(0);
    for (const mark of system.marks) expect(mark.ageSec).toBeLessThan(FULL_MOTION.markLifeSec);
    // Nothing fails any more: every mark retires.
    for (let i = 0; i < 120; i++) system.update(1 / 60, [], [], rects);
    expect(system.marks.length).toBe(0);
    expect(system.dotCount()).toBe(0);
  });

  it('is deterministic for a seed, and reset replays identically', () => {
    const a = simulate(7, 2);
    const b = simulate(7, 2);
    expect([...a.dots.entries()]).toEqual([...b.dots.entries()]);
    expect(a.marks).toEqual(b.marks);
    a.reset();
    for (let i = 0; i < 120; i++) a.update(1 / 60, flows, failures, rects);
    expect(a.marks).toEqual(b.marks);
  });

  it('does nothing for a zero step (paused)', () => {
    const system = new ParticleSystem(1, FULL_MOTION);
    system.update(0, flows, failures, rects);
    expect(system.dotCount()).toBe(0);
  });
});

describe('rng', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
