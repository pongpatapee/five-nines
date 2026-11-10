import { COMPONENT_LABELS, nodeCostUsdPerMonth, type LoadBalancerSpec } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { LoadBalancerFlowNode } from '../flow.ts';
import { NodeShell } from './NodeShell.tsx';

/** "LB · checks 5s · retries on" */
export function loadBalancerConfigLabel(spec: LoadBalancerSpec): string {
  return `LB · checks ${spec.healthCheckIntervalSec}s · retries ${spec.retryOnConnectFailure ? 'on' : 'off'}`;
}

export const LoadBalancerNode = memo(function LoadBalancerNode({ id, data, selected }: NodeProps<LoadBalancerFlowNode>) {
  const { live } = useDecorations();
  const stats = live?.nodes[id];
  const inRotation = stats?.inRotation;
  const rotationStatus =
    inRotation === undefined ? undefined : inRotation === 0 ? 'failing' : inRotation < data.backendCount ? 'busy' : 'healthy';

  return (
    <NodeShell
      id={id}
      kindLabel={COMPONENT_LABELS.loadBalancer}
      config={loadBalancerConfigLabel(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <div className="design-node__live">
          <div className="live-row">
            <span className="live-row__label">in</span>
            <span className="live-row__value num">{formatRps(stats.arrivalRps, true)}</span>
          </div>
          {inRotation !== undefined && (
            <div className="live-row">
              <span className="live-row__label">rotation</span>
              <span className="live-row__value num" data-status={rotationStatus}>
                {inRotation}/{data.backendCount} in rotation
              </span>
            </div>
          )}
        </div>
      )}
    </NodeShell>
  );
});
