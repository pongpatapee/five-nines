/** Live-stat building blocks shared by the canvas nodes during playback. Styled in `canvas.css`. */
import type { InstanceFrame } from '@five-nines/sim';
import type { ReactNode } from 'react';
import { formatCount, formatPercent } from '../../format.ts';

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

/** A status colour for a readout. */
export type LiveStatus = 'healthy' | 'busy' | 'failing';

/** The live section under a node's header. */
export function LiveStats({ children }: { children: ReactNode }) {
  return <div className="design-node__live">{children}</div>;
}

/** "label ……… value" */
export function LiveRow({ label, status, children }: { label: string; status?: LiveStatus | undefined; children: ReactNode }) {
  return (
    <div className="live-row">
      <span className="live-row__label">{label}</span>
      <span className="live-row__value num" data-status={status}>
        {children}
      </span>
    </div>
  );
}

/** "label [=====    ] value": a share from 0 to 1 as a bar. */
export function LiveBar({ label, fraction, level, value }: { label: string; fraction: number; level: UtilizationLevel; value: string }) {
  return (
    <div className="live-row">
      <span className="live-row__label">{label}</span>
      <span className="queue-bar" aria-hidden>
        <span className="queue-bar__fill" style={{ width: `${Math.min(1, Math.max(0, fraction)) * 100}%` }} data-level={level} />
      </span>
      <span className="live-row__value num">{value}</span>
    </div>
  );
}

/** One cell per machine, filled to its utilization; crashed ones crossed out. `highlight` singles out one cell. */
export function InstanceGrid({
  instances,
  label = 'Instance',
  highlight,
}: {
  instances: readonly InstanceFrame[];
  label?: string;
  highlight?: number | undefined;
}) {
  return (
    <div className="instance-grid" role="list" aria-label={`${label}s`}>
      {instances.map((instance, i) => (
        <InstanceCell key={i} name={`${label} ${i + 1}`} instance={instance} highlighted={i === highlight} />
      ))}
    </div>
  );
}

function InstanceCell({ name, instance, highlighted }: { name: string; instance: InstanceFrame; highlighted: boolean }) {
  if (!instance.up) {
    return <span className="instance-cell is-down" role="listitem" title={`${name}: down`} />;
  }
  const level = utilizationLevel(instance.utilization);
  return (
    <span
      className="instance-cell"
      role="listitem"
      data-level={level}
      data-highlight={highlighted || undefined}
      title={`${name}: ${formatPercent(instance.utilization)} utilized, ${formatCount(instance.queued)} queued`}
    >
      <span className="instance-cell__fill" style={{ height: `${Math.min(1, instance.utilization) * 100}%` }} />
      {instance.queued >= 1 && <span className="instance-cell__queue" />}
    </span>
  );
}

/** The queue bar: total work waiting across the up machines, on a log scale. */
export function QueueRow({ instances }: { instances: readonly InstanceFrame[] }) {
  const queued = instances.reduce((sum, instance) => sum + (instance.up ? instance.queued : 0), 0);
  const fill = queueFill(queued);
  return (
    <LiveBar
      label="queue"
      fraction={fill}
      level={fill > 0.5 ? 'overloaded' : fill > 0 ? 'busy' : 'calm'}
      value={formatCount(queued, true)}
    />
  );
}
