import type { ComponentKind } from '@five-nines/sim';
import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { formatUsdPerMonth } from '../../format.ts';
import { ComponentDoodle } from '../../notebook/doodles.tsx';
import { InkLoop } from '../../notebook/ink.tsx';
import { useDecorations } from '../context.ts';
import { isFailingRate } from '../types.ts';

export interface NodeShellProps {
  id: string;
  /** The component kind (or "clients"): picks the doodle and is exposed as `data-kind` so themes can style each kind. */
  kind: ComponentKind | 'clients';
  /** Uppercase kind label, e.g. "App server". */
  kindLabel: string;
  /** Key configuration in one line, e.g. "xlarge × 4". */
  config: string;
  /** Monthly cost; omitted for the clients. */
  costUsdPerMonth?: number;
  selected: boolean;
  /** Whether the node accepts incoming connections (everything but the clients). */
  hasTarget?: boolean;
  /** Live stats, rendered under the config while playback runs. */
  children?: ReactNode;
}

/** The frame every node shares: handles, header, marks, selection and the failing glow. */
export function NodeShell({ id, kind, kindLabel, config, costUsdPerMonth, selected, hasTarget = true, children }: NodeShellProps) {
  const { live, marks } = useDecorations();
  const failing = isFailingRate(live?.nodes[id]?.failedRps ?? 0);
  const mark = marks[id];
  const classes = ['design-node'];
  if (selected) classes.push('is-selected');
  if (failing) classes.push('is-failing');
  if (mark) classes.push(`is-mark-${mark}`);

  return (
    <div className={classes.join(' ')} data-node-id={id} data-kind={kind}>
      {mark === 'focus' && <RootCauseCircle />}
      {hasTarget && <Handle type="target" position={Position.Left} className="design-node__handle" />}
      <div className="design-node__header">
        <span className="design-node__kind">
          <ComponentDoodle kind={kind} size={20} />
          {kindLabel}
        </span>
        {costUsdPerMonth !== undefined && <span className="design-node__cost num">{formatUsdPerMonth(costUsdPerMonth)}</span>}
      </div>
      <div className="design-node__id">{id}</div>
      <div className="design-node__config">{config}</div>
      {children}
      <Handle type="source" position={Position.Right} className="design-node__handle" />
    </div>
  );
}

/** The playback freeze-frame's verdict: the root cause circled in red pen, with a note. */
function RootCauseCircle() {
  return (
    <div className="root-cause" aria-hidden>
      <InkLoop width={240} height={150} delayMs={200} />
      <span className="root-cause__label">root cause</span>
    </div>
  );
}
