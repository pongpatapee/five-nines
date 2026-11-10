import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatPercent, formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { CacheFlowNode } from '../flow.ts';
import { InstanceGrid, LiveBar, LiveRow, LiveStats } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/** A cache: lookups in, and the share of them it served from memory. */
export const CacheNode = memo(function CacheNode({ id, data, selected }: NodeProps<CacheFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const hitRate = stats?.hitRate ?? 0;
  return (
    <NodeShell
      id={id}
      kind="cache"
      kindLabel={COMPONENTS.cache.label}
      config={COMPONENTS.cache.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="lookups">{formatRps(stats.arrivalRps, true)}</LiveRow>
          <LiveBar label="hit rate" fraction={hitRate} level="calm" value={formatPercent(hitRate)} />
          <InstanceGrid instances={stats.instances} label="Cache node" />
        </LiveStats>
      )}
    </NodeShell>
  );
});
