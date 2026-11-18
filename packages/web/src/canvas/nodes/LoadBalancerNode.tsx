import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { LoadBalancerFlowNode } from '../flow.ts';
import { LiveRow, LiveStats } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

export const LoadBalancerNode = memo(function LoadBalancerNode({ id, data, selected }: NodeProps<LoadBalancerFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const inRotation = stats?.inRotation;
  const rotationStatus =
    inRotation === undefined ? undefined : inRotation === 0 ? 'failing' : inRotation < data.backendCount ? 'busy' : 'healthy';

  return (
    <NodeShell
      id={id}
      kind="loadBalancer"
      config={COMPONENTS.loadBalancer.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="in">{formatRps(stats.arrivalRps, true)}</LiveRow>
          {inRotation !== undefined && (
            <LiveRow label="rotation" status={rotationStatus}>
              {inRotation}/{data.backendCount} in rotation
            </LiveRow>
          )}
        </LiveStats>
      )}
    </NodeShell>
  );
});
