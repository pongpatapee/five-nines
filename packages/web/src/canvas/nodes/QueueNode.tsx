import { nodeCostUsdPerMonth } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { COMPONENTS } from '../../components/registry.ts';
import { formatCompact, formatSeconds } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { QueueFlowNode } from '../flow.ts';
import { LiveBar, LiveRow, LiveStats, utilizationLevel, type LiveStatus } from './live.tsx';
import { NodeShell } from './NodeShell.tsx';

/**
 * A queue with workers: orders accepted, how full it is, how long the oldest order has waited against the deadline,
 * and how fast the workers drain it.
 */
export const QueueNode = memo(function QueueNode({ id, data, selected }: NodeProps<QueueFlowNode>) {
  const stats = useDecorations().live?.nodes[id];
  const depth = stats?.queueDepth ?? 0;
  const maxDepth = stats?.maxQueueDepth ?? 0;
  const fill = maxDepth > 0 ? depth / maxDepth : 0;
  const wait = stats?.oldestWaitSec ?? 0;
  const deadline = stats?.deadlineSec;
  const waitShare = deadline ? wait / deadline : 0;
  const waitStatus: LiveStatus = waitShare >= 1 ? 'failing' : waitShare >= 0.7 ? 'busy' : 'healthy';
  return (
    <NodeShell
      id={id}
      kind="queue"
      config={COMPONENTS.queue.summary(data.spec)}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && (
        <LiveStats>
          <LiveRow label="orders in">{formatCompact(stats.arrivalRps)}/s</LiveRow>
          <LiveBar
            label="depth"
            fraction={fill}
            level={utilizationLevel(fill)}
            value={`${formatCompact(depth)} / ${formatCompact(maxDepth)}`}
          />
          {deadline ? (
            <LiveBar
              label="oldest"
              fraction={waitShare}
              level={utilizationLevel(waitShare)}
              value={`${formatSeconds(wait)} / ${formatSeconds(deadline)}`}
            />
          ) : (
            <LiveRow label="oldest" status={waitStatus}>
              {formatSeconds(wait)}
            </LiveRow>
          )}
          <LiveRow label="charged">
            {formatCompact(stats.drainRps ?? 0)}/s of {formatCompact(stats.workerRps ?? 0)}/s
          </LiveRow>
        </LiveStats>
      )}
    </NodeShell>
  );
});
