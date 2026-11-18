import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS, nodeCopies } from '../../components/registry.ts';
import { formatCompact, formatPercent, formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { CacheFlowNode } from '../flow.ts';
import { isFailingRate } from '../types.ts';
import { InstanceGrid, LiveBar, LiveRow, LiveStats } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/**
 * A cache: lookups in and the share served from memory (it climbs back up as a restarted cache warms), plus, when
 * they apply, the share that waited on a fetch in flight, the invalidations writes send it, and stale reads served.
 */
export const CacheNode = memo(function CacheNode({ id, data, selected }: NodeProps<CacheFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const hitRate = stats?.hitRate ?? 0;
  return (
    <NodeShell
      id={id}
      kind="cache"
      config={COMPONENTS.cache.summary(data.spec)}
      copies={nodeCopies(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="lookups">{formatRps(stats.arrivalRps, true)}</LiveRow>
          <LiveBar label="hit rate" fraction={hitRate} level="calm" value={formatPercent(hitRate)} />
          {data.spec.coalesceMisses && (
            <LiveRow label="coalesced">{formatPercent(stats.coalescedRate ?? 0)}</LiveRow>
          )}
          {data.spec.invalidateOnWrite && (
            <LiveRow label="invalidations">{formatCompact(stats.writeRps ?? 0)}/s</LiveRow>
          )}
          {isFailingRate(stats.staleRps ?? 0) && (
            <LiveRow label="stale reads" status="failing">
              {formatCompact(stats.staleRps ?? 0)}/s
            </LiveRow>
          )}
          <InstanceGrid instances={stats.instances} label="Cache node" />
        </LiveStats>
      )}
    </NodeShell>
  );
});
