import { describe, expect, it } from 'vitest';
import { estimateWorking, isCloseEstimate, workEstimate } from '../src/estimate.ts';
import { getLevel, LEVELS } from '../src/levels/index.ts';
import { peakLoad, peakRps, totalRequests, utilizationZone } from '../src/peak-load.ts';
import type { Design, Level } from '../src/schema.ts';
import { simulate } from '../src/simulate.ts';

const level = (id: string): Level => getLevel(id)!;
const solution = (id: string, index = 0) => level(id).solutions[index]!.design;
const anti = (id: string, name: string) => level(id).antiSolutions.find((a) => a.name === name)!.design;

describe('utilization zones', () => {
  it('splits at 70%, 85% and 100%', () => {
    expect(utilizationZone(0)).toBe('comfortable');
    expect(utilizationZone(0.699)).toBe('comfortable');
    expect(utilizationZone(0.7)).toBe('busy');
    expect(utilizationZone(0.85)).toBe('busy');
    expect(utilizationZone(0.86)).toBe('hot');
    expect(utilizationZone(1)).toBe('hot');
    expect(utilizationZone(1.01)).toBe('overloaded');
    expect(utilizationZone(Infinity)).toBe('overloaded');
  });
});

describe('peak load', () => {
  it('uses the highest traffic point as the peak', () => {
    expect(LEVELS.map(peakRps)).toEqual([350, 5000, 5000, 26000, 20000, 20000, 15000, 30000, 24000, 10000]);
  });

  it('counts the requests in a run like the simulation does', () => {
    for (const lvl of LEVELS) {
      expect(totalRequests(lvl) / simulate(lvl, lvl.solutions[0]!.design).totalRequests, lvl.id).toBeCloseTo(1, 3);
    }
  });

  it('divides an app server load by its capacity (level 1)', () => {
    const medium = peakLoad(level('01-hello-traffic'), anti('01-hello-traffic', 'One medium server')).nodes.app!;
    expect(medium).toMatchObject({ kind: 'appServer', load: 350, capacity: 400, machines: 1, unit: 'requests' });
    expect(medium.utilization).toBeCloseTo(0.875);
    expect(peakLoad(level('01-hello-traffic'), solution('01-hello-traffic')).nodes.app!.utilization).toBeCloseTo(0.4375);
    expect(peakLoad(level('01-hello-traffic'), anti('01-hello-traffic', 'One small server')).nodes.app!.utilization).toBeCloseTo(1.75);
  });

  it('fans a load balancer out evenly per instance, whatever its size (level 2)', () => {
    const four = peakLoad(level('02-scale-out'), solution('02-scale-out'));
    expect(four.nodes.lb!.utilization).toBeCloseTo(0.05);
    expect(four.nodes.app!).toMatchObject({ load: 1250, capacity: 1600, machines: 4 });
    expect(four.afterCrash).toBeNull();
    const mixed = peakLoad(level('02-scale-out'), anti('02-scale-out', 'Three xlarge plus one medium'));
    expect(mixed.nodes.small!.utilization).toBeCloseTo(1250 / 400);
    expect(mixed.nodes.big!.utilization).toBeCloseTo(1250 / 1600);
  });

  it('shows what the scripted crash leaves (level 3)', () => {
    const nPlusOne = peakLoad(level('03-pull-the-plug'), solution('03-pull-the-plug'));
    expect(nPlusOne.nodes.app!.utilization).toBeCloseTo(1000 / 1600);
    expect(nPlusOne.afterCrash!.app!).toMatchObject({ machines: 4, load: 1250 });
    const exact = peakLoad(level('03-pull-the-plug'), anti('03-pull-the-plug', 'Exactly enough servers, with retries'));
    expect(exact.afterCrash!.app!.utilization).toBeCloseTo(5000 / 3 / 1600);
    const single: Design = {
      nodes: [{ id: 'app', kind: 'appServer', size: 'xlarge', instances: 1 }],
      edges: [{ from: 'clients', to: 'app' }],
    };
    expect(peakLoad(level('03-pull-the-plug'), single).afterCrash!.app!.utilization).toBe(Infinity);
  });

  it('takes the warm cache hit rate off the database load (level 4)', () => {
    const load = peakLoad(level('04-read-all-about-it'), solution('04-read-all-about-it')).nodes;
    expect(load.cache!.hitRate!).toBeGreaterThan(0.76);
    expect(load.cache!.hitRate!).toBeLessThan(0.82);
    expect(load.cache!.readRps).toBeCloseTo(24_700);
    expect(load.db!.writeRps).toBeCloseTo(1_300);
    expect(load.db!.readRps).toBeCloseTo(24_700 * (1 - load.cache!.hitRate!));
    expect(load.db!.utilization).toBeGreaterThan(0.8);
    expect(load.db!.utilization).toBeLessThan(1);
    const noCache = peakLoad(level('04-read-all-about-it'), anti('04-read-all-about-it', 'Large database, no cache')).nodes;
    expect(noCache.db!.utilization).toBeCloseTo((24_700 + 1_300 * 2.5) / 10_000);
  });

  it('splits reads over replicas, which also replay every write (level 5)', () => {
    const load = peakLoad(level('05-cache-miss'), solution('05-cache-miss')).nodes;
    expect(load.replicas!).toMatchObject({ machines: 3, readRps: 19_200, writeRps: 800 });
    expect(load.replicas!.utilization).toBeCloseTo(0.74);
    expect(load.db!.utilization).toBeCloseTo((800 * 2.5) / 5_000);
    const two = peakLoad(level('05-cache-miss'), anti('05-cache-miss', 'Two large read replicas')).nodes;
    expect(two.replicas!.utilization).toBeCloseTo(1.06);
    const cache = peakLoad(level('05-cache-miss'), anti('05-cache-miss', 'The biggest cache')).nodes;
    expect(cache.cache!.hitRate!).toBeLessThan(0.03);
  });

  it('sends pinned read-after-write reads to the primary (level 6)', () => {
    const load = peakLoad(level('06-bank-balance'), solution('06-bank-balance')).nodes;
    expect(load.db!.utilization).toBeCloseTo(0.616, 2);
    expect(load.replicas!.utilization).toBeCloseTo(0.89, 2);
    const medium = peakLoad(level('06-bank-balance'), anti('06-bank-balance', 'A medium primary')).nodes;
    expect(medium.db!.utilization).toBeCloseTo(1.23, 2);
  });

  it('agrees with the simulation once traffic settles at the peak', () => {
    for (const [id, nodeId] of [
      ['01-hello-traffic', 'app'],
      ['05-cache-miss', 'replicas'],
      ['06-bank-balance', 'db'],
    ] as const) {
      const lvl = level(id);
      const predicted = peakLoad(lvl, solution(id)).nodes[nodeId]!.utilization;
      const peakFrame = simulate(lvl, solution(id)).timeline.find((frame) => frame.offeredRps >= peakRps(lvl) - 1)!;
      const measured = Math.max(...peakFrame.nodes[nodeId]!.instances.map((instance) => instance.utilization));
      expect(measured, id).toBeCloseTo(predicted, 1);
    }
  });

  it('copes with designs that are still being built', () => {
    const lvl = level('04-read-all-about-it');
    expect(peakLoad(lvl, { nodes: [], edges: [] }).nodes).toEqual({});
    const loose: Design = {
      nodes: [
        { id: 'app', kind: 'appServer', size: 'small', instances: 2 },
        { id: 'db', kind: 'database', size: 'small' },
        { id: 'cache', kind: 'cache', size: 'small', ttlSec: 60 },
      ],
      edges: [
        { from: 'clients', to: 'app' },
        { from: 'app', to: 'cache' },
        { from: 'app', to: 'missing' },
      ],
    };
    const load = peakLoad(lvl, loose).nodes;
    expect(load.app!.utilization).toBeCloseTo(13_000 / 4_000);
    // No database yet: the data tier isn't routed, so nothing reaches the cache or the database.
    expect(load.cache).toBeUndefined();
    expect(load.db).toBeUndefined();
  });
});

