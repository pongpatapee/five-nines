import { CLIENTS_ID, type Design } from '@five-nines/sim';
import type { Draft, XY } from './types.ts';

/** Width of every node on the canvas, in flow units. Matches `--node-width` and the node CSS. */
export const NODE_WIDTH = 200;
/** Typical node height (without live stats), used to centre columns. */
export const NODE_HEIGHT = 84;
/** Horizontal distance between the left edges of adjacent layers. */
export const COLUMN_GAP = NODE_WIDTH + 110;
/** Vertical distance between the top edges of nodes in the same layer. */
export const ROW_GAP = 170;

/**
 * Layered left-to-right layout. The clients sit in layer 0 at the origin, and every other node sits in the layer of
 * its longest path from the clients, so every edge points rightwards (read replicas sit right of the database they
 * copy, even though the app servers also connect to them). Edges that close a cycle are ignored for this. Nodes that
 * can't be reached from the clients go in one extra layer at the end. Each layer is ordered by discovery (which
 * follows edge order) and centred vertically on y = 0, so the result is deterministic for a given design.
 *
 * An edge that skips layers (the app servers' reads going straight to read replicas, past the database) keeps a lane
 * clear for itself: each layer it skips reserves a row level with the edge's source, and that layer's nodes move up
 * out of its way. Without this the edge would run straight behind the node it skips.
 *
 * Returns top-left positions for the clients node and every node in the design.
 */
export function autoLayout(design: Design): Record<string, XY> {
  const ids = new Set(design.nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of design.edges) {
    if (edge.to === CLIENTS_ID || !ids.has(edge.to)) continue;
    if (edge.from !== CLIENTS_ID && !ids.has(edge.from)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  // Breadth-first from the clients finds the reachable nodes, in a deterministic order.
  const order: string[] = [CLIENTS_ID];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    for (const next of outgoing.get(order[i]!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
    }
  }

  // Depth-first from the clients: the reverse postorder is a topological order of the edges that don't close a cycle.
  const open = new Set<string>();
  const done = new Set<string>();
  const backEdges = new Set<string>();
  const postorder: string[] = [];
  const visit = (id: string): void => {
    open.add(id);
    for (const next of outgoing.get(id) ?? []) {
      if (open.has(next)) backEdges.add(`${id}->${next}`);
      else if (!done.has(next)) visit(next);
    }
    open.delete(id);
    done.add(id);
    postorder.push(id);
  };
  visit(CLIENTS_ID);

  const depth = new Map<string, number>([[CLIENTS_ID, 0]]);
  for (const id of postorder.reverse()) {
    for (const next of outgoing.get(id) ?? []) {
      if (backEdges.has(`${id}->${next}`)) continue;
      depth.set(next, Math.max(depth.get(next) ?? 0, depth.get(id)! + 1));
    }
  }

  const maxDepth = Math.max(...depth.values());
  for (const node of design.nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, maxDepth + 1);
      order.push(node.id);
    }
  }

  const layers = new Map<number, string[]>();
  for (const id of order) {
    const d = depth.get(id)!;
    const layer = layers.get(d) ?? [];
    layer.push(id);
    layers.set(d, layer);
  }

  // The lanes of edges that skip layers: for each layer skipped, the source whose row the lane keeps clear.
  const lanes = new Map<number, string[]>();
  for (const [from, targets] of outgoing) {
    for (const to of new Set(targets)) {
      if (backEdges.has(`${from}->${to}`) || !depth.has(from)) continue;
      for (let d = depth.get(from)! + 1; d < depth.get(to)!; d++) {
        const sources = lanes.get(d) ?? [];
        if (!sources.includes(from)) sources.push(from);
        lanes.set(d, sources);
      }
    }
  }

  // Layers in order, so a lane's source is placed before the layers it skips. A layer with lanes stacks its nodes
  // above them, its first lane level with that lane's source; any other layer is centred on y = 0.
  const layout: Record<string, XY> = {};
  for (const d of [...layers.keys()].sort((a, b) => a - b)) {
    const nodes = layers.get(d)!;
    const sources = lanes.get(d) ?? [];
    const rows = nodes.length + sources.length;
    const top = sources.length > 0 ? layout[sources[0]!]!.y - nodes.length * ROW_GAP : (-(rows - 1) / 2) * ROW_GAP;
    nodes.forEach((id, i) => {
      layout[id] = { x: d * COLUMN_GAP, y: top + i * ROW_GAP };
    });
  }
  return layout;
}

/** A draft for a design with no saved positions, e.g. a reference solution. */
export function draftFromDesign(design: Design): Draft {
  return { design, layout: autoLayout(design) };
}

/**
 * Fills in positions for nodes (and the clients) that have none, using `autoLayout`'s positions for them, and drops
 * positions of nodes that no longer exist. Returns the same object when nothing changes.
 */
export function completeLayout(draft: Draft): Draft {
  const ids = [CLIENTS_ID, ...draft.design.nodes.map((node) => node.id)];
  const missing = ids.filter((id) => !draft.layout[id]);
  const stale = Object.keys(draft.layout).filter((id) => !ids.includes(id));
  if (missing.length === 0 && stale.length === 0) return draft;

  const auto = missing.length > 0 ? autoLayout(draft.design) : {};
  const layout: Record<string, XY> = {};
  for (const id of ids) layout[id] = draft.layout[id] ?? auto[id]!;
  return { ...draft, layout };
}
