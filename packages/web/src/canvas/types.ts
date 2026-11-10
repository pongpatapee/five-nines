import type { Design, Edge, NodeFrame, TimelineFrame } from '@five-nines/sim';

/** A point in flow coordinates (the canvas's own coordinate space, before pan and zoom). */
export interface XY {
  x: number;
  y: number;
}

/** An axis-aligned rectangle. Flow or screen coordinates, depending on where it comes from. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the player is building for one level: the engine's `Design`, unchanged, plus UI-only node positions.
 *
 * `layout` is keyed by node id and also holds the clients node under `"clients"` (`CLIENTS_ID`). Missing entries are
 * allowed; `completeLayout` fills them in.
 */
export interface Draft {
  design: Design;
  layout: Record<string, XY>;
}

/**
 * The live state of the run at one instant, shown on the nodes during playback.
 *
 * Structurally a `TimelineFrame` from the engine; playback may pass a raw frame or one interpolated between frames.
 * `nodes` is keyed by node id (the clients node is not in it; it shows `offeredRps`). `edges` is keyed by `edgeKey`.
 */
export type LiveFrame = Pick<TimelineFrame, 'atSec' | 'offeredRps' | 'failedRps' | 'nodes' | 'edges'>;

/**
 * Failure rate (req/s) from which a node, or the whole run, counts as failing on screen. The engine's fluid model
 * reports vanishingly small failure rates (e.g. 1e-100 req/s) for healthy but busy servers; those must not glow red.
 * At 0.5 req/s the rate rounds to at least "1/s" in the readouts.
 */
export const FAILING_RPS = 0.5;

/** Whether a failure rate is high enough to show as failing (see `FAILING_RPS`). */
export function isFailingRate(failedRps: number): boolean {
  return failedRps >= FAILING_RPS;
}

/** Live stats for one node. Re-exported so playback and canvas agree on the shape. */
export type LiveNodeStats = NodeFrame;

/**
 * A visual mark on a node, independent of selection.
 * - `error` / `warning`: the editor marks nodes with validation issues.
 * - `focus`: playback highlights the root-cause node with a pulse.
 */
export type NodeMark = 'error' | 'warning' | 'focus';

/** What is selected on an editable canvas. Single selection only. */
export type CanvasSelection = { kind: 'node'; id: string } | { kind: 'edge'; edge: Edge };

/** Things the player asked to delete in one gesture (Delete/Backspace). Never contains the clients node. */
export interface DeleteRequest {
  nodeIds: string[];
  edges: Edge[];
}