describe('estimates', () => {
  it('gives every level a napkin-maths question', () => {
    for (const lvl of LEVELS) expect(lvl.estimate, lvl.id).toBeDefined();
  });

  it.each(LEVELS.map((lvl) => [lvl.id, lvl] as const))("%s records the answer its own numbers give", (_, lvl) => {
    const working = estimateWorking(lvl)!;
    expect(lvl.estimate!.answer).toBeCloseTo(working.result, 1);
  });

  it('works each question out from the workload', () => {
    expect(estimateWorking(level('01-hello-traffic'))!.result).toBe(3.5);
    expect(estimateWorking(level('02-scale-out'))!.result).toBe(50);
    expect(estimateWorking(level('03-pull-the-plug'))).toMatchObject({ perServerRps: 1600, needed: 4, result: 5 });
    expect(estimateWorking(level('04-read-all-about-it'))).toMatchObject({
      readsPerSec: 24_700,
      writesPerSec: 1_300,
      writeCost: 2.5,
      readsLeft: 6_750,
    });
    expect(estimateWorking(level('05-cache-miss'))).toMatchObject({ readsPerSec: 19_200, keys: 100_000_000 });
    expect(estimateWorking(level('05-cache-miss'))!.result).toBeCloseTo(5_208.3, 1);
    expect(estimateWorking(level('06-bank-balance'))).toMatchObject({ freshReadsPerSec: 3_800, writesPerSec: 1_000 });
    expect(estimateWorking(level('06-bank-balance'))!.result).toBeCloseTo(63);
    expect(estimateWorking(level('07-the-write-wall'))!.result).toBe(3.75);
    expect(estimateWorking(level('08-thundering-herd'))).toMatchObject({ atSec: 90, rps: 30_000, readsPerSec: 29_700, result: 2.97 });
    expect(estimateWorking(level('09-stale-prices'))!.result).toBeCloseTo(79.6, 1);
    expect(estimateWorking(level('10-flash-sale'))).toMatchObject({ spikeSec: 30, deadlineSec: 120, result: 2_000 });
  });

  it('checks that the N+1 answer survives the crash in the simulation', () => {
    const lvl = level('03-pull-the-plug');
    const working = workEstimate(lvl, lvl.estimate!);
    if (working.quantity !== 'serversWithSpare') throw new Error('unexpected quantity');
    const after = (instances: number) =>
      peakLoad(lvl, {
        nodes: [
          { id: 'lb', kind: 'loadBalancer', healthCheckIntervalSec: 5, retryOnConnectFailure: true },
          { id: 'app', kind: 'appServer', size: working.size, instances },
        ],
        edges: [
          { from: 'clients', to: 'lb' },
          { from: 'lb', to: 'app' },
        ],
      }).afterCrash!.app!.utilization;
    expect(after(working.result)).toBeLessThanOrEqual(1);
    expect(after(working.result - 1)).toBeGreaterThan(1);
  });

  it('shows the database load the moment the cache restarts empty (level 8)', () => {
    const lvl = level('08-thundering-herd');
    const warm = peakLoad(lvl, anti('08-thundering-herd', 'A large database, unprotected'));
    expect(warm.nodes.db!.utilization).toBeLessThan(0.3);
    // Every read misses: the napkin's reads over the database's capacity, plus the writes on top.
    const reads = estimateWorking(lvl)!.result;
    expect(warm.afterCacheRestart!.db!.utilization).toBeGreaterThan(reads);
    expect(warm.afterCacheRestart!.db!.utilization).toBeCloseTo(3.045, 3);
    expect(warm.afterCacheRestart!.cache!.hitRate).toBe(0);
    // A replicated cache keeps its contents, so the database never sees the burst.
    const replicated = peakLoad(lvl, solution('08-thundering-herd', 1));
    expect(replicated.afterCacheRestart!.db!.utilization).toBeCloseTo(replicated.nodes.db!.utilization);
    // Levels without a restart have no such reading.
    expect(peakLoad(level('04-read-all-about-it'), solution('04-read-all-about-it')).afterCacheRestart).toBeNull();
  });

  it('gives the bonus within 10% either side', () => {
    expect(isCloseEstimate(3.5, 3.5)).toBe(true);
    expect(isCloseEstimate(3.85, 3.5)).toBe(true);
    expect(isCloseEstimate(3.15, 3.5)).toBe(true);
    expect(isCloseEstimate(3.9, 3.5)).toBe(false);
    expect(isCloseEstimate(3.1, 3.5)).toBe(false);
    expect(isCloseEstimate(Number.NaN, 3.5)).toBe(false);
  });
});
