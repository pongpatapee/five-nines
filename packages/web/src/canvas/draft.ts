/**
 * Pure, immutable operations on a `Draft`. The canvas emits intents (move, connect, delete); the editor decides
 * whether to apply them and uses these helpers to do so. None of them validate the design: that's
 * `validateDesign`'s job, so the player can build invalid intermediate states.
 */
import { CLIENTS_ID, edgeKey as engineEdgeKey, type ComponentKind, type Edge, type NodeSpec } from '@five-nines/sim';
import { COMPONENTS } from '../components/registry.ts';
import type { DeleteRequest, Draft, XY } from './types.ts';

/** The starting draft of every level: just the clients node. */
export function emptyDraft(): Draft {
  return { design: { nodes: [], edges: [] }, layout: { [CLIENTS_ID]: { x: 0, y: 0 } } };
}

/**
 * Stable React Flow id for an edge. Node ids can't contain ">", so this is unambiguous. The same key the engine uses
 * for per-edge flows in its timeline.
 */
export const edgeKey: (edge: Edge) => string = engineEdgeKey;

export function sameEdge(a: Edge, b: Edge): boolean {
  return a.from === b.from && a.to === b.to;
}

/** The next free id for a new component: `app-1`, `app-2`, …, `lb-1`, … (prefixes from the component registry). */
export function nextNodeId(draft: Draft, kind: ComponentKind): string {
  const taken = new Set(draft.design.nodes.map((node) => node.id));
  for (let n = 1; ; n++) {
    const id = `${COMPONENTS[kind].idPrefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A new component with the engine's defaults. */
export function createNodeSpec(kind: ComponentKind, id: string): NodeSpec {
  return COMPONENTS[kind].create(id);
}

export function addNode(draft: Draft, node: NodeSpec, position: XY): Draft {
  return {
    design: { ...draft.design, nodes: [...draft.design.nodes, node] },
    layout: { ...draft.layout, [node.id]: position },
  };
}

/** Replaces the node with `node.id`. Changing a node's kind is allowed (it's a full replacement). */
export function replaceNode(draft: Draft, node: NodeSpec): Draft {
  return {
    ...draft,
    design: { ...draft.design, nodes: draft.design.nodes.map((n) => (n.id === node.id ? node : n)) },
  };
}

export function moveNode(draft: Draft, id: string, position: XY): Draft {
  const current = draft.layout[id];
  if (current && current.x === position.x && current.y === position.y) return draft;
  return { ...draft, layout: { ...draft.layout, [id]: position } };
}

/** Adds an edge unless the same edge already exists or it would be a self-loop. */
export function connect(draft: Draft, edge: Edge): Draft {
  if (edge.from === edge.to || draft.design.edges.some((e) => sameEdge(e, edge))) return draft;
  return { ...draft, design: { ...draft.design, edges: [...draft.design.edges, { from: edge.from, to: edge.to }] } };
}

/** Removes nodes (with their layout and every edge touching them) and edges. The clients node is never removed. */
export function removeElements(draft: Draft, request: DeleteRequest): Draft {
  const nodeIds = new Set(request.nodeIds.filter((id) => id !== CLIENTS_ID));
  if (nodeIds.size === 0 && request.edges.length === 0) return draft;
  const layout = { ...draft.layout };
  for (const id of nodeIds) delete layout[id];
  return {
    design: {
      nodes: draft.design.nodes.filter((node) => !nodeIds.has(node.id)),
      edges: draft.design.edges.filter(
        (edge) => !nodeIds.has(edge.from) && !nodeIds.has(edge.to) && !request.edges.some((e) => sameEdge(e, edge)),
      ),
    },
    layout,
  };
}

/**
 * Instances a load balancer can route to: the total instance count of the app servers it connects to.
 * The denominator of "N/M in rotation".
 */
export function balancerBackendCount(draft: Draft, balancerId: string): number {
  const byId = new Map(draft.design.nodes.map((node) => [node.id, node]));
  let total = 0;
  for (const edge of draft.design.edges) {
    if (edge.from !== balancerId) continue;
    const target = byId.get(edge.to);
    if (target?.kind === 'appServer') total += target.instances;
  }
  return total;
}
