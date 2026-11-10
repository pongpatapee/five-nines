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
 * its shortest distance from the clients. Nodes that can't be reached from the clients go in one extra layer at the
 * end. Each layer is centred vertically on y = 0, ordered by discovery (which follows edge order), so the result is
 * deterministic for a given design.
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

  // Breadth-first from the clients gives each reachable node its shortest depth.
  const depth = new Map<string, number>([[CLIENTS_ID, 0]]);
  const order: string[] = [CLIENTS_ID];
  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    for (const next of outgoing.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(id)! + 1);
      order.push(next);
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

  const layout: Record<string, XY> = {};
  for (const [d, layer] of layers) {
    layer.forEach((id, i) => {
      layout[id] = { x: d * COLUMN_GAP, y: (i - (layer.length - 1) / 2) * ROW_GAP };
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
