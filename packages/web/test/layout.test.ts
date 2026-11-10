import { CLIENTS_ID, LEVELS, type Design } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import { autoLayout, COLUMN_GAP, completeLayout, draftFromDesign, ROW_GAP } from '../src/canvas/layout.ts';

const lbDesign: Design = {
  nodes: [
    { id: 'lb', kind: 'loadBalancer', healthCheckIntervalSec: 5, retryOnConnectFailure: true },
    { id: 'a', kind: 'appServer', size: 'large', instances: 2 },
    { id: 'b', kind: 'appServer', size: 'large', instances: 2 },
  ],
  edges: [
    { from: CLIENTS_ID, to: 'lb' },
    { from: 'lb', to: 'a' },
    { from: 'lb', to: 'b' },
  ],
};

describe('autoLayout', () => {
  it('puts the clients at the origin and each node in the layer of its depth', () => {
    const layout = autoLayout(lbDesign);
    expect(layout[CLIENTS_ID]).toEqual({ x: 0, y: 0 });
    expect(layout.lb).toEqual({ x: COLUMN_GAP, y: 0 });
    expect(layout.a!.x).toBe(2 * COLUMN_GAP);
    expect(layout.b!.x).toBe(2 * COLUMN_GAP);
  });

  it('centres each layer vertically, in edge order', () => {
    const layout = autoLayout(lbDesign);
    expect(layout.a!.y).toBe(-ROW_GAP / 2);
    expect(layout.b!.y).toBe(ROW_GAP / 2);
  });

  it('places unreachable nodes in one extra layer after the reachable ones', () => {
    const layout = autoLayout({
      nodes: [
        { id: 'app', kind: 'appServer', size: 'small', instances: 1 },
        { id: 'orphan', kind: 'appServer', size: 'small', instances: 1 },
      ],
      edges: [{ from: CLIENTS_ID, to: 'app' }],
    });
    expect(layout.app!.x).toBe(COLUMN_GAP);
    expect(layout.orphan!.x).toBe(2 * COLUMN_GAP);
  });

  it('survives cycles, self-loops and edges to unknown nodes', () => {
    const layout = autoLayout({
      nodes: [
        { id: 'a', kind: 'appServer', size: 'small', instances: 1 },
        { id: 'b', kind: 'appServer', size: 'small', instances: 1 },
      ],
      edges: [
        { from: CLIENTS_ID, to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'a', to: 'a' },
        { from: 'a', to: 'ghost' },
        { from: 'a', to: CLIENTS_ID },
      ],
    });
    expect(Object.keys(layout).sort()).toEqual(['a', 'b', CLIENTS_ID].sort());
    expect(layout.b!.x).toBe(2 * COLUMN_GAP);
  });

  it('lays out the empty design as just the clients', () => {
    expect(autoLayout({ nodes: [], edges: [] })).toEqual({ [CLIENTS_ID]: { x: 0, y: 0 } });
  });

  it('gives every reference solution a position for every node, without overlaps', () => {
    for (const level of LEVELS) {
      for (const solution of level.solutions) {
        const layout = autoLayout(solution.design);
        const ids = [CLIENTS_ID, ...solution.design.nodes.map((n) => n.id)];
        expect(Object.keys(layout).sort()).toEqual(ids.sort());
        const spots = new Set(Object.values(layout).map((p) => `${p.x},${p.y}`));
        expect(spots.size).toBe(ids.length);
      }
    }
  });
});

describe('completeLayout', () => {
  it('returns the same draft when every node has a position', () => {
    const draft = draftFromDesign(lbDesign);
    expect(completeLayout(draft)).toBe(draft);
  });

  it('fills only missing positions and keeps existing ones', () => {
    const draft = { design: lbDesign, layout: { [CLIENTS_ID]: { x: 7, y: 9 }, lb: { x: 100, y: 100 } } };
    const completed = completeLayout(draft);
    expect(completed.layout[CLIENTS_ID]).toEqual({ x: 7, y: 9 });
    expect(completed.layout.lb).toEqual({ x: 100, y: 100 });
    expect(completed.layout.a).toEqual(autoLayout(lbDesign).a);
  });

  it('drops positions of nodes that no longer exist', () => {
    const draft = { design: { nodes: [], edges: [] }, layout: { [CLIENTS_ID]: { x: 0, y: 0 }, gone: { x: 1, y: 1 } } };
    expect(completeLayout(draft).layout).toEqual({ [CLIENTS_ID]: { x: 0, y: 0 } });
  });
});
