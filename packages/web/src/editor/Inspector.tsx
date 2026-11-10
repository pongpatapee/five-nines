import {
  APP_SERVER_SIZES,
  CLIENTS_ID,
  COMPONENT_LABELS,
  HEALTH_CHECK,
  nodeCostUsdPerMonth,
  type AppServerSize,
  type AppServerSpec,
  type Edge,
  type LoadBalancerSpec,
  type NodeSpec,
} from '@five-nines/sim';
import type { CanvasSelection, Draft } from '../canvas/types.ts';
import { formatUsd, formatUsdPerMonth } from '../format.ts';
import { HEALTH_CHECK_INTERVALS, MAX_INSTANCES, MIN_INSTANCES } from './config.ts';
import { SegmentedControl, Stepper, Toggle, type SegmentedOption } from './controls.tsx';

export interface InspectorProps {
  draft: Draft;
  /** Already resolved against the draft: never points at something that doesn't exist. */
  selection: CanvasSelection | null;
  onNodeChange(node: NodeSpec): void;
  onDelete(): void;
}

/** Settings for the selected node or edge, or a short how-to when nothing is selected. */
export function Inspector({ draft, selection, onNodeChange, onDelete }: InspectorProps) {
  if (!selection) return <HowTo />;
  if (selection.kind === 'edge') return <EdgeInspector edge={selection.edge} onDelete={onDelete} />;
  if (selection.id === CLIENTS_ID) return <ClientsInspector />;

  const node = draft.design.nodes.find((n) => n.id === selection.id);
  if (!node) return <HowTo />;
  return (
    <section className="editor-section inspector" aria-label={`Inspector: ${node.id}`}>
      <InspectorHeader kind={COMPONENT_LABELS[node.kind]} title={node.id} onDelete={onDelete} />
      {node.kind === 'appServer' ? (
        <AppServerFields key={node.id} spec={node} onChange={onNodeChange} />
      ) : (
        <LoadBalancerFields key={node.id} spec={node} onChange={onNodeChange} />
      )}
      <div className="inspector__cost">
        <span className="muted">Monthly cost</span>
        <span className="num">{formatUsdPerMonth(nodeCostUsdPerMonth(node))}</span>
      </div>
    </section>
  );
}

function InspectorHeader({ kind, title, onDelete }: { kind: string; title: string; onDelete?: () => void }) {
  return (
    <header className="inspector__header">
      <div>
        <div className="editor-section__title">{kind}</div>
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

const SIZE_OPTIONS: SegmentedOption<AppServerSize>[] = (Object.keys(APP_SERVER_SIZES) as AppServerSize[]).map((size) => ({
  value: size,
  label: size,
  detail: (
    <>
      <span>{APP_SERVER_SIZES[size].vcpu} vCPU</span>
      <span>{formatUsd(APP_SERVER_SIZES[size].usdPerMonth)}</span>
    </>
  ),
}));

function AppServerFields({ spec, onChange }: { spec: AppServerSpec; onChange(node: NodeSpec): void }) {
  const { vcpu, usdPerMonth } = APP_SERVER_SIZES[spec.size];
  return (
    <>
      <div className="field">
        <div className="field__label">Size</div>
        <SegmentedControl label="Size" options={SIZE_OPTIONS} value={spec.size} onChange={(size) => onChange({ ...spec, size })} />
        <p className="field__help">Each vCPU works on one request at a time. Prices are per instance per month.</p>
      </div>
      <div className="field">
        <div className="field__label">Instances</div>
        <div className="field__row">
          <Stepper
            label="Instances"
            value={spec.instances}
            min={MIN_INSTANCES}
            max={MAX_INSTANCES}
            onChange={(instances) => onChange({ ...spec, instances })}
          />
          <span className="field__aside num">{vcpu * spec.instances} vCPU total</span>
        </div>
        <p className="field__help">
          {spec.instances} × {formatUsd(usdPerMonth)}. More than one instance needs a load balancer in front.
        </p>
      </div>
    </>
  );
}

const INTERVAL_OPTIONS: SegmentedOption<number>[] = HEALTH_CHECK_INTERVALS.map((sec) => ({ value: sec, label: `${sec} s` }));

function LoadBalancerFields({ spec, onChange }: { spec: LoadBalancerSpec; onChange(node: NodeSpec): void }) {
  const detectSec = spec.healthCheckIntervalSec * HEALTH_CHECK.unhealthyThreshold;
  return (
    <>
      <div className="field">
        <div className="field__label">Health-check interval</div>
        <SegmentedControl
          label="Health-check interval"
          options={INTERVAL_OPTIONS}
          value={spec.healthCheckIntervalSec}
          onChange={(healthCheckIntervalSec) => onChange({ ...spec, healthCheckIntervalSec })}
        />
        <p className="field__help">
          How often the balancer probes each instance. After {HEALTH_CHECK.unhealthyThreshold} failed checks (about{' '}
          {detectSec} s here) a dead instance leaves rotation.
        </p>
      </div>
      <div className="field">
        <Toggle
          label="Retry on connection failure"
          checked={spec.retryOnConnectFailure}
          onChange={(retryOnConnectFailure) => onChange({ ...spec, retryOnConnectFailure })}
        />
        <p className="field__help">
          When an instance refuses the connection (it has crashed), send the request to another instance instead of
          failing it. Safe because the request never started.
        </p>
      </div>
    </>
  );
}

function EdgeInspector({ edge, onDelete }: { edge: Edge; onDelete(): void }) {
  return (
    <section className="editor-section inspector" aria-label="Inspector: connection">
      <InspectorHeader kind="Connection" title={`${edge.from} → ${edge.to}`} onDelete={onDelete} />
      <p className="field__help">Requests flow from {edge.from} to {edge.to}. Connections are free.</p>
    </section>
  );
}

function ClientsInspector() {
  return (
    <section className="editor-section inspector" aria-label="Inspector: clients">
      <InspectorHeader kind="Traffic" title={CLIENTS_ID} />
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
