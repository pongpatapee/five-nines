import type { Edge } from '@five-nines/sim';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type EdgeChange,
  type EdgeTypes,
  type IsValidConnection,
  type NodeChange,
  type OnConnect,
  type OnDelete,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './canvas.css';
import { CanvasHandleContext, DecorationsContext, EdgeRegistryContext, type EdgeGeometryRegistry } from './context.ts';
import { FlowEdge } from './FlowEdge.tsx';
import {
  connectionToEdge,
  draftToFlowEdges,
  draftToFlowNodes,
  flowEdgeToEdge,
  type DesignFlowEdge,
  type DesignFlowNode,
  type Dimensions,
} from './flow.ts';
import { useCreateCanvasHandle, type CanvasHandle } from './handle.ts';
import { NODE_TYPES } from './nodes/index.ts';
import type { CanvasSelection, DeleteRequest, Draft, LiveFrame, NodeMark, XY } from './types.ts';

const edgeTypes: EdgeTypes = { flow: FlowEdge };
const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge-color)' } as const;
const NO_MARKS: Readonly<Record<string, NodeMark>> = {};
const DELETE_KEYS = ['Backspace', 'Delete'];
/** How far out the player can zoom. */
export const MIN_ZOOM = 0.25;

export interface DesignCanvasProps {
  /** The design and positions to render. The canvas never mutates it; edits come back through the callbacks. */
  draft: Draft;
  /**
   * `readOnly`: pan and zoom only (playback, results, reference solutions).
   * `editable`: also select, drag, connect and delete (Delete/Backspace). Clients can't be deleted.
   */
  mode: 'readOnly' | 'editable';
  /** Live stats for the current playback instant. Nodes show utilization, queues, rotation and failing glow. */
  live?: LiveFrame | null;
  /** Visual marks per node id: validation issues, or the playback focus pulse. */
  marks?: Readonly<Record<string, NodeMark>>;

  /**
   * Controlled selection. Pass it together with `onSelectionChange`; leave it undefined to let the canvas track
   * selection itself. Only meaningful in editable mode.
   */
  selection?: CanvasSelection | null;
  /** The player selected a node or edge, or clicked empty space (null). */
  onSelectionChange?: (selection: CanvasSelection | null) => void;
  /** A node is being dragged. Fires on every move with the (grid-snapped) top-left position; update `draft.layout`. */
  onNodeMove?: (id: string, position: XY) => void;
  /** The player dragged a new connection from `edge.from`'s right handle to `edge.to`'s left handle. */
  onConnect?: (edge: Edge) => void;
  /** The player pressed Delete/Backspace. Includes edges attached to deleted nodes. Never includes the clients. */
  onDelete?: (request: DeleteRequest) => void;

  /**
   * Rendered over the whole canvas with `pointer-events: none`, inside the canvas context, so it can call
   * `useCanvasHandle()`. The playback particle layer goes here.
   */
  overlay?: ReactNode;
  /** Rendered inside the canvas element above the graph, with pointer events (e.g. floating controls). */
  children?: ReactNode;
  /** Receives the imperative handle once mounted. Same object `useCanvasHandle()` returns inside `overlay`. */
  onReady?: (handle: CanvasHandle) => void;

  /**
   * Editable mode only: whether Delete/Backspace deletes the selection. Default true. Turn it off while something
   * covers the canvas (e.g. a modal), since React Flow listens on the whole document.
   */
  deleteKey?: boolean;
  /** Allow panning and wheel zoom. Default true. Turn off for small embedded previews so the page scrolls. */
  panZoom?: boolean;
  className?: string;
}

