import { CLIENTS_ID, nodeCostUsdPerMonth, type Edge, type Level, type NodeSpec, type PeakLoad } from '@five-nines/sim';
import type { CanvasSelection, Draft } from '../canvas/types.ts';
import { formatUsdPerMonth } from '../format.ts';
import { GuideLink } from '../guide/FieldGuideProvider.tsx';
import { ComponentArt, componentNames, type NamedKind } from '../theme/index.ts';
import { ExpectedLoad } from './ExpectedLoad.tsx';
import { NodeFields } from './fields.tsx';

export interface InspectorProps {
  /** The level being played: some settings explain themselves in its terms (e.g. how many values a cache holds). */
  level: Level;
  draft: Draft;
  /** Expected load at the level's peak for the current draft. */
  load: PeakLoad;
  /** Already resolved against the draft: never points at something that doesn't exist. */
  selection: CanvasSelection | null;
  onNodeChange(node: NodeSpec): void;
  onDelete(): void;
}

/** Settings for the selected node or edge, or a short how-to when nothing is selected. */
export function Inspector({ level, draft, load, selection, onNodeChange, onDelete }: InspectorProps) {
  if (!selection) return <HowTo />;
  if (selection.kind === 'edge') return <EdgeInspector edge={selection.edge} onDelete={onDelete} />;
  if (selection.id === CLIENTS_ID) return <ClientsInspector />;

  const node = draft.design.nodes.find((n) => n.id === selection.id);
  if (!node) return <HowTo />;
  return (
    <section className="editor-section inspector" aria-label={`Inspector: ${node.id}`}>
      <InspectorHeader kind={node.kind} title={node.id} onDelete={onDelete} />
      <NodeFields key={node.id} spec={node} onChange={onNodeChange} level={level} />
      <div className="inspector__cost">
        <span className="muted">Monthly cost</span>
        <span className="num">{formatUsdPerMonth(nodeCostUsdPerMonth(node))}</span>
      </div>
      <ExpectedLoad nodeId={node.id} load={load} />
      <GuideLink entry={node.kind} className="inspector__guide" />
    </section>
  );
}

/** The selected thing: its kind (a real-world name with the concept beside it, or "Connection") and its id. */
function InspectorHeader({ kind, title, onDelete }: { kind: NamedKind | null; title: string; onDelete?: () => void }) {
  const name = kind && componentNames[kind];
  return (
    <header className="inspector__header">
      {kind && (
        <span className="inspector__art" aria-hidden>
          <ComponentArt kind={kind} size={40} />
        </span>
      )}
      <div className="inspector__names">
        <div className="editor-section__title">
          {name ? name.product : 'Connection'}
          {name && <span className="inspector__concept"> {name.concept}</span>}
        </div>
        <div className="inspector__title num">{title}</div>
      </div>
      {onDelete && (
        <button type="button" className="btn btn--sm btn--danger" onClick={onDelete} title="Delete (Delete / Backspace)">
          Delete
        </button>
      )}
    </header>
  );
}

function EdgeInspector({ edge, onDelete }: { edge: Edge; onDelete(): void }) {
  return (
    <section className="editor-section inspector" aria-label="Inspector: connection">
      <InspectorHeader kind={null} title={`${edge.from} → ${edge.to}`} onDelete={onDelete} />
      <p className="field__help">Requests flow from {edge.from} to {edge.to}. Connections are free.</p>
    </section>
  );
}

function ClientsInspector() {
  return (
    <section className="editor-section inspector" aria-label="Inspector: clients">
      <InspectorHeader kind="clients" title={CLIENTS_ID} />
      <p className="field__help">
        Your users on the internet. They send the level's traffic to whichever component you connect them to, and
        every request that fails or times out counts against your availability. They can't be deleted, and they can
        connect to exactly one component.
      </p>
    </section>
  );
}

function HowTo() {
  return (
    <section className="editor-section inspector" aria-label="How to build">
      <div className="editor-section__title">How to build</div>
      <ol className="howto">
        <li>
          <strong>Add</strong> components: click one above, or drag it onto the canvas.
        </li>
        <li>
          <strong>Connect</strong> them: drag from a node's right handle to another node's left handle, starting at
          the clients.
        </li>
        <li>
          <strong>Configure</strong>: select a node to change its settings here.
        </li>
        <li>
          <strong>Run</strong> the simulation with the button below or <span className="kbd">R</span>.
        </li>
      </ol>
      <p className="field__help">
        Select anything and press <span className="kbd">Del</span> to remove it.
      </p>
    </section>
  );
}
