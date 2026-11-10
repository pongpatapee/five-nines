/**
 * Build mode. PHASE 1 PLACEHOLDER: the editor agent replaces this file's implementation (and owns `src/editor/`),
 * keeping `EditorProps` and the `Editor` export so `screens/LevelScreen.tsx` doesn't change.
 *
 * Canvas APIs to build on (all from `../canvas/index.ts`):
 * - `<DesignCanvas mode="editable" draft selection onSelectionChange onNodeMove onConnect onDelete marks onReady>`
 * - pure draft ops: `addNode`, `replaceNode`, `moveNode`, `connect`, `removeElements`, `nextNodeId`, `createNodeSpec`
 * - `CanvasHandle.clientToFlow({ x: clientX, y: clientY })` for palette drops; `getViewport()` / `getSize()` to place
 *   click-added nodes in view.
 */
import type { DesignIssue, Level } from '@five-nines/sim';
import { useCallback, type CSSProperties } from 'react';
import {
  addNode,
  connect,
  createNodeSpec,
  DesignCanvas,
  moveNode,
  nextNodeId,
  removeElements,
  type DeleteRequest,
  type Draft,
  type XY,
} from '../canvas/index.ts';
import type { Edge } from '@five-nines/sim';

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
}

/** Minimal placeholder: an editable canvas, two add buttons, a Run button. Enough to play the whole loop. */
export function Editor({ level, draft, onDraftChange, issues, onRun, onReset, notice }: EditorProps) {
  const errors = issues.filter((issue) => issue.severity === 'error');

  const handleMove = useCallback((id: string, position: XY) => onDraftChange(moveNode(draft, id, position)), [draft, onDraftChange]);
  const handleConnect = useCallback((edge: Edge) => onDraftChange(connect(draft, edge)), [draft, onDraftChange]);
  const handleDelete = useCallback((request: DeleteRequest) => onDraftChange(removeElements(draft, request)), [draft, onDraftChange]);

  const add = (kind: Level['components'][number]) => {
    const id = nextNodeId(draft, kind);
    const column = kind === 'loadBalancer' ? 1 : 2;
    const row = draft.design.nodes.filter((node) => node.kind === kind).length;
    onDraftChange(addNode(draft, createNodeSpec(kind, id), { x: column * 310, y: row * 170 }));
  };

  return (
    <div style={stageStyle}>
      <DesignCanvas
        mode="editable"
        draft={draft}
        onNodeMove={handleMove}
        onConnect={handleConnect}
        onDelete={handleDelete}
      />
      <div style={toolbarStyle}>
        {level.components.map((kind) => (
          <button key={kind} type="button" className="btn btn--sm" onClick={() => add(kind)}>
            + {kind === 'appServer' ? 'App server' : 'Load balancer'}
          </button>
        ))}
        <button type="button" className="btn btn--sm btn--ghost" onClick={onReset}>
          Reset level
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {notice ?? (errors[0]?.message ?? `${issues.length} warning(s)`)}
        </span>
        <button type="button" className="btn btn--primary" disabled={errors.length > 0} onClick={onRun}>
          Run
        </button>
      </div>
    </div>
  );
}

const stageStyle: CSSProperties = { position: 'absolute', inset: 0 };
const toolbarStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  right: 16,
  bottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 8,
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  zIndex: 10,
};
