import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { ClientsFlowNode } from '../flow.ts';
import { NodeShell } from './NodeShell.tsx';

/** The traffic source. Always present, never deletable, only has an outgoing handle. */
export const ClientsNode = memo(function ClientsNode({ id, selected }: NodeProps<ClientsFlowNode>) {
  const { live } = useDecorations();
  return (
    <NodeShell id={id} kind="clients" kindLabel="Traffic" config="Users on the internet" selected={selected} hasTarget={false}>
      {live && (
        <div className="design-node__live">
          <div className="live-row">
            <span className="live-row__label">offered</span>
            <span className="live-row__value num">{formatRps(live.offeredRps, true)}</span>
          </div>
        </div>
      )}
    </NodeShell>
  );
});
