import { APP_SERVER_SIZES, COMPONENT_LABELS, nodeCostUsdPerMonth, type AppServerSpec, type InstanceFrame } from '@five-nines/sim';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { formatCount, formatPercent, formatRps } from '../../format.ts';
import { useDecorations } from '../context.ts';
import type { AppServerFlowNode } from '../flow.ts';
import { NodeShell } from './NodeShell.tsx';

/** "xlarge × 4" */
export function appServerConfigLabel(spec: AppServerSpec): string {
  return `${spec.size} × ${spec.instances}`;
}

export type UtilizationLevel = 'calm' | 'busy' | 'overloaded';

/** Calm below 70%, busy from 70% to 100%, overloaded above 100%. */
export function utilizationLevel(utilization: number): UtilizationLevel {
  if (utilization > 1) return 'overloaded';
  if (utilization >= 0.7) return 'busy';
  return 'calm';
}

/** Queue depth mapped to [0, 1] on a log scale: 1 request is visible, 10,000+ is full. */
export function queueFill(queued: number): number {
  if (queued <= 0) return 0;
  return Math.min(1, Math.log10(1 + queued) / 4);
}

export const AppServerNode = memo(function AppServerNode({ id, data, selected }: NodeProps<AppServerFlowNode>) {
  const { live } = useDecorations();
  const stats = live?.nodes[id];
  const vcpu = APP_SERVER_SIZES[data.spec.size].vcpu;

  return (
    <NodeShell
      id={id}
      kindLabel={COMPONENT_LABELS.appServer}
      config={`${appServerConfigLabel(data.spec)} · ${vcpu * data.spec.instances} vCPU`}
      costUsdPerMonth={nodeCostUsdPerMonth(data.spec)}
      selected={selected}
    >
      {stats && <AppServerLive arrivalRps={stats.arrivalRps} instances={stats.instances} />}
    </NodeShell>
  );
});

function AppServerLive({ arrivalRps, instances }: { arrivalRps: number; instances: InstanceFrame[] }) {
  const queued = instances.reduce((sum, instance) => sum + (instance.up ? instance.queued : 0), 0);
  const fill = queueFill(queued);
  return (
    <div className="design-node__live">
      <div className="live-row">
        <span className="live-row__label">in</span>
        <span className="live-row__value num">{formatRps(arrivalRps, true)}</span>
      </div>
      <div className="instance-grid" role="list" aria-label="Instances">
        {instances.map((instance, i) => (
          <InstanceCell key={i} index={i} instance={instance} />
        ))}
      </div>
      <div className="live-row">
        <span className="live-row__label">queue</span>
        <span className="queue-bar" aria-hidden>
          <span className="queue-bar__fill" style={{ width: `${fill * 100}%` }} data-level={fill > 0.5 ? 'overloaded' : fill > 0 ? 'busy' : 'calm'} />
        </span>
        <span className="live-row__value num">{formatCount(queued, true)}</span>
      </div>
    </div>
  );
}

function InstanceCell({ index, instance }: { index: number; instance: InstanceFrame }) {
  if (!instance.up) {
    return <span className="instance-cell is-down" role="listitem" title={`Instance ${index + 1}: down`} />;
  }
  const level = utilizationLevel(instance.utilization);
  return (
    <span
      className="instance-cell"
      role="listitem"
      data-level={level}
      title={`Instance ${index + 1}: ${formatPercent(instance.utilization)} utilized, ${formatCount(instance.queued)} queued`}
    >
      <span className="instance-cell__fill" style={{ height: `${Math.min(1, instance.utilization) * 100}%` }} />
      {instance.queued >= 1 && <span className="instance-cell__queue" />}
    </span>
  );
}
