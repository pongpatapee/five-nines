/**
 * Chapter 3 in the UI: new components get level-aware defaults, the inspector's arithmetic covers shards, queues and
 * the payment provider, playback blends their readouts, and the mentor's failure story names the hot shard, the
 * cache restart and the payment failures.
 */
import { evaluateDesign, getLevel, peakLoad, type Design, type Level, type TimelineFrame } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import { addNode, createNodeSpec, emptyDraft } from '../src/canvas/draft.ts';
import { draftToFlowEdges } from '../src/canvas/flow.ts';
import { working } from '../src/editor/ExpectedLoad.tsx';
import type { GradedEvaluation } from '../src/engine/index.ts';
import { sampleFrame } from '../src/playback/series.ts';
import { failureStory, hottestShard, verdictFor } from '../src/theme/situations.ts';

const writeWall = getLevel('07-the-write-wall')!;
const herd = getLevel('08-thundering-herd')!;
const flashSale = getLevel('10-flash-sale')!;

function graded(level: Level, design: Design): GradedEvaluation {
  const evaluation = evaluateDesign(level, design);
  if (evaluation.status !== 'graded') throw new Error(`${level.id}: design should grade`);
  return evaluation;
}
const anti = (level: Level, name: string) => level.antiSolutions.find((a) => a.name === name)!.design;
const story = (level: Level, name: string) => failureStory(level, anti(level, name), graded(level, anti(level, name)));

describe('new components', () => {
  it("defaults a sharded database to the level's first shard key", () => {
    expect(createNodeSpec('shards', 'shards-1', writeWall)).toMatchObject({ kind: 'shards', shardKey: 'createdAt', count: 4 });
    expect(createNodeSpec('shards', 'shards-1')).toMatchObject({ shardKey: '' });
  });

  it('draws the edges out of a queue as async', () => {
    let draft = addNode(emptyDraft(), createNodeSpec('queue', 'queue-1'), { x: 0, y: 0 });
    draft = addNode(draft, createNodeSpec('paymentProvider', 'payments-1'), { x: 300, y: 0 });
    draft = addNode(draft, createNodeSpec('appServer', 'app-1'), { x: -300, y: 0 });
    draft = {
      ...draft,
      design: { ...draft.design, edges: [{ from: 'app-1', to: 'queue-1' }, { from: 'queue-1', to: 'payments-1' }] },
    };
    expect(draftToFlowEdges(draft).map((edge) => edge.data?.async)).toEqual([false, true]);
  });
});

describe('expected load', () => {
  it('shows the hottest shard, during the hot key too', () => {
    const design = anti(writeWall, 'Shards by post ID');
    const load = peakLoad(writeWall, design);
    const id = design.nodes.find((node) => node.kind === 'shards')!.id;
    expect(working(load.nodes[id]!)).toMatch(/^15,000 writes × 2\.5 = 37,500 · shard \d gets \d+% = [\d,]+ of 10,000 reads\/s$/);
    expect(load.duringHotKey?.[id]!.utilization).toBeGreaterThan(1);
  });

  it('works the queue against its deadline, and the provider against its limit', () => {
    const design = flashSale.solutions[0]!.design;
    const load = peakLoad(flashSale, design);
    const queue = design.nodes.find((node) => node.kind === 'queue')!.id;
    const provider = design.nodes.find((node) => node.kind === 'paymentProvider')!.id;
    expect(working(load.nodes[queue]!)).toMatch(/^10,000 orders\/s in at the peak, 2,200\/s charged · backlog up to [\d,]+ of 1,000,000 · oldest waits \d+ s of 120 s$/);
    expect(working(load.nodes[provider]!)).toBe('2,200 calls/s ÷ 2,500 calls/s allowed');
  });
});

describe('playback', () => {
  it('blends shard shares between seconds', () => {
    const frame = (atSec: number, shares: number[]): TimelineFrame => ({
      atSec,
      offeredRps: 1,
      failedRps: 0,
      p99Ms: 1,
      nodes: { shards: { arrivalRps: 1, failedRps: 0, instances: [], shardShares: shares } },
      edges: {},
    });
    const live = sampleFrame([frame(0, [0.5, 0.5]), frame(1, [0.9, 0.1])], 1);
    expect(live!.nodes.shards!.shardShares![0]).toBeCloseTo(0.7);
    expect(hottestShard([0.25, 0.25, 0.5])).toEqual({ index: 2, share: 0.5, hot: true });
    expect(hottestShard([0.26, 0.24, 0.25, 0.25])?.hot).toBe(false);
  });
});

describe('failure stories', () => {
  it('names the hot shard', () => {
    expect(story(writeWall, 'Shards by post ID')).toMatchObject({ topic: 'overload', hotShard: { count: 5 } });
    expect(story(writeWall, 'Shards by time posted')).toMatchObject({ hotShard: { index: 4, share: 1 } });
    expect(story(writeWall, 'The biggest database')).toMatchObject({ topic: 'overload', hotShard: null });
  });

  it('blames the cache restart for the herd', () => {
    expect(story(herd, 'A large database, unprotected')).toMatchObject({ topic: 'overload', cacheRestartAtSec: 90 });
    expect(story(herd, 'No cache, the biggest database')).toMatchObject({ cacheRestartAtSec: null });
  });

  it('tells the payment failures apart', () => {
    expect(story(flashSale, 'Charge while the customer waits')).toMatchObject({
      topic: 'rateLimit',
      rateLimitRps: 2500,
      peakCallsRps: 10_000,
    });
    expect(story(flashSale, 'Workers for normal traffic')).toMatchObject({ topic: 'deadline', workers: 10, deadlineSec: 120 });
    expect(story(flashSale, 'A 100,000-message queue')).toMatchObject({ topic: 'queueFull', maxDepth: 100_000 });
    const lost = graded(flashSale, anti(flashSale, 'A 100,000-message queue'));
    expect(verdictFor(lost)).toMatchObject({ kind: 'availability', lostOrders: true });
  });
});
