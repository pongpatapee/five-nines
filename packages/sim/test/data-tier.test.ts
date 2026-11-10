import { describe, expect, it } from 'vitest';
import { REPLICATION } from '../src/catalog.ts';
import { busyLag } from '../src/data-model.ts';
import { simulate } from '../src/simulate.ts';
import { dataDesign, dataLevel, singleServer } from './fixtures.ts';

const last = <T>(items: readonly T[]): T => items[items.length - 1]!;

describe('data tier: the primary', () => {
  it('receives every read and write, and the edge shows the write share', () => {
    const result = simulate(dataLevel(), dataDesign());
    const frame = last(result.timeline);
    expect(frame.nodes['db']).toMatchObject({ readRps: expect.closeTo(900, 6), writeRps: expect.closeTo(100, 6) });
    expect(frame.edges['app->db']).toEqual({ rps: expect.closeTo(1000, 6), writeRps: expect.closeTo(100, 6) });
    expect(frame.edges['clients->app']!.rps).toBeCloseTo(1000, 6);
    expect(result.availability).toBeGreaterThan(0.99999);
  });

  it('charges a write as readsPerSec / writesPerSec reads', () => {
    // small: 2,500 reads or 1,000 writes a second. 900 reads + 100 writes = 0.36 + 0.1.
    const frame = last(simulate(dataLevel(), dataDesign({ database: 'small' })).timeline);
    expect(frame.nodes['db']!.instances[0]!.utilization).toBeCloseTo(0.46, 6);
  });

  it('times requests out at the database when it is overloaded', () => {
    const level = dataLevel({ workload: { traffic: [{ atSec: 0, rps: 5000 }] } });
    const result = simulate(level, dataDesign({ database: 'small' }));
    expect(result.causes.map((cause) => [cause.nodeId, cause.reason])).toEqual([['db', 'timeout']]);
    // 4,500 reads + 500 writes need 1.8 + 0.5 = 2.3 small databases: about 57% fail.
    expect(result.availability).toBeCloseTo(1 / 2.3, 1);
  });

  it('adds the data trip to request latency', () => {
    const withData = simulate(dataLevel(), dataDesign());
    const withoutData = simulate(dataLevel({ workload: { data: undefined } }), singleServer('xlarge'));
    expect(withData.latency.p50Ms!).toBeGreaterThan(withoutData.latency.p50Ms! + 0.5);
  });
});

describe('data tier: caches', () => {
  // 10,000 keys, heavily skewed, all of which fit in the smallest cache.
  const skewed = dataLevel({ data: { keys: { count: 10_000, zipf: 1, valueKb: 1 } } });

  it('serves hits from memory and sends only misses to the database', () => {
    const result = simulate(skewed, dataDesign({ cache: { size: 'small', ttlSec: 3600 } }));
    const frame = last(result.timeline);
    const hitRate = frame.nodes['cache']!.hitRate!;
    expect(hitRate).toBeGreaterThan(0.9);
    expect(frame.nodes['db']!.readRps).toBeCloseTo(900 * (1 - hitRate), 1);
    expect(frame.edges['app->cache']!.rps).toBeCloseTo(900, 6);
    expect(result.dataTier.cacheHitRate['cache']).toBeGreaterThan(0.85);
  });

  it('starts cold and warms up', () => {
    const { timeline } = simulate(skewed, dataDesign({ cache: { size: 'small', ttlSec: 3600 } }));
    expect(timeline[0]!.nodes['cache']!.hitRate!).toBeLessThan(last(timeline).nodes['cache']!.hitRate!);
  });

  it('barely helps when keys are uniform over a large keyspace', () => {
    const uniform = dataLevel({ data: { keys: { count: 100_000_000, zipf: 0, valueKb: 1 } } });
    const result = simulate(uniform, dataDesign({ cache: { size: 'small', ttlSec: 60 } }));
    expect(result.dataTier.cacheHitRate['cache']).toBeLessThan(0.01);
  });

  it('serves stale values when they outlive the staleness limit', () => {
    // 100 hot keys written 100 times a second: a 60 s TTL keeps values long after they change.
    const level = dataLevel({
      requirements: { maxStalenessSec: 1 },
      data: { keys: { count: 100, zipf: 0, valueKb: 1 } },
    });
    const longTtl = simulate(level, dataDesign({ cache: { size: 'small', ttlSec: 60 } }));
    expect(longTtl.causes.map((cause) => [cause.nodeId, cause.reason])).toContainEqual(['cache', 'stale_read']);
    const shortTtl = simulate(level, dataDesign({ cache: { size: 'small', ttlSec: 1 } }));
    expect(shortTtl.causes).toEqual([]);
  });
});

