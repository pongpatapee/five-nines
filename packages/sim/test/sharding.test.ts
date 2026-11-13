/** Sharded databases: how a shard key spreads the work, and what a hot key does to it. */
import { describe, expect, it } from 'vitest';
import { shardOf, shardShares } from '../src/data-model.ts';
import { peakLoad } from '../src/peak-load.ts';
import type { Design, Level, ShardKey } from '../src/schema.ts';
import { simulate } from '../src/simulate.ts';
import { validateDesign } from '../src/validate.ts';
import { dataLevel } from './fixtures.ts';

const BY_TIME: ShardKey = { id: 'createdAt', label: 'time', spread: { kind: 'sequential' } };
const BY_USER: ShardKey = { id: 'userId', label: 'user ID', spread: { kind: 'hash', count: 50_000_000, zipf: 0.6 } };
const BY_POST: ShardKey = { id: 'postId', label: 'post ID', spread: { kind: 'hash', count: 1_000_000_000, zipf: 0.9 } };
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe('shard shares', () => {
  it('puts every new write on the newest shard when the key only grows', () => {
    expect(shardShares(BY_TIME, 4)).toEqual([0, 0, 0, 1]);
  });

  it('spreads a mildly skewed hashed key evenly, and always adds up to everything', () => {
    for (const count of [2, 5, 16]) {
      const shares = shardShares(BY_USER, count);
      expect(sum(shares)).toBeCloseTo(1, 9);
      for (const share of shares) expect(share).toBeCloseTo(1 / count, 3);
    }
  });

  it("lets popular values pile up on a hashed key's shards", () => {
    const shares = shardShares(BY_POST, 5);
    expect(sum(shares)).toBeCloseTo(1, 9);
    expect(Math.max(...shares)).toBeGreaterThan(0.2);
  });

  it("puts a hot value's whole share on the shard of the most popular value, shrinking the rest", () => {
    const base = shardShares(BY_POST, 5);
    const hot = shardShares(BY_POST, 5, 0.25);
    const shard = shardOf(1, 5);
    expect(sum(hot)).toBeCloseTo(1, 9);
    expect(hot[shard]).toBeCloseTo(base[shard]! * 0.75 + 0.25, 9);
    hot.forEach((share, i) => i !== shard && expect(share).toBeCloseTo(base[i]! * 0.75, 9));
  });

  it('hashes ranks to shards deterministically and within range', () => {
    for (let rank = 1; rank < 200; rank++) {
      const shard = shardOf(rank, 7);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(7);
      expect(shardOf(rank, 7)).toBe(shard);
    }
  });
});

/** Every request writes. Five large shards (4,000 writes a second each) by `shardKey`. */
function writeLevel(events: Level['events'] = []): Level {
  return dataLevel({
    components: ['appServer', 'loadBalancer', 'database', 'readReplicas', 'shards'],
    workload: { cpuMsPerRequest: 0.1, traffic: [{ atSec: 0, rps: 15_000 }] },
    data: { readShare: 0, keys: { count: 1_000_000_000, zipf: 0.9, valueKb: 1 }, shardKeys: [BY_TIME, BY_POST, BY_USER] },
    events,
  });
}

function sharded(shardKey: string, count = 5): Design {
  return {
    nodes: [
      { id: 'app', kind: 'appServer', size: 'xlarge', instances: 1 },
      { id: 'shards', kind: 'shards', size: 'large', count, shardKey },
    ],
    edges: [
      { from: 'clients', to: 'app' },
      { from: 'app', to: 'shards' },
    ],
  };
}

