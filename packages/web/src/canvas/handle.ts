import { useReactFlow, useStoreApi, type Viewport } from '@xyflow/react';
import { useMemo } from 'react';
import type { EdgeGeometryRegistry } from './context.ts';
import { containerToFlow, flowToContainer, type EdgeGeometry } from './geometry.ts';
import type { Rect, XY } from './types.ts';

export type { Viewport };

/**
 * Imperative access to a mounted `DesignCanvas`, for the playback overlay and for editor gestures that need
 * coordinates (e.g. dropping a palette item).
 *
 * Coordinate spaces:
 * - **flow**: the canvas's own space, where draft layout positions live.
 * - **container**: CSS pixels relative to the top-left of the canvas element (`getContainer()`). An overlay
 *   `<canvas>` absolutely positioned over the whole `DesignCanvas` draws in this space:
 *   `container = flow × zoom + (viewport.x, viewport.y)`.
 * - **client**: browser viewport pixels, as in `MouseEvent.clientX`.
 *
 * All getters read React Flow's store directly and are cheap enough to call every animation frame.
 */
export interface CanvasHandle {
  /** The current pan and zoom: `container = flow × zoom + (x, y)`. */
  getViewport(): Viewport;
  /** Calls `listener` whenever the viewport changes (pan, zoom, programmatic moves). Returns an unsubscribe. */
  subscribeViewport(listener: (viewport: Viewport) => void): () => void;
  /** Size of the canvas element in CSS pixels. */
  getSize(): { width: number; height: number };
  /** The canvas element (React Flow's root). Null before mount. */
  getContainer(): HTMLElement | null;

  flowToContainer(point: XY): XY;
  containerToFlow(point: XY): XY;
  /** For drops and pointer events: maps `clientX/clientY` to flow coordinates. */
  clientToFlow(point: XY): XY;

  /** A node's measured box in flow coordinates (including the clients node), or null if not measured yet. */
  getNodeRect(id: string): Rect | null;
  /** Every measured node's box in flow coordinates. */
  getNodeRects(): Record<string, Rect>;
  /**
   * Every rendered edge's endpoints in flow coordinates. Points along an edge come from
   * `pointOnEdge(geometry.source, geometry.target, t)` in `canvas/geometry.ts`, which matches the drawn curve.
   */
  getEdgeGeometry(): EdgeGeometry[];

  /** Smoothly centres the view on a node, optionally zooming. Resolves when the animation ends. */
  focusNode(id: string, options?: { zoom?: number; durationMs?: number }): Promise<void>;
  /** Fits every node in view. */
  fitView(options?: { durationMs?: number; padding?: number }): Promise<void>;
}

/** Builds the handle for the React Flow instance in context. Internal to `DesignCanvas`. */
export function useCreateCanvasHandle(registry: EdgeGeometryRegistry): CanvasHandle {
  const flow = useReactFlow();
  const store = useStoreApi();

  return useMemo<CanvasHandle>(() => {
    const viewport = (): Viewport => {
      const [x, y, zoom] = store.getState().transform;
      return { x, y, zoom };
    };
    const nodeRect = (id: string): Rect | null => {
      const node = store.getState().nodeLookup.get(id);
      const width = node?.measured.width;
      const height = node?.measured.height;
      if (!node || width === undefined || height === undefined) return null;
      return { ...node.internals.positionAbsolute, width, height };
    };

    return {
      getViewport: viewport,
      subscribeViewport(listener) {
        return store.subscribe((state, prev) => {
          if (state.transform !== prev.transform) {
            const [x, y, zoom] = state.transform;
            listener({ x, y, zoom });
          }
        });
      },
      getSize() {
        const { width, height } = store.getState();
        return { width, height };
      },
      getContainer: () => store.getState().domNode,
      flowToContainer: (point) => flowToContainer(point, viewport()),
      containerToFlow: (point) => containerToFlow(point, viewport()),
      clientToFlow: (point) => flow.screenToFlowPosition(point, { snapToGrid: false }),
      getNodeRect: nodeRect,
      getNodeRects() {
        const rects: Record<string, Rect> = {};
        for (const id of store.getState().nodeLookup.keys()) {
          const rect = nodeRect(id);
          if (rect) rects[id] = rect;
        }
        return rects;
      },
      getEdgeGeometry: () => [...registry.values()],
      async focusNode(id, options = {}) {
        const rect = nodeRect(id);
        if (!rect) return;
        await flow.setCenter(rect.x + rect.width / 2, rect.y + rect.height / 2, {
          zoom: options.zoom ?? viewport().zoom,
          duration: options.durationMs ?? 600,
        });
      },
      async fitView(options = {}) {
        await flow.fitView({ duration: options.durationMs ?? 300, padding: options.padding ?? 0.2 });
      },
    };
  }, [flow, store, registry]);
}
