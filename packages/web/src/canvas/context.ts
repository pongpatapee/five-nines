import { createContext, useContext } from 'react';
import type { EdgeGeometry } from './geometry.ts';
import type { CanvasHandle } from './handle.ts';
import type { LiveFrame, NodeMark } from './types.ts';

/**
 * Per-render decorations that nodes read from context instead of node data, so live stats and marks can change
 * without rebuilding React Flow's node list.
 */
export interface CanvasDecorations {
  live: LiveFrame | null;
  marks: Readonly<Record<string, NodeMark>>;
  /** Expected peak utilization per node id, shown as a small gauge on each node while building. */
  forecast: Readonly<Record<string, number>> | null;
  /** A short line pinned above a node during playback ("Smudge unplugged instance 2"), by node id. */
  notes: Readonly<Record<string, string>>;
}

export const DecorationsContext = createContext<CanvasDecorations>({ live: null, marks: {}, forecast: null, notes: {} });

export function useDecorations(): CanvasDecorations {
  return useContext(DecorationsContext);
}

/** Edge endpoints as React Flow last rendered them, keyed by edge key. Written by `FlowEdge`, read by the handle. */
export type EdgeGeometryRegistry = Map<string, EdgeGeometry>;

export const EdgeRegistryContext = createContext<EdgeGeometryRegistry | null>(null);

export const CanvasHandleContext = createContext<CanvasHandle | null>(null);

/**
 * The imperative handle of the enclosing `DesignCanvas`. Use it in components passed as `DesignCanvas`'s `overlay`
 * (e.g. the playback particle layer). Throws outside a canvas.
 */
export function useCanvasHandle(): CanvasHandle {
  const handle = useContext(CanvasHandleContext);
  if (!handle) throw new Error('useCanvasHandle must be used inside a DesignCanvas overlay.');
  return handle;
}
