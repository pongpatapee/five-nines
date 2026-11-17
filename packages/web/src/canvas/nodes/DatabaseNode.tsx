import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatCompact } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { DatabaseFlowNode } from '../flow.ts';
import { InstanceGrid, LiveRow, LiveStats, QueueRow } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/** The primary database: reads and writes arriving, and how busy that makes it. */
export const DatabaseNode = memo(function DatabaseNode({ id, data, selected }: NodeProps<DatabaseFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  return (
    <NodeShell
      id={id}
      kind="database"
      config={COMPONENTS.database.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="reads">{formatCompact(stats.readRps ?? 0)}/s</LiveRow>
          <LiveRow label="writes">{formatCompact(stats.writeRps ?? 0)}/s</LiveRow>
          <InstanceGrid instances={stats.instances} label="Database" />
          <QueueRow instances={stats.instances} />
        </LiveStats>
      )}
    </NodeShell>
  );
});
