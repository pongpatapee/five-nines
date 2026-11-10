import { CLIENTS_ID, LEVELS, validateDesign } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import {
  addNode,
  balancerBackendCount,
  connect,
  createNodeSpec,
  edgeKey,
  emptyDraft,
  moveNode,
  nextNodeId,
  removeElements,
  replaceNode,
} from '../src/canvas/draft.ts';
import { connectionToEdge, draftToFlowEdges, draftToFlowNodes, flowEdgeToEdge } from '../src/canvas/flow.ts';
import type { Draft } from '../src/canvas/types.ts';

function sampleDraft(): Draft {
  let draft = emptyDraft();
  draft = addNode(draft, createNodeSpec('loadBalancer', 'lb-1'), { x: 300, y: 0 });
  draft = addNode(draft, { id: 'app-1', kind: 'appServer', size: 'large', instances: 3 }, { x: 600, y: -80 });
  draft = addNode(draft, { id: 'app-2', kind: 'appServer', size: 'small', instances: 2 }, { x: 600, y: 80 });
  draft = connect(draft, { from: CLIENTS_ID, to: 'lb-1' });
  draft = connect(draft, { from: 'lb-1', to: 'app-1' });
  draft = connect(draft, { from: 'lb-1', to: 'app-2' });
  return draft;
}

describe('draft operations', () => {
  it('starts with just the clients', () => {
    expect(emptyDraft()).toEqual({ design: { nodes: [], edges: [] }, layout: { [CLIENTS_ID]: { x: 0, y: 0 } } });
  });

  it('creates nodes with the engine defaults and valid ids', () => {
    const level = LEVELS[2]!;
    const draft = sampleDraft();
    expect(createNodeSpec('loadBalancer', 'lb-1')).toEqual({
      id: 'lb-1',
      kind: 'loadBalancer',
      healthCheckIntervalSec: 30,
      retryOnConnectFailure: false,
    });
    expect(validateDesign(draft.design, level).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('numbers new ids per kind, filling gaps', () => {
    const draft = sampleDraft();
    expect(nextNodeId(draft, 'appServer')).toBe('app-3');
    expect(nextNodeId(draft, 'loadBalancer')).toBe('lb-2');
    const gap = removeElements(draft, { nodeIds: ['app-1'], edges: [] });
    expect(nextNodeId(gap, 'appServer')).toBe('app-1');
  });

  it('ignores duplicate edges and self-loops', () => {
    const draft = sampleDraft();
    expect(connect(draft, { from: 'lb-1', to: 'app-1' })).toBe(draft);
    expect(connect(draft, { from: 'app-1', to: 'app-1' })).toBe(draft);
  });

  it('removes nodes with their layout and every attached edge, but never the clients', () => {
    const draft = removeElements(sampleDraft(), { nodeIds: ['lb-1', CLIENTS_ID], edges: [] });
    expect(draft.design.nodes.map((n) => n.id)).toEqual(['app-1', 'app-2']);
    expect(draft.design.edges).toEqual([]);
    expect(draft.layout['lb-1']).toBeUndefined();
    expect(draft.layout[CLIENTS_ID]).toBeDefined();
  });

  it('removes individual edges', () => {
    const draft = removeElements(sampleDraft(), { nodeIds: [], edges: [{ from: 'lb-1', to: 'app-2' }] });
    expect(draft.design.edges.map(edgeKey)).toEqual(['clients->lb-1', 'lb-1->app-1']);
  });

  it('moves nodes, returning the same draft for a no-op move', () => {
    const draft = sampleDraft();
    expect(moveNode(draft, 'lb-1', { x: 300, y: 0 })).toBe(draft);
    expect(moveNode(draft, 'lb-1', { x: 310, y: 20 }).layout['lb-1']).toEqual({ x: 310, y: 20 });
  });

  it('replaces a node by id without touching the others', () => {
    const draft = replaceNode(sampleDraft(), { id: 'app-2', kind: 'appServer', size: 'xlarge', instances: 4 });
    expect(draft.design.nodes[2]).toEqual({ id: 'app-2', kind: 'appServer', size: 'xlarge', instances: 4 });
    expect(draft.design.nodes[1]!.id).toBe('app-1');
  });

  it('counts the instances behind a load balancer', () => {
    expect(balancerBackendCount(sampleDraft(), 'lb-1')).toBe(5);
  });
});

describe('draft ↔ React Flow conversion', () => {
  it('emits the clients node first, undeletable, then every design node with its position', () => {
    const nodes = draftToFlowNodes(sampleDraft());
    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      [CLIENTS_ID, 'clients'],
      ['lb-1', 'loadBalancer'],
      ['app-1', 'appServer'],
      ['app-2', 'appServer'],
    ]);
    expect(nodes[0]!.deletable).toBe(false);
    expect(nodes[2]!.position).toEqual({ x: 600, y: -80 });
  });

  it('passes the spec and backend count as node data', () => {
    const lb = draftToFlowNodes(sampleDraft())[1]!;
    expect(lb.data).toMatchObject({ kind: 'loadBalancer', backendCount: 5 });
  });

  it('marks the selected node or edge', () => {
    const draft = sampleDraft();
    const nodes = draftToFlowNodes(draft, { selection: { kind: 'node', id: 'app-1' } });
    expect(nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(['app-1']);
    const edges = draftToFlowEdges(draft, { selection: { kind: 'edge', edge: { from: 'lb-1', to: 'app-2' } } });
    expect(edges.filter((e) => e.selected).map((e) => e.id)).toEqual(['lb-1->app-2']);
  });

  it('carries measured sizes over so React Flow does not re-measure', () => {
    const nodes = draftToFlowNodes(sampleDraft(), { measured: { 'lb-1': { width: 200, height: 90 } } });
    expect(nodes[1]!.measured).toEqual({ width: 200, height: 90 });
    expect(nodes[2]!.measured).toBeUndefined();
  });

  it('round-trips edges', () => {
    const draft = sampleDraft();
    const edges = draftToFlowEdges(draft);
    expect(edges.map(flowEdgeToEdge)).toEqual(draft.design.edges);
    expect(connectionToEdge({ source: 'a', target: 'b' })).toEqual({ from: 'a', to: 'b' });
  });
});
