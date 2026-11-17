import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatCompact } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { PaymentProviderFlowNode } from '../flow.ts';
import { LiveBar, LiveRow, LiveStats, utilizationLevel } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/** The external payment provider: calls arriving against its rate limit, and how many it accepted. */
export const PaymentProviderNode = memo(function PaymentProviderNode({ id, data, selected }: NodeProps<PaymentProviderFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const limit = stats?.rateLimitRps ?? 0;
  const share = limit > 0 ? (stats?.arrivalRps ?? 0) / limit : 0;
  return (
    <NodeShell
      id={id}
      kind="paymentProvider"
      config={COMPONENTS.paymentProvider.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveBar
            label="calls"
            fraction={share}
            level={utilizationLevel(share)}
            value={`${formatCompact(stats.arrivalRps)} / ${formatCompact(limit)}`}
          />
          <LiveRow label="accepted">{formatCompact(stats.acceptedRps ?? 0)}/s</LiveRow>
        </LiveStats>
      )}
    </NodeShell>
  );
});
