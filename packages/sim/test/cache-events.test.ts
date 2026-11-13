/** Caches under stress: restarts, the stampede that follows, coalescing, replication and invalidation on write. */
import { describe, expect, it } from 'vitest';
import { cachedLifetimeSec, cacheHitRate, cacheInFlightRate, keyHitProbability, ZipfKeys } from '../src/data-model.ts';
import { peakLoad } from '../src/peak-load.ts';
import type { CacheSpec, Design, Level } from '../src/schema.ts';
import { simulate } from '../src/simulate.ts';
import { dataDesign, dataLevel } from './fixtures.ts';

describe('cache maths', () => {
  it('only counts a key as cached once its fetch has returned', () => {
    expect(keyHitProbability(0.01, 1000, 100, 6000, 0)).toBeGreaterThan(0.99);
    expect(keyHitProbability(0.01, 1000, 100, 6000, 1000)).toBe(0);
    expect(keyHitProbability(0.01, 1000, 100, 6000, 900)).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('keeps a value until its TTL, or until a write deletes it', () => {
    expect(cachedLifetimeSec(60, 0)).toBe(60);
    expect(cachedLifetimeSec(60, 1)).toBeCloseTo(1, 6);
    expect(cachedLifetimeSec(5, 0.1)).toBeCloseTo((1 - Math.exp(-0.5)) / 0.1, 9);
    // A key read 10 times a second and written once a second hits rL / (1 + rL) of the time.
    const live = 10 * cachedLifetimeSec(60, 1);
    expect(keyHitProbability(1, 1e9, 10, 60, 0, 1)).toBeCloseTo(live / (1 + live), 9);
  });

  it('counts the reads that miss only because a fetch is in flight', () => {
    const keys = new ZipfKeys(10_000, 1);
    const conditions = { keys, capacityKeys: 10_000, readsSoFar: 5_000, readRps: 10_000, ttlSec: 300 };
    expect(cacheInFlightRate(conditions)).toBe(0);
    const lagged = { ...conditions, fillLagReads: 4_000 };
    const instant = cacheHitRate(conditions);
    expect(cacheHitRate(lagged) + cacheInFlightRate(lagged)).toBeCloseTo(instant, 9);
    expect(cacheInFlightRate(lagged)).toBeGreaterThan(0.1);
  });
});

/** 30,000 req/s, 99% reads, skewed over 1M keys that all fit; the cache restarts at 60 s. */
function herdLevel(): Level {
  return dataLevel({
    durationSec: 90,
    workload: { cpuMsPerRequest: 0.1, traffic: [{ atSec: 0, rps: 4_000 }, { atSec: 30, rps: 30_000 }] },
    data: { readShare: 0.99, keys: { count: 1_000_000, zipf: 1.1, valueKb: 1 } },
    events: [{ atSec: 60, kind: 'cacheRestart', target: { kind: 'cache', pick: 'busiest' } }],
  });
}

function herdDesign(database: 'large' | 'xlarge', cache: Partial<CacheSpec>): Design {
  const design = dataDesign({ database, cache: { size: 'small', ttlSec: 300 } });
  const node = design.nodes.find((n) => n.id === 'cache')!;
  Object.assign(node, cache);
  return design;
}

describe('a cache restart', () => {
  it('empties the cache and sends every read to the database: the stampede', () => {
    const result = simulate(herdLevel(), herdDesign('large', {}));
    const before = result.timeline[59]!.nodes['cache']!.hitRate!;
    const after = result.timeline[60]!.nodes['cache']!.hitRate!;
    expect(before).toBeGreaterThan(0.9);
    expect(after).toBeLessThan(0.2);
    expect(result.events.find((event) => event.kind === 'cacheRestarted')).toMatchObject({ atSec: 60, nodeId: 'cache' });
    expect(result.causes[0]).toMatchObject({ nodeId: 'db', reason: 'timeout' });
    expect(result.causes[0]!.firstAtSec).toBeGreaterThanOrEqual(60);
  });

  it('is survived by coalescing misses: reads of a key being fetched wait instead', () => {
    const plain = simulate(herdLevel(), herdDesign('large', {}));
    const coalesced = simulate(herdLevel(), herdDesign('large', { coalesceMisses: true }));
    expect(coalesced.failedRequests).toBeLessThan(plain.failedRequests / 100);
    // Still waiting on some fetches at the end of the restart's second; none once warm.
    expect(coalesced.timeline[60]!.nodes['cache']!.coalescedRate!).toBeGreaterThan(0);
    expect(coalesced.timeline[59]!.nodes['cache']!.coalescedRate!).toBe(0);
    expect(plain.timeline[60]!.nodes['cache']!.coalescedRate!).toBe(0);
  });

  it('is survived by a replicated cache, which takes over warm, at twice the price', () => {
    const result = simulate(herdLevel(), herdDesign('large', { replicated: true }));
    expect(result.timeline[60]!.nodes['cache']!.hitRate!).toBeGreaterThan(0.9);
    expect(result.availability).toBeGreaterThan(0.99999);
    expect(result.events[0]!.message).toMatch(/replica took over/);
  });

  it('is survived by a database big enough for the burst', () => {
    expect(simulate(herdLevel(), herdDesign('xlarge', {})).availability).toBeGreaterThan(0.9999);
  });
});

describe('invalidation on write', () => {
  // Uniform writes over 10,000 keys: each key changes about once every 10 seconds.
  const level = dataLevel({
    workload: { cpuMsPerRequest: 0.1, traffic: [{ atSec: 0, rps: 10_000 }] },
    data: { readShare: 0.9, keys: { count: 10_000, zipf: 0, valueKb: 1 } },
    requirements: { maxStalenessSec: 1 },
  });

  it('never serves a stale hit from the primary, at the cost of more misses', () => {
    const ttl = simulate(level, dataDesign({ cache: { size: 'small', ttlSec: 300 } }));
    const invalidated = simulate(level, herdDesign('large', { invalidateOnWrite: true }));
    expect(ttl.causes.some((cause) => cause.reason === 'stale_read')).toBe(true);
    expect(invalidated.causes.some((cause) => cause.reason === 'stale_read')).toBe(false);
    expect(invalidated.dataTier.cacheHitRate['cache']!).toBeLessThan(ttl.dataTier.cacheHitRate['cache']!);
    const last = invalidated.timeline[invalidated.timeline.length - 1]!;
    // Every write deletes its key: the deletes travel to the cache, drawn as writes.
    expect(last.edges['app->cache']).toEqual({ rps: expect.closeTo(10_000, 3), writeRps: expect.closeTo(1_000, 3) });
    expect(last.nodes['cache']!.staleRps).toBe(0);
    expect(ttl.timeline[ttl.timeline.length - 1]!.nodes['cache']!.staleRps!).toBeGreaterThan(0);
  });

  it('shortens how long values live on paper too', () => {
    const plain = peakLoad(level, dataDesign({ cache: { size: 'small', ttlSec: 300 } })).nodes['cache']!;
    const invalidated = peakLoad(level, herdDesign('large', { invalidateOnWrite: true })).nodes['cache']!;
    expect(invalidated.hitRate!).toBeLessThan(plain.hitRate!);
    expect(invalidated.load).toBeCloseTo(plain.load + 1_000, 6);
  });
});
