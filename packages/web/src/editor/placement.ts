/**
 * Where new components go. Pure geometry in flow coordinates, so it can be unit tested without React Flow.
 */
import { CLIENTS_ID, type ComponentKind } from '@five-nines/sim';
import { COMPONENTS } from '../components/registry.ts';
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH } from '../canvas/layout.ts';
import type { Draft, Rect, XY } from '../canvas/types.ts';

/** Matches the canvas snap grid, so added nodes line up with dragged ones. */
export const GRID = 10;
/**
 * Empty space kept around existing nodes when looking for a free spot. Node rects don't include the cards stacked up
 * and to the right of a node with several instances (up to about 20px), so this leaves room for them and a gap.
 */
export const PLACEMENT_MARGIN = 40;
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
 * Where a new component would naturally sit in the left-to-right flow: one column right of the rightmost node of a
 * kind it follows (`ComponentMeta.follows`: an app server follows load balancers, a database follows app servers…),
 * or of the clients when there is none, level with that node.
 */
export function preferredPosition(draft: Draft, kind: ComponentKind): XY {
  let anchor = draft.layout[CLIENTS_ID] ?? { x: 0, y: 0 };
  const follows = COMPONENTS[kind].follows;
  for (const node of draft.design.nodes) {
    const position = draft.layout[node.id];
    if (follows.includes(node.kind) && position && position.x > anchor.x) anchor = position;
  }
  return { x: anchor.x + COLUMN_GAP, y: anchor.y };
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

/** The smallest rectangle containing every rectangle given (at least one). */
export function unionRect(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export interface FreeSpotOptions {
  /** Where the node would ideally go (top-left). */
  preferred: XY;
  /** Boxes of the nodes already on the canvas. */
  occupied: readonly Rect[];
  /** Size of the node being placed. */
  size?: { width: number; height: number };
}

/** How far from the preferred spot to look for a free one, in flow units. */
const SEARCH_RADIUS = 1600;

/**
 * The free position (top-left, grid-snapped) closest to `preferred` that keeps `PLACEMENT_MARGIN` clear of every
 * occupied box. Horizontal distance counts double, so nodes stack into the preferred column before spilling into
 * neighbouring ones. Independent of the viewport, so placement is predictable; the editor then brings the new node
 * into view (`revealViewport`).
 *
 * When nothing within `SEARCH_RADIUS` is free, returns the preferred spot: the player can drag it somewhere better.
 */
export function findFreeSpot({ preferred, occupied, size = { width: NODE_WIDTH, height: NODE_HEIGHT } }: FreeSpotOptions): XY {
  const start = snapToGrid(preferred);
  const steps = Math.floor(SEARCH_RADIUS / SEARCH_STEP);
  let best: XY | null = null;
  let bestScore = Infinity;
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
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

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RevealOptions {
  /** The current pan and zoom (`container = flow × zoom + (x, y)`). */
  viewport: Viewport;
  /** Canvas size in CSS pixels. */
  size: { width: number; height: number };
  /** The box that must end up in view (flow coordinates). */
  target: Rect;
  /** Boxes worth keeping in view alongside it (the rest of the design), when they fit. */
  context: readonly Rect[];
  /** Screen pixels kept clear between the boxes and the canvas edges. */
  padding?: number;
  /** Never zoom out further than this. */
  minZoom?: number;
}

/**
 * The viewport that brings `target` into view with the least movement: never zooms in, zooms out only as far as
 * needed to fit the target plus its context, then pans just enough. Returns null when `target` is already in view.
 */
export function revealViewport({ viewport, size, target, context, padding = 40, minZoom = 0.25 }: RevealOptions): Viewport | null {
  const pad = Math.min(padding, size.width / 4, size.height / 4);
  const inset: Rect = {
    x: (pad - viewport.x) / viewport.zoom,
    y: (pad - viewport.y) / viewport.zoom,
    width: (size.width - 2 * pad) / viewport.zoom,
    height: (size.height - 2 * pad) / viewport.zoom,
  };
  if (rectContains(inset, target)) return null;

  const all = unionRect([target, ...context]);
  const fitZoom = Math.min((size.width - 2 * pad) / all.width, (size.height - 2 * pad) / all.height);
  const zoom = Math.max(minZoom, Math.min(viewport.zoom, fitZoom));
  const bounds = fitZoom >= zoom ? all : target;

  // Zoom about the centre of the canvas, then pan the bounds into the padded view (left/top edge wins).
  const pan = (offset: number, extent: number, start: number, length: number): number => {
    const centre = (extent / 2 - offset) / viewport.zoom;
    let next = extent / 2 - centre * zoom;
    const far = (start + length) * zoom + next;
    if (far > extent - pad) next -= far - (extent - pad);
    const near = start * zoom + next;
    if (near < pad) next += pad - near;
    return next;
  };
  return {
    x: pan(viewport.x, size.width, bounds.x, bounds.width),
    y: pan(viewport.y, size.height, bounds.y, bounds.height),
    zoom,
  };
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
