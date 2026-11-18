import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS, nodeCopies } from '../../components/registry.ts';
import { formatCompact, formatPercent } from '../../format.ts';
import { hottestShard } from '../../theme/index.ts';
import { useDecorations } from '../context.ts';
import type { ShardsFlowNode } from '../flow.ts';
import { InstanceGrid, LiveRow, LiveStats, QueueRow, type LiveStatus } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/**
 * A sharded database: reads and writes arriving, one cell per shard, and the hottest shard called out with its share
 * of the traffic, so a skewed shard key shows as one cell burning while the rest idle.
 */
export const ShardsNode = memo(function ShardsNode({ id, data, selected }: NodeProps<ShardsFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const hottest = stats ? hottestShard(stats.shardShares ?? []) : null;
  const hotInstance = hottest ? stats?.instances[hottest.index] : undefined;
  const hotStatus: LiveStatus =
    hotInstance === undefined ? 'healthy' : hotInstance.utilization > 1 ? 'failing' : hotInstance.utilization >= 0.7 ? 'busy' : 'healthy';
  return (
    <NodeShell
      id={id}
      kind="shards"
      config={COMPONENTS.shards.summary(data.spec)}
      copies={nodeCopies(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="reads">{formatCompact(stats.readRps ?? 0)}/s</LiveRow>
          <LiveRow label="writes">{formatCompact(stats.writeRps ?? 0)}/s</LiveRow>
          <InstanceGrid instances={stats.instances} label="Shard" highlight={hottest?.hot ? hottest.index : undefined} />
          {hottest && (
            <LiveRow label={`hottest: shard ${hottest.index + 1}`} status={hottest.hot ? hotStatus : undefined}>
              {formatPercent(hottest.share)} of traffic
            </LiveRow>
          )}
          <QueueRow instances={stats.instances} />
        </LiveStats>
      )}
    </NodeShell>
  );
});
