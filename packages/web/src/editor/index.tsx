/**
 * Build mode: the editable canvas plus a sidebar with the palette, inspector, live validation and the Run bar.
 *
 * The editor owns only UI state (selection). The draft lives in the store; every edit goes through `onDraftChange`
 * using the pure draft operations from `canvas/`.
 */
import { peakLoad, type ComponentKind, type DesignIssue, type Edge, type Level, type NodeSpec } from '@five-nines/sim';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  addNode,
  connect,
  createNodeSpec,
  DesignCanvas,
  MIN_ZOOM,
  moveNode,
  NODE_HEIGHT,
  NODE_WIDTH,
  nextNodeId,
  removeElements,
  replaceNode,
  type CanvasHandle,
  type CanvasSelection,
  type DeleteRequest,
  type Draft,
  type XY,
} from '../canvas/index.ts';
import { isTypingTarget, PALETTE_DRAG_TYPE } from './config.ts';
import { Inspector } from './Inspector.tsx';
import { IssueList } from './IssueList.tsx';
import { issueMarks, runBlocker, sortIssues } from './issues.ts';
import { Palette } from './Palette.tsx';
import {
  centeredAt,
  findFreeSpot,
  occupiedRects,
  preferredPosition,
  rectContains,
  revealViewport,
  visibleFlowRect,
} from './placement.ts';
import { RunBar } from './RunBar.tsx';
import { isDeletable, resolveSelection } from './selection.ts';

export interface EditorProps {
  /** The level being played. `level.components` lists the component kinds the palette may offer. */
  level: Level;
  /** The current draft (design + layout). Autosaved by the store; treat as immutable. */
  draft: Draft;
  /**
   * Replace the draft. Call on every edit, including node drags (cheap: storage writes are debounced).
   * The clients node must stay; `removeElements` already guarantees that.
   */
  onDraftChange(draft: Draft): void;
  /**
   * `validateDesign(draft.design, level)`, recomputed by the screen whenever the draft changes. Errors block running;
   * warnings don't. Issues with `nodeId` should mark that node (`DesignCanvas` `marks`) and select it when clicked.
   */
  issues: readonly DesignIssue[];
  /**
   * Run the current draft. The screen ignores the call while `issues` contains errors, so the editor should disable
   * its Run button (showing why) and only call this when runnable. Bind it to the R key too.
   */
  onRun(): void;
  /** Reset the level to its starting draft (just the clients). Confirm with the player first. */
  onReset(): void;
  /** A message about the last run attempt that didn't start (e.g. the simulation worker failed). Null when none. */
  notice: string | null;
  /**
   * Whether the editor is the surface the player is using. False while something covers it (e.g. the debrief):
   * keyboard shortcuts (R, Delete) are off and the editor is inert. Default true.
   */
  active?: boolean;
}

export function Editor({ level, draft, onDraftChange, issues, onRun, onReset, notice, active = true }: EditorProps) {
  const handleRef = useRef<CanvasHandle | null>(null);
  const [rawSelection, setSelection] = useState<CanvasSelection | null>(null);
  const selection = resolveSelection(draft, rawSelection);

  const sortedIssues = useMemo(() => sortIssues(issues), [issues]);
  const marks = useMemo(() => issueMarks(issues), [issues]);
  const blocker = runBlocker(issues);
  const load = useMemo(() => peakLoad(level, draft.design), [level, draft.design]);
  const forecast = useMemo(
    () => Object.fromEntries(Object.entries(load.nodes).map(([id, node]) => [id, node.utilization])),
    [load],
  );

  // Canvas intents.
  const handleReady = useCallback((handle: CanvasHandle) => {
    handleRef.current = handle;
  }, []);
  const handleMove = useCallback((id: string, position: XY) => onDraftChange(moveNode(draft, id, position)), [draft, onDraftChange]);
  const handleConnect = useCallback((edge: Edge) => onDraftChange(connect(draft, edge)), [draft, onDraftChange]);
  const handleDelete = useCallback(
    (request: DeleteRequest) => onDraftChange(removeElements(draft, request)),
    [draft, onDraftChange],
  );

  // Adding components.
  const addAt = (kind: ComponentKind, position: XY) => {
    if (!level.components.includes(kind)) return;
    const id = nextNodeId(draft, kind);
    onDraftChange(addNode(draft, createNodeSpec(kind, id, level), position));
    setSelection({ kind: 'node', id });
  };

  // A clicked palette item goes to its natural place in the flow, and the view follows it there.
  const addInFlow = (kind: ComponentKind) => {
    const handle = handleRef.current;
    const occupied = occupiedRects(draft, handle?.getNodeRects() ?? {});
    const position = findFreeSpot({ preferred: preferredPosition(draft, kind), occupied });
    addAt(kind, position);
    if (!handle) return;
    const viewport = revealViewport({
      viewport: handle.getViewport(),
      size: handle.getSize(),
      target: { ...position, width: NODE_WIDTH, height: NODE_HEIGHT },
      context: occupied,
      minZoom: MIN_ZOOM,
    });
    if (viewport) void handle.setViewport(viewport, { durationMs: 300 });
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const kind = event.dataTransfer.getData(PALETTE_DRAG_TYPE) as ComponentKind;
    const handle = handleRef.current;
    if (!kind || !handle) return;
    event.preventDefault();
    addAt(kind, centeredAt(handle.clientToFlow({ x: event.clientX, y: event.clientY })));
  };

  // Sidebar actions.
  const deleteSelection = () => {
    if (!selection || !isDeletable(selection)) return;
    const request: DeleteRequest =
      selection.kind === 'node' ? { nodeIds: [selection.id], edges: [] } : { nodeIds: [], edges: [selection.edge] };
    onDraftChange(removeElements(draft, request));
    setSelection(null);
  };

  const updateNode = (node: NodeSpec) => onDraftChange(replaceNode(draft, node));

  const selectNode = (id: string) => {
    setSelection({ kind: 'node', id });
    const handle = handleRef.current;
    const rect = handle?.getNodeRect(id);
    if (handle && rect && !rectContains(visibleFlowRect(handle.getViewport(), handle.getSize()), rect)) {
      void handle.focusNode(id, { durationMs: 400 });
    }
  };

  const reset = () => {
    setSelection(null);
    onReset();
  };

  // R runs the design, unless the player is typing.
  const run = useCallback(() => {
    if (blocker === null) onRun();
  }, [blocker, onRun]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'r' && event.key !== 'R') return;
      if (event.repeat || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, active]);

  return (
    <div className="editor" inert={!active}>
      <div className="editor__canvas" onDragOver={handleDragOver} onDrop={handleDrop}>
        <DesignCanvas
          mode="editable"
          draft={draft}
          selection={selection}
          onSelectionChange={setSelection}
          marks={marks}
          forecast={forecast}
          onNodeMove={handleMove}
          onConnect={handleConnect}
          onDelete={handleDelete}
          onReady={handleReady}
          deleteKey={active}
        />
      </div>
      <aside className="editor-sidebar" aria-label="Build tools">
        <div className="editor-sidebar__scroll">
          <Palette components={level.components} onAdd={addInFlow} />
          <Inspector level={level} draft={draft} load={load} selection={selection} onNodeChange={updateNode} onDelete={deleteSelection} />
          <IssueList issues={sortedIssues} onSelectNode={selectNode} />
        </div>
        <RunBar blocker={blocker} notice={notice} onRun={run} onReset={reset} />
      </aside>
    </div>
  );
}
