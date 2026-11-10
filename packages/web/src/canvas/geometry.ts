/**
 * Edge geometry shared by the rendered edges and the playback overlay, so request dots follow exactly the drawn path.
 *
 * Every edge leaves its source on the right and enters its target on the left, drawn as a cubic Bézier with the
 * same control-point rule React Flow uses for its default edge.
 */
import type { XY } from './types.ts';

export interface EdgeGeometry {
  /** `edgeKey({ from, to })`. */
  key: string;
  from: string;
  to: string;
  /** Where the edge leaves the source node, in flow coordinates. */
  source: XY;
  /** Where the edge enters the target node, in flow coordinates. */
  target: XY;
}

const CURVATURE = 0.25;

function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : CURVATURE * 25 * Math.sqrt(-distance);
}

/** The four Bézier points [start, control 1, control 2, end]. */
export function edgeBezier(source: XY, target: XY): [XY, XY, XY, XY] {
  const offset = controlOffset(target.x - source.x);
  return [source, { x: source.x + offset, y: source.y }, { x: target.x - offset, y: target.y }, target];
}

/** SVG path data for an edge. */
export function edgePath(source: XY, target: XY): string {
  const [p0, c1, c2, p3] = edgeBezier(source, target);
  return `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`;
}

/** The point at parameter `t` ∈ [0, 1] along an edge (0 = source, 1 = target), in the same space as the inputs. */
export function pointOnEdge(source: XY, target: XY, t: number): XY {
  const [p0, c1, c2, p3] = edgeBezier(source, target);
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

/** Maps a flow-space point to container pixels for a viewport `{ x, y, zoom }`. */
export function flowToContainer(point: XY, viewport: { x: number; y: number; zoom: number }): XY {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}

/** Inverse of `flowToContainer`. */
export function containerToFlow(point: XY, viewport: { x: number; y: number; zoom: number }): XY {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}
