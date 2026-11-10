import { nodeCostUsdPerMonth, REPLICATION } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatRps, formatSeconds } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { ReadReplicasFlowNode } from '../flow.ts';
import { isFailingRate } from '../types.ts';
import { InstanceGrid, LiveRow, LiveStats, type LiveStatus } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/** Read replicas: reads in, how busy each replica is, and how far behind the primary they are. */
export const ReadReplicasNode = memo(function ReadReplicasNode({ id, data, selected }: NodeProps<ReadReplicasFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const lag = stats?.replicationLagSec ?? 0;
  const lagStatus: LiveStatus =
    stats && isFailingRate(stats.failedRps) ? 'failing' : lag > REPLICATION.alertLagSec ? 'busy' : 'healthy';
  return (
    <NodeShell
      id={id}
      kind="readReplicas"
      kindLabel={COMPONENTS.readReplicas.label}
      config={COMPONENTS.readReplicas.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="reads">{formatRps(stats.arrivalRps, true)}</LiveRow>
          <InstanceGrid instances={stats.instances} label="Replica" />
          <LiveRow label="lag" status={lagStatus}>
            {formatSeconds(lag)} behind
          </LiveRow>
        </LiveStats>
      )}
    </NodeShell>
  );
});
