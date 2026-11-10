/**
 * The shared canvas foundation. Editor and playback import from here.
 *
 * - `DesignCanvas`: the React Flow wrapper (read-only or editable, optional live stats and overlay).
 * - `useCanvasHandle` / `CanvasHandle`: viewport and geometry for overlays and drop targets.
 * - `geometry`: edge curve maths shared with the overlay (`pointOnEdge`, `flowToContainer`).
 * - `layout`: `autoLayout`, `completeLayout`, `draftFromDesign`.
 * - `draft`: pure draft operations (`addNode`, `connect`, `removeElements`, …).
 */
export { DesignCanvas, MIN_ZOOM, type DesignCanvasProps } from './DesignCanvas.tsx';
export { useCanvasHandle, useDecorations } from './context.ts';
export type { CanvasHandle, Viewport } from './handle.ts';
export * from './geometry.ts';
export * from './layout.ts';
export * from './draft.ts';
export * from './flow.ts';
export * from './types.ts';
export { queueFill, utilizationLevel, type UtilizationLevel } from './nodes/live.tsx';
