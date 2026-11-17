import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { AppServerFlowNode } from '../flow.ts';
import { InstanceGrid, LiveRow, LiveStats, QueueRow } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

export const AppServerNode = memo(function AppServerNode({ id, data, selected }: NodeProps<AppServerFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  return (
    <NodeShell
      id={id}
      kind="appServer"
      config={COMPONENTS.appServer.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="in">{formatRps(stats.arrivalRps, true)}</LiveRow>
          <InstanceGrid instances={stats.instances} />
          <QueueRow instances={stats.instances} />
        </LiveStats>
      )}
    </NodeShell>
  );
});