describe('data tier: read replicas', () => {
  it('take the reads, replay the writes, and lag by base ÷ (1 − utilization)', () => {
    const result = simulate(dataLevel(), dataDesign({ replicas: { size: 'small', count: 2 } }));
    const frame = last(result.timeline);
    expect(frame.nodes['db']!.readRps).toBeCloseTo(0, 6);
    expect(frame.nodes['replicas']!.readRps).toBeCloseTo(900, 6);
    expect(frame.edges['db->replicas']).toEqual({ rps: expect.closeTo(100, 6), writeRps: expect.closeTo(100, 6) });
    // Each small replica: 450 reads ÷ 2,500 + 100 writes × replay cost ÷ 1,000.
    const utilization = 450 / 2500 + (100 * REPLICATION.replayCost) / 1000;
    expect(frame.nodes['replicas']!.instances.map((i) => i.utilization)).toEqual([
      expect.closeTo(utilization, 9),
      expect.closeTo(utilization, 9),
    ]);
    expect(frame.nodes['replicas']!.replicationLagSec).toBeCloseTo(busyLag(utilization), 9);
  });

  it('fall ever further behind when overloaded, and log it', () => {
    const level = dataLevel({ workload: { traffic: [{ atSec: 0, rps: 3000 }] } });
    const result = simulate(level, dataDesign({ replicas: { size: 'small', count: 1 } }));
    const lags = result.timeline.map((frame) => frame.nodes['replicas']!.replicationLagSec!);
    expect(last(lags)).toBeGreaterThan(lags[10]! + 5);
    expect(result.events.map((event) => event.kind)).toContain('replicationLagHigh');
    expect(result.dataTier.peakReplicationLagSec['replicas']).toBeCloseTo(last(lags), 1);
  });

  it('serve stale reads beyond the staleness limit only when they lag past it', () => {
    // 1,000 keys written 100 times a second: a key changes every 10 s on average.
    const level = (maxStalenessSec: number) =>
      dataLevel({
        requirements: { maxStalenessSec },
        workload: { traffic: [{ atSec: 0, rps: 2400 }] },
        data: { keys: { count: 1000, zipf: 0, valueKb: 1 } },
      });
    // One small replica: 2,160 ÷ 2,500 + 240 × 0.5 ÷ 1,000 = 98% busy, so about 10 s behind.
    const design = dataDesign({ replicas: { size: 'small', count: 1 } });
    const strict = simulate(level(1), design);
    expect(strict.causes.map((cause) => [cause.nodeId, cause.reason])).toEqual([['replicas', 'stale_read']]);
    expect(simulate(level(30), design).causes).toEqual([]);
  });
});

describe('data tier: read-your-writes', () => {
  const level = dataLevel({ data: { readAfterWrite: { share: 0.2, meanGapSec: 1.5 } } });

  it('fails read-after-write reads served by a lagging replica', () => {
    const result = simulate(level, dataDesign({ replicas: { size: 'small', count: 2 } }));
    const lag = last(result.timeline).nodes['replicas']!.replicationLagSec!;
    expect(result.causes.map((cause) => [cause.nodeId, cause.reason])).toEqual([['replicas', 'stale_read']]);
    // 180 read-after-write reads a second, each stale if its gap is under the lag.
    const expected = 180 * (1 - Math.exp(-lag / 1.5)) * 60;
    expect(result.failedRequests).toBeCloseTo(expected, -1);
  });

  it('pins them to the primary within the window, which then serves them', () => {
    const result = simulate(level, dataDesign({ replicas: { size: 'small', count: 2, readYourWritesSec: 5 } }));
    expect(result.causes).toEqual([]);
    const pinned = 180 * (1 - Math.exp(-5 / 1.5));
    expect(last(result.timeline).nodes['db']!.readRps).toBeCloseTo(pinned, 6);
  });

  it('never fails them when every read goes to the primary', () => {
    expect(simulate(level, dataDesign()).causes).toEqual([]);
  });
});

describe('data tier: determinism', () => {
  it('produces identical results for identical inputs', () => {
    const level = dataLevel({ data: { keys: { count: 50_000, zipf: 0.9, valueKb: 1 }, readAfterWrite: { share: 0.1, meanGapSec: 1 } } });
    const design = dataDesign({ cache: { size: 'small', ttlSec: 60 }, replicas: { size: 'medium', count: 2, readYourWritesSec: 2 } });
    expect(simulate(level, design)).toEqual(simulate(level, design));
  });
});