/** The shared React Flow canvas: renders a `Draft` and reports edits as intents. Owns its own React Flow provider. */
export function DesignCanvas(props: DesignCanvasProps) {
  return (
    <ReactFlowProvider>
      <DesignCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function DesignCanvasInner({
  draft,
  mode,
  live = null,
  marks = NO_MARKS,
  selection: controlledSelection,
  onSelectionChange,
  onNodeMove,
  onConnect,
  onDelete,
  overlay,
  children,
  onReady,
  deleteKey = true,
  panZoom = true,
  className,
}: DesignCanvasProps) {
  const editable = mode === 'editable';
  const [registry] = useState<EdgeGeometryRegistry>(() => new Map());
  const handle = useCreateCanvasHandle(registry);

  // Selection: controlled when the parent passes `selection`, otherwise tracked here.
  const [ownSelection, setOwnSelection] = useState<CanvasSelection | null>(null);
  const selection = editable ? (controlledSelection !== undefined ? controlledSelection : ownSelection) : null;
  // Node and edge select events arrive in separate callbacks within one gesture; a ref sees the latest value.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const select = useCallback(
    (next: CanvasSelection | null) => {
      selectionRef.current = next;
      setOwnSelection(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  // React Flow re-measures nodes that come without `measured`, so keep what it reported.
  const [measured, setMeasured] = useState<Record<string, Dimensions>>({});

  const nodes = useMemo(() => draftToFlowNodes(draft, { selection, measured }), [draft, selection, measured]);
  const edges = useMemo(
    () => draftToFlowEdges(draft, { selection }).map((edge) => ({ ...edge, markerEnd: EDGE_MARKER })),
    [draft, selection],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<DesignFlowNode>[]) => {
      let newDims: Record<string, Dimensions> | null = null;
      for (const change of changes) {
        switch (change.type) {
          case 'dimensions':
            if (change.dimensions) (newDims ??= {})[change.id] = change.dimensions;
            break;
          case 'position':
            if (change.position) onNodeMove?.(change.id, change.position);
            break;
          case 'select':
            if (change.selected) select({ kind: 'node', id: change.id });
            else if (selectionRef.current?.kind === 'node' && selectionRef.current.id === change.id) select(null);
            break;
          default:
            // Removals are reported once, through `onDelete`.
            break;
        }
      }
      if (newDims) {
        const dims = newDims;
        setMeasured((prev) => {
          const changed = Object.entries(dims).some(
            ([id, d]) => prev[id]?.width !== d.width || prev[id]?.height !== d.height,
          );
          return changed ? { ...prev, ...dims } : prev;
        });
      }
    },
    [onNodeMove, select],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<DesignFlowEdge>[]) => {
      for (const change of changes) {
        if (change.type !== 'select') continue;
        const current = selectionRef.current;
        if (change.selected) {
          const [from, to] = change.id.split('->') as [string, string];
          select({ kind: 'edge', edge: { from, to } });
        } else if (current?.kind === 'edge' && `${current.edge.from}->${current.edge.to}` === change.id) {
          select(null);
        }
      }
    },
    [select],
  );

  const handleConnect = useCallback<OnConnect>((connection) => onConnect?.(connectionToEdge(connection)), [onConnect]);

  const handleDelete = useCallback<OnDelete<DesignFlowNode, DesignFlowEdge>>(
    ({ nodes: deletedNodes, edges: deletedEdges }) => {
      onDelete?.({ nodeIds: deletedNodes.map((node) => node.id), edges: deletedEdges.map(flowEdgeToEdge) });
      select(null);
    },
    [onDelete, select],
  );

  const isValidConnection = useCallback<IsValidConnection<DesignFlowEdge>>(
    (connection) => connection.source !== connection.target,
    [],
  );

  useEffect(() => {
    onReady?.(handle);
  }, [handle, onReady]);

  const decorations = useMemo(() => ({ live, marks }), [live, marks]);
  const classes = ['design-canvas', `design-canvas--${mode}`];
  if (live) classes.push('design-canvas--live');
  if (className) classes.push(className);

  return (
    <CanvasHandleContext.Provider value={handle}>
      <EdgeRegistryContext.Provider value={registry}>
        <DecorationsContext.Provider value={decorations}>
          <ReactFlow<DesignFlowNode, DesignFlowEdge>
            className={classes.join(' ')}
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onDelete={handleDelete}
            isValidConnection={isValidConnection}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable={editable}
            edgesFocusable={editable}
            nodesFocusable={editable}
            deleteKeyCode={editable && deleteKey ? DELETE_KEYS : null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            snapToGrid
            snapGrid={[10, 10]}
            panOnDrag={panZoom}
            zoomOnScroll={panZoom}
            zoomOnPinch={panZoom}
            zoomOnDoubleClick={false}
            preventScrolling={panZoom}
            minZoom={MIN_ZOOM}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--grid-dot)" />
            {overlay && <div className="design-canvas__overlay">{overlay}</div>}
            {children}
          </ReactFlow>
        </DecorationsContext.Provider>
      </EdgeRegistryContext.Provider>
    </CanvasHandleContext.Provider>
  );
}
