import type { Design } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import type { LiveFrame } from '../../src/canvas/types.ts';
import {
  dotRate,
  edgeFlows,
  FULL_MOTION,
  markRate,
  nodeFailures,
  particlePace,
  REDUCED_MOTION,
  spawnRate,
} from '../../src/playback/flows.ts';
import { ParticleSystem } from '../../src/playback/particles.ts';
import { createRng } from '../../src/playback/rng.ts';

// clients → lb → (a, b) → c. Not a real topology, but exercises shared targets.
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

const node = (arrivalRps: number, failedRps = 0) => ({ arrivalRps, failedRps, instances: [] });

function frame(): LiveFrame {
  return {
    atSec: 0,
    offeredRps: 1000,
    failedRps: 30,
    nodes: { lb: node(990, 10), a: node(500, 20), b: node(490), c: node(800) },
    edges: {
      'clients->lb': { rps: 1000, writeRps: 0 },
      'lb->a': { rps: 500, writeRps: 0 },
      'lb->b': { rps: 490, writeRps: 0 },
      'a->c': { rps: 480, writeRps: 120 },
      'b->c': { rps: 320, writeRps: 40 },
    },
  };
}

describe('edge flows', () => {
  it("carries the engine's per-edge rates, writes included", () => {
    const flows = Object.fromEntries(edgeFlows(design, frame()).map((f) => [f.key, [f.rps, f.writeRps]]));
    expect(flows).toEqual({
      'clients->lb': [1000, 0],
      'lb->a': [500, 0],
      'lb->b': [490, 0],
      'a->c': [480, 120],
      'b->c': [320, 40],
    });
  });

  it('gives edges the frame does not know about no traffic', () => {
    const flows = edgeFlows(design, { ...frame(), edges: {} });
    expect(flows.every((flow) => flow.rps === 0 && flow.writeRps === 0)).toBe(true);
  });

  it('lists only failing nodes', () => {
    expect(nodeFailures(frame())).toEqual([
      { nodeId: 'lb', failedRps: 10 },
      { nodeId: 'a', failedRps: 20 },
    ]);
  });

  it('ignores the vanishing failure rates the engine reports for busy but healthy nodes', () => {
    const busy = { ...frame(), nodes: { a: node(500, 1e-100), b: node(490, 0.49), c: node(800, 0.5) } };
    expect(nodeFailures(busy)).toEqual([{ nodeId: 'c', failedRps: 0.5 }]);
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

  it('colours dots as writes in proportion to the write share', () => {
    const system = simulate(3, 5);
    const dots = system.dots.get('a->c')!;
    const writes = dots.filter((dot) => dot.write).length;
    expect(writes).toBeGreaterThan(0);
    expect(writes).toBeLessThan(dots.length);
    expect(system.dots.get('clients->lb')!.some((dot) => dot.write)).toBe(false);
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
