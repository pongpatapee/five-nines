import type { ComponentKind, NodeFrame } from '@five-nines/sim';
import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { formatUsdPerMonth } from '../../format.ts';
import { ComponentArt, componentNames, marks as themeMarks, UtilizationGauge } from '../../theme/index.ts';
import { useDecorations } from '../context.ts';
import { isFailingRate } from '../types.ts';

export interface NodeShellProps {
  id: string;
  /** The component kind (or "clients"): picks the art and is exposed as `data-kind` so themes can style each kind. */
  kind: ComponentKind | 'clients';
  /** Key configuration in one line, e.g. "xlarge × 4". */
  config: string;
  /** How many of the thing it stands for (`nodeCopies`); more than one draws cards stacked behind. */
  copies?: number;
  /** Monthly cost; omitted for the clients. */
  costUsdPerMonth?: number;
  selected: boolean;
  /** Whether the node accepts incoming connections (everything but the clients). */
  hasTarget?: boolean;
  /** Live stats, rendered under the config while playback runs. */
  children?: ReactNode;
}

/**
 * How busy a node's busiest up machine is in this playback second; `Infinity` when every machine is down. Undefined
 * for kinds whose machines aren't measured that way (load balancers, queues, the provider) or with nothing reported.
 */
function liveUtilization(kind: ComponentKind | 'clients', node: NodeFrame | undefined): number | undefined {
  if (!node || node.instances.length === 0 || kind === 'queue' || kind === 'paymentProvider' || kind === 'clients') return undefined;
  const up = node.instances.filter((instance) => instance.up);
  return up.length === 0 ? Infinity : Math.max(...up.map((instance) => instance.utilization));
}

/** The frame every node shares: handles, header, marks, selection and the failing glow. */
export function NodeShell({ id, kind, config, copies = 1, costUsdPerMonth, selected, hasTarget = true, children }: NodeShellProps) {
  const { live, marks, forecast, notes } = useDecorations();
  // While building, the dial reads the expected peak; during playback, the busiest machine right now.
  const reading = live ? liveUtilization(kind, live.nodes[id]) : forecast?.[id];
  const note = notes[id];
  const failing = isFailingRate(live?.nodes[id]?.failedRps ?? 0);
  const mark = marks[id];
  const name = componentNames[kind];
  /** Cards behind: one for two copies, two for three or more; the summary carries the exact count. */
  const stacked = Math.min(Math.max(copies - 1, 0), 2);
  const classes = ['design-node'];
  if (selected) classes.push('is-selected');
  if (failing) classes.push('is-failing');
  if (mark) classes.push(`is-mark-${mark}`);

  return (
    <div className={classes.join(' ')} data-node-id={id} data-kind={kind}>
      {stacked === 2 && <div className="design-node__stack-card" data-depth="2" aria-hidden />}
      {stacked >= 1 && <div className="design-node__stack-card" data-depth="1" aria-hidden />}
      {mark === 'focus' && <themeMarks.RootCause />}
      {note && (
        <div className="design-node__note" role="status">
          {note}
        </div>
      )}
      {hasTarget && <Handle type="target" position={Position.Left} className="design-node__handle" />}
      <div className="design-node__header">
        <span className="design-node__art">
          <ComponentArt kind={kind} size={34} />
        </span>
        <span className="design-node__kind">
          <span className="design-node__product">{name.product}</span>
          <span className="design-node__concept">{name.concept}</span>
        </span>
      </div>
      <div className="design-node__id-row">
        <div className="design-node__id">{id}</div>
        {costUsdPerMonth !== undefined && <span className="design-node__cost num">{formatUsdPerMonth(costUsdPerMonth)}</span>}
      </div>
      {reading === undefined ? (
        <div className="design-node__config">{config}</div>
      ) : (
        <div className="design-node__config-row">
          <div className="design-node__config">{config}</div>
          <UtilizationGauge utilization={reading} variant="mark" measure={kind === 'queue' ? 'backlog' : 'busy'} />
        </div>
      )}
      {children}
      <Handle type="source" position={Position.Right} className="design-node__handle" />
    </div>
  );
}

