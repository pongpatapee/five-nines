import { COMFORTABLE_UTILIZATION, HOT_UTILIZATION, type NodeLoad, type PeakLoad } from '@five-nines/sim';
import { formatCount, formatPercent, formatSeconds } from '../format.ts';
import { UtilizationGauge, type GaugeMeasure } from '../theme/index.ts';

export interface ExpectedLoadProps {
  nodeId: string;
  load: PeakLoad;
}

/**
 * The selected node's expected utilization at the level's peak, as a gauge with the arithmetic beside it, so the
 * player can check their napkin maths against the design. Never a predicted p99: that's what the run is for.
 */
export function ExpectedLoad({ nodeId, load }: ExpectedLoadProps) {
  const node = load.nodes[nodeId];
  const afterCrash = load.afterCrash?.[nodeId];
  const duringHotKey = load.duringHotKey?.[nodeId];
  const cold = load.afterCacheRestart?.[nodeId];
  const coldMatters = cold !== undefined && node !== undefined && node.kind !== 'cache' && cold.utilization > node.utilization + 0.005;
  return (
    <section className="expected-load" aria-labelledby="expected-load-title">
      <h3 id="expected-load-title" className="expected-load__title">
        Expected at the peak <span className="expected-load__peak num">{formatCount(load.peakRps)} req/s</span>
      </h3>
      {node ? (
        <>
          {coldMatters && <p className="field__help">With the cache warm:</p>}
          <UtilizationGauge utilization={node.utilization} variant="full" measure={gaugeMeasure(node)} />
          <p className="expected-load__working num">{working(node)}</p>
          {afterCrash && node.kind === 'appServer' && (
            <p className="expected-load__crash">
              <span>After the busiest instance crashes:</span>
              <UtilizationGauge utilization={afterCrash.utilization} variant="mark" />
            </p>
          )}
          {duringHotKey && node.kind === 'shards' && duringHotKey.utilization > node.utilization + 0.005 && (
            <>
              <p className="expected-load__crash">
                <span>While one value is hot:</span>
                <UtilizationGauge utilization={duringHotKey.utilization} variant="mark" />
              </p>
              <p className="expected-load__working num">{working(duringHotKey)}</p>
            </>
          )}
          {coldMatters && (
            <>
              <p className="expected-load__crash">
                <span>Just after the cache restarts, empty:</span>
                <UtilizationGauge utilization={cold.utilization} variant="mark" />
              </p>
              <p className="expected-load__working num">{working(cold)}</p>
            </>
          )}
          {node.kind === 'queue' ? (
            <p className="field__help">
              The backlog against its limit: how much of the deadline the oldest order waits, or how much of the queue's
              room the backlog fills, whichever is more. Over 100%, orders miss the deadline or are turned away.
            </p>
          ) : (
            <p className="field__help">
              Load ÷ capacity. Under {formatPercent(COMFORTABLE_UTILIZATION)} is comfortable; past{' '}
              {formatPercent(HOT_UTILIZATION)} requests queue and p99 climbs fast; over 100% the queue never empties.
            </p>
          )}
        </>
      ) : (
        <p className="field__help">No traffic reaches {nodeId} yet. Connect it into the flow from the clients.</p>
      )}
    </section>
  );
}

/** A queue's reading is the backlog against whichever limit it's closer to: the deadline or its room. */
export function gaugeMeasure(node: NodeLoad): GaugeMeasure {
  const q = node.queue;
  if (node.kind !== 'queue' || !q) return 'busy';
  const waitShare = Number.isFinite(q.deadlineSec) ? q.maxWaitSec / q.deadlineSec : 0;
  return waitShare >= q.peakBacklog / q.maxDepth ? 'deadline' : 'room';
}

/** The sum behind the gauge, in the node's own units. Exported for tests. */
export function working(node: NodeLoad): string {
  const n = (value: number) => formatCount(value);
  switch (node.kind) {
    case 'loadBalancer':
      return `${n(node.load)} req/s ÷ ${n(node.capacity)} req/s it can pass on`;
    case 'appServer': {
      if (node.machines === 0) return `${n(node.load)} req/s and no instance left to serve them`;
      const each = node.machines > 1 ? `${n(node.load)} req/s each (split over ${node.machines})` : `${n(node.load)} req/s`;
      return `${each} ÷ ${n(node.capacity)} req/s per instance`;
    }
    case 'cache':
      return `${n(node.load)} lookups/s ÷ ${n(node.capacity)} per second · hits about ${formatPercent(node.hitRate ?? 0, (node.hitRate ?? 0) < 0.1 ? 1 : 0)} of reads at best in this run`;
    case 'database':
      return `${n(node.readRps ?? 0)} reads + ${n(node.writeRps ?? 0)} writes × ${node.writeCost} = ${n(node.load)} of ${n(node.capacity)} reads/s`;
    case 'readReplicas': {
      const reads = node.readRps ?? 0;
      return `${n(reads)} reads ÷ ${node.machines} = ${n(reads / node.machines)} each, + ${n(node.writeRps ?? 0)} writes replayed × ${node.writeCost} = ${n(node.load)} of ${n(node.capacity)} reads/s per replica`;
    }
    case 'shards': {
      const shares = node.shardShares ?? [];
      const hottest = node.hottestShard ?? 0;
      const total = (node.readRps ?? 0) + (node.writeRps ?? 0) * (node.writeCost ?? 1);
      const reads = (node.readRps ?? 0) > 0 ? `${n(node.readRps ?? 0)} reads + ` : '';
      return `${reads}${n(node.writeRps ?? 0)} writes × ${node.writeCost} = ${n(total)} · shard ${hottest + 1} gets ${formatPercent(shares[hottest] ?? 0)} = ${n(node.load)} of ${n(node.capacity)} reads/s`;
    }
    case 'queue': {
      const q = node.queue;
      if (!q) return '';
      const backlog = `${n(q.peakArrivalRps)} orders/s in at the peak, ${n(q.drainRps)}/s charged · backlog up to ${n(q.peakBacklog)} of ${n(q.maxDepth)}`;
      if (!Number.isFinite(q.deadlineSec)) return backlog;
      const wait = Number.isFinite(q.maxWaitSec) ? formatSeconds(q.maxWaitSec) : 'forever';
      return `${backlog} · oldest waits ${wait} of ${formatSeconds(q.deadlineSec)}`;
    }
    case 'paymentProvider':
      return `${n(node.load)} calls/s ÷ ${n(node.capacity)} calls/s allowed`;
  }
}
