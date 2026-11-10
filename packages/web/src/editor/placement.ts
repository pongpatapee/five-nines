/**
 * Where new components go. Pure geometry in flow coordinates, so it can be unit tested without React Flow.
 */
import { CLIENTS_ID, type ComponentKind } from '@five-nines/sim';
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH } from '../canvas/layout.ts';
import type { Draft, Rect, XY } from '../canvas/types.ts';

/** Matches the canvas snap grid, so added nodes line up with dragged ones. */
export const GRID = 10;
/** Empty space kept around existing nodes when looking for a free spot. */
export const PLACEMENT_MARGIN = 30;
/** Inset from the visible edges of the canvas, so new nodes don't touch the border. */
export const VIEW_PADDING = 24;
/** Distance between candidate positions. */
const SEARCH_STEP = 20;

export function snapToGrid(point: XY): XY {
  return { x: Math.round(point.x / GRID) * GRID, y: Math.round(point.y / GRID) * GRID };
}

/** The top-left position that centres a new node on `point` (e.g. the drop point of a palette drag). */
export function centeredAt(point: XY): XY {
  return snapToGrid({ x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 });
}

/**
 * Where a new component would naturally sit in the left-to-right flow: a load balancer one column right of the
 * clients, an app server one column right of the rightmost load balancer (or of the clients when there is none).
 * Vertically aligned with the clients.
 */
export function preferredPosition(draft: Draft, kind: ComponentKind): XY {
  const clients = draft.layout[CLIENTS_ID] ?? { x: 0, y: 0 };
  let leftOf = clients.x;
  if (kind === 'appServer') {
    for (const node of draft.design.nodes) {
      const position = draft.layout[node.id];
      if (node.kind === 'loadBalancer' && position) leftOf = Math.max(leftOf, position.x);
    }
  }
  return { x: leftOf + COLUMN_GAP, y: clients.y };
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

/** Whether `inner` lies entirely inside `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export interface FreeSpotOptions {
  /** Where the node would ideally go (top-left). */
  preferred: XY;
  /** The visible part of the canvas, in flow coordinates. */
  view: Rect;
  /** Boxes of the nodes already on the canvas. */
  occupied: readonly Rect[];
  /** Size of the node being placed. */
  size?: { width: number; height: number };
}

/**
 * The free position (top-left, grid-snapped) closest to `preferred` that is fully in view and keeps
 * `PLACEMENT_MARGIN` clear of every occupied box. Horizontal distance counts double, so nodes stack into the
 * preferred column before spilling into neighbouring ones.
 *
 * When nothing fits (a crowded or tiny view), returns the spot nearest `preferred` inside the view, overlapping or
 * not: the player can always drag it somewhere better.
 */
export function findFreeSpot({ preferred, view, occupied, size = { width: NODE_WIDTH, height: NODE_HEIGHT } }: FreeSpotOptions): XY {
  const area: Rect = {
    x: view.x + VIEW_PADDING,
    y: view.y + VIEW_PADDING,
    width: Math.max(0, view.width - 2 * VIEW_PADDING - size.width),
    height: Math.max(0, view.height - 2 * VIEW_PADDING - size.height),
  };
  const clamp = (point: XY): XY => ({
    x: Math.min(Math.max(point.x, area.x), area.x + area.width),
    y: Math.min(Math.max(point.y, area.y), area.y + area.height),
  });
  const start = snapToGrid(clamp(preferred));

  // Candidates on a grid through the (clamped) preferred spot, covering the whole visible area.
  let best: XY | null = null;
  let bestScore = Infinity;
  const iMin = Math.ceil((area.x - start.x) / SEARCH_STEP);
  const iMax = Math.floor((area.x + area.width - start.x) / SEARCH_STEP);
  const jMin = Math.ceil((area.y - start.y) / SEARCH_STEP);
  const jMax = Math.floor((area.y + area.height - start.y) / SEARCH_STEP);
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const candidate = { x: start.x + i * SEARCH_STEP, y: start.y + j * SEARCH_STEP };
      const dx = candidate.x - preferred.x;
      const dy = candidate.y - preferred.y;
      const score = 4 * dx * dx + dy * dy;
      if (score >= bestScore) continue;
      const box = { ...candidate, ...size };
      if (occupied.some((rect) => rectsOverlap(box, rect, PLACEMENT_MARGIN))) continue;
      best = candidate;
      bestScore = score;
    }
  }
  return best ?? start;
}

/**
 * Boxes of every node in the draft: measured boxes where the canvas has them, otherwise the layout position with
 * the default node size.
 */
export function occupiedRects(draft: Draft, measured: Readonly<Record<string, Rect>>): Rect[] {
  const ids = [CLIENTS_ID, ...draft.design.nodes.map((node) => node.id)];
  const rects: Rect[] = [];
  for (const id of ids) {
    const rect = measured[id];
    const position = draft.layout[id];
    if (rect) rects.push(rect);
    else if (position) rects.push({ ...position, width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  return rects;
}

/** The visible part of the canvas in flow coordinates, from React Flow's viewport and the canvas size. */
export function visibleFlowRect(viewport: { x: number; y: number; zoom: number }, size: { width: number; height: number }): Rect {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  };
}