describe('sharded databases in the simulation', () => {
  it('splits writes over the shards, and costs them like databases', () => {
    const level = writeLevel();
    expect(validateDesign(sharded('userId'), level)).toEqual([]);
    const result = simulate(level, sharded('userId'));
    const frame = result.timeline[result.timeline.length - 1]!.nodes['shards']!;
    expect(frame.instances).toHaveLength(5);
    // 3,000 writes on a 4,000-write shard.
    for (const shard of frame.instances) expect(shard.utilization).toBeCloseTo(0.75, 2);
    expect(frame.shardShares).toHaveLength(5);
    expect(result.availability).toBeGreaterThan(0.99999);
  });

  it('overloads the newest shard when the key only grows, and leaves the rest idle', () => {
    const result = simulate(writeLevel(), sharded('createdAt'));
    const shards = result.timeline[10]!.nodes['shards']!.instances;
    expect(shards[4]!.utilization).toBeCloseTo(3.75, 2);
    expect(shards.slice(0, 4).every((shard) => shard.utilization === 0)).toBe(true);
    expect(result.causes[0]).toMatchObject({ nodeId: 'shards', reason: 'timeout' });
  });

  it('sends a hot key to one shard only when sharded by that key', () => {
    const events: Level['events'] = [
      { atSec: 20, kind: 'hotKey', untilSec: 40, shardKey: 'postId', share: 0.25, label: 'a post' },
    ];
    const byPost = simulate(writeLevel(events), sharded('postId'));
    const byUser = simulate(writeLevel(events), sharded('userId'));
    const busiest = (frame: (typeof byPost.timeline)[number]) =>
      Math.max(...frame.nodes['shards']!.instances.map((shard) => shard.utilization));
    expect(busiest(byPost.timeline[30]!)).toBeGreaterThan(1.4);
    expect(busiest(byPost.timeline[50]!)).toBeLessThan(0.85);
    expect(busiest(byUser.timeline[30]!)).toBeCloseTo(0.75, 2);
    expect(byPost.events.map((event) => event.kind)).toEqual(['hotKeyStarted', 'hotKeyEnded']);
    expect(byPost.events[0]!.atSec).toBe(20);
    expect(byPost.causes[0]).toMatchObject({ nodeId: 'shards', reason: 'timeout' });
    expect(byUser.availability).toBeGreaterThan(0.99999);
  });

  it('works out the busiest shard on paper, and again during the hot key', () => {
    const events: Level['events'] = [
      { atSec: 20, kind: 'hotKey', untilSec: 40, shardKey: 'postId', share: 0.25, label: 'a post' },
    ];
    const load = peakLoad(writeLevel(events), sharded('postId'));
    const shards = load.nodes['shards']!;
    expect(shards).toMatchObject({ kind: 'shards', machines: 5, unit: 'reads', writeRps: 15_000 });
    expect(shards.hottestShard).toBe(shards.shardShares!.indexOf(Math.max(...shards.shardShares!)));
    expect(shards.utilization).toBeCloseTo((15_000 * 2.5 * shards.shardShares![shards.hottestShard!]!) / 10_000, 9);
    expect(load.duringHotKey!['shards']!.utilization).toBeGreaterThan(1.4);
  });

  it('needs a shard key the level offers, and keeps replicas to plain databases', () => {
    const level = writeLevel();
    expect(validateDesign(sharded('colour'), level).map((issue) => issue.code)).toEqual(['unknown_shard_key']);
    const withReplicas = sharded('userId');
    withReplicas.nodes.push({ id: 'replicas', kind: 'readReplicas', size: 'large', count: 2, readYourWritesSec: 0 });
    withReplicas.edges.push({ from: 'shards', to: 'replicas' }, { from: 'app', to: 'replicas' });
    const codes = validateDesign(withReplicas, level).map((issue) => issue.code);
    expect(codes).toContain('unexpected_outgoing');
    expect(codes).toContain('replica_mismatch');
  });

  it('allows one database: a single one, or one set of shards', () => {
    const both = sharded('userId');
    both.nodes.push({ id: 'db', kind: 'database', size: 'large' });
    both.edges.push({ from: 'app', to: 'db' });
    const codes = validateDesign(both, writeLevel()).map((issue) => issue.code);
    expect(codes).toContain('multiple_databases');
    expect(codes).toContain('duplicate_data_target');
  });
});
