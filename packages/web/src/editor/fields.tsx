/**
 * The inspector's settings for each component kind. `FIELDS` has an entry for every kind in the engine's
 * `ComponentKind`; the inspector picks one by the selected node's kind.
 *
 * The fields show each option's capacity and price. The inspector shows the expected peak utilization under them
 * (`ExpectedLoad`), with the arithmetic, never a predicted latency: reading that is the run's job.
 */
import {
  APP_SERVER_SIZES,
  CACHE,
  CACHE_SIZES,
  CACHE_TTLS,
  cacheCapacityKeys,
  DATABASE_SIZES,
  HEALTH_CHECK,
  READ_YOUR_WRITES_WINDOWS,
  REPLICATION,
  type AppServerSize,
  type CacheSize,
  type ComponentKind,
  type DatabaseSize,
  type Level,
  type NodeSpec,
} from '@five-nines/sim';
import type { ComponentType } from 'react';
import type { SpecOf } from '../components/registry.ts';
import { formatCompact, formatCount, formatDurationShort, formatUsd } from '../format.ts';
import { HEALTH_CHECK_INTERVALS, MAX_INSTANCES, MIN_INSTANCES } from './config.ts';
import { SegmentedControl, Stepper, Toggle, type SegmentedOption } from './controls.tsx';

export interface FieldsProps<K extends ComponentKind> {
  spec: SpecOf<K>;
  onChange(node: NodeSpec): void;
  level: Level;
}

/** The settings for any node, by its kind. */
export function NodeFields({ spec, onChange, level }: { spec: NodeSpec; onChange(node: NodeSpec): void; level: Level }) {
  // TypeScript can't relate `spec.kind` to the matching entry's props; the registry's type guarantees it.
  const Fields = FIELDS[spec.kind] as ComponentType<FieldsProps<ComponentKind>>;
  return <Fields spec={spec} onChange={onChange} level={level} />;
}

// ---------------------------------------------------------------------------
// App server and load balancer
// ---------------------------------------------------------------------------

const APP_SIZE_OPTIONS: SegmentedOption<AppServerSize>[] = (Object.keys(APP_SERVER_SIZES) as AppServerSize[]).map((size) => ({
  value: size,
  label: size,
  detail: (
    <>
      <span>{APP_SERVER_SIZES[size].vcpu} vCPU</span>
      <span>{formatUsd(APP_SERVER_SIZES[size].usdPerMonth)}</span>
    </>
  ),
}));

function AppServerFields({ spec, onChange }: FieldsProps<'appServer'>) {
  const { vcpu, usdPerMonth } = APP_SERVER_SIZES[spec.size];
  return (
    <>
      <div className="field">
        <div className="field__label">Size</div>
        <SegmentedControl label="Size" options={APP_SIZE_OPTIONS} value={spec.size} onChange={(size) => onChange({ ...spec, size })} />
        <p className="field__help">Each vCPU works on one request at a time. Prices are per instance per month.</p>
      </div>
      <div className="field">
        <div className="field__label">Instances</div>
        <div className="field__row">
          <Stepper
            label="Instances"
            value={spec.instances}
            min={MIN_INSTANCES}
            max={MAX_INSTANCES}
            onChange={(instances) => onChange({ ...spec, instances })}
          />
          <span className="field__aside num">{vcpu * spec.instances} vCPU total</span>
        </div>
        <p className="field__help">
          {spec.instances} × {formatUsd(usdPerMonth)}. More than one instance needs a load balancer in front.
        </p>
      </div>
    </>
  );
}

const INTERVAL_OPTIONS: SegmentedOption<number>[] = HEALTH_CHECK_INTERVALS.map((sec) => ({ value: sec, label: `${sec} s` }));

function LoadBalancerFields({ spec, onChange }: FieldsProps<'loadBalancer'>) {
  const detectSec = spec.healthCheckIntervalSec * HEALTH_CHECK.unhealthyThreshold;
  return (
    <>
      <div className="field">
        <div className="field__label">Health-check interval</div>
        <SegmentedControl
          label="Health-check interval"
          options={INTERVAL_OPTIONS}
          value={spec.healthCheckIntervalSec}
          onChange={(healthCheckIntervalSec) => onChange({ ...spec, healthCheckIntervalSec })}
        />
        <p className="field__help">
          How often the balancer probes each instance. After {HEALTH_CHECK.unhealthyThreshold} failed checks (about{' '}
          {detectSec} s here) a dead instance leaves rotation.
        </p>
      </div>
      <div className="field">
        <Toggle
          label="Retry on connection failure"
          checked={spec.retryOnConnectFailure}
          onChange={(retryOnConnectFailure) => onChange({ ...spec, retryOnConnectFailure })}
        />
        <p className="field__help">
          When an instance refuses the connection (it has crashed), send the request to another instance instead of
          failing it. Safe because the request never started.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Data tier
// ---------------------------------------------------------------------------

const CACHE_SIZE_OPTIONS: SegmentedOption<CacheSize>[] = (Object.keys(CACHE_SIZES) as CacheSize[]).map((size) => ({
  value: size,
  label: size,
  detail: (
    <>
      <span>{CACHE_SIZES[size].memoryGb} GB</span>
      <span>{formatUsd(CACHE_SIZES[size].usdPerMonth)}</span>
    </>
  ),
}));

const TTL_OPTIONS: SegmentedOption<number>[] = CACHE_TTLS.map((sec) => ({ value: sec, label: formatDurationShort(sec) }));

function CacheFields({ spec, onChange, level }: FieldsProps<'cache'>) {
  const valueKb = level.workload.data?.keys.valueKb;
  const holds = valueKb === undefined ? null : cacheCapacityKeys(CACHE_SIZES[spec.size].memoryGb, valueKb);
  return (
    <>
      <div className="field">
        <div className="field__label">Memory</div>
        <SegmentedControl label="Memory" options={CACHE_SIZE_OPTIONS} value={spec.size} onChange={(size) => onChange({ ...spec, size })} />
        <p className="field__help">
          {holds !== null && (
            <>
              Holds {formatCount(holds)} values of {formatCount(valueKb!)} KB, the most popular ones.{' '}
            </>
          )}
          Every size serves {formatCompact(CACHE.opsPerSec)} lookups a second. It starts empty and fills as data is read.
        </p>
      </div>
      <div className="field">
        <div className="field__label">Expiry (TTL)</div>
        <SegmentedControl
          label="Expiry"
          options={TTL_OPTIONS}
          value={spec.ttlSec}
          onChange={(ttlSec) => onChange({ ...spec, ttlSec })}
        />
        <p className="field__help">
          How long a cached value lives before the next read fetches it again. Longer keeps more reads in the cache;
          shorter keeps the data fresher, since a cached value can be up to this old.
        </p>
      </div>
    </>
  );
}

const DATABASE_SIZE_OPTIONS: SegmentedOption<DatabaseSize>[] = (Object.keys(DATABASE_SIZES) as DatabaseSize[]).map((size) => ({
  value: size,
  label: size,
  detail: (
    <>
      <span>{formatCompact(DATABASE_SIZES[size].readsPerSec)} r/s</span>
      <span>{formatCompact(DATABASE_SIZES[size].writesPerSec)} w/s</span>
      <span>{formatUsd(DATABASE_SIZES[size].usdPerMonth)}</span>
    </>
  ),
}));

function DatabaseFields({ spec, onChange }: FieldsProps<'database'>) {
  const { readsPerSec, writesPerSec } = DATABASE_SIZES[spec.size];
  return (
    <div className="field">
      <div className="field__label">Size</div>
      <SegmentedControl label="Size" options={DATABASE_SIZE_OPTIONS} value={spec.size} onChange={(size) => onChange({ ...spec, size })} />
      <p className="field__help">
        Reads per second, or writes per second: they share the machine, so one write costs as much as{' '}
        {readsPerSec / writesPerSec} reads. Every write goes to this primary.
      </p>
    </div>
  );
}

const PIN_OPTIONS: SegmentedOption<number>[] = READ_YOUR_WRITES_WINDOWS.map((sec) => ({
  value: sec,
  label: sec === 0 ? 'Off' : `${sec} s`,
}));

function ReadReplicasFields({ spec, onChange }: FieldsProps<'readReplicas'>) {
  return (
    <>
      <div className="field">
        <div className="field__label">Size</div>
        <SegmentedControl label="Size" options={DATABASE_SIZE_OPTIONS} value={spec.size} onChange={(size) => onChange({ ...spec, size })} />
        <p className="field__help">
          Each replica is a full copy: it serves an equal share of the reads and replays every write, at{' '}
          {REPLICATION.replayCost * 100}% of what the write cost the primary. Prices are per replica.
        </p>
      </div>
      <div className="field">
        <div className="field__label">Replicas</div>
        <div className="field__row">
          <Stepper
            label="Replicas"
            value={spec.count}
            min={1}
            max={REPLICATION.maxCount}
            onChange={(count) => onChange({ ...spec, count })}
          />
          <span className="field__aside num">{formatUsd(DATABASE_SIZES[spec.size].usdPerMonth * spec.count)}</span>
        </div>
        <p className="field__help">
          Replicas lag behind the primary: {REPLICATION.baseLagSec} s when idle, {REPLICATION.baseLagSec} s ÷ (1 − busy)
          when not, and further every second they're overloaded.
        </p>
      </div>
      <div className="field">
        <div className="field__label">Read-your-writes window</div>
        <SegmentedControl
          label="Read-your-writes window"
          options={PIN_OPTIONS}
          value={spec.readYourWritesSec}
          onChange={(readYourWritesSec) => onChange({ ...spec, readYourWritesSec })}
        />
        <p className="field__help">
          For this long after a user writes, send that user's reads to the primary instead, so they always see their
          own write. The primary has to handle those reads too.
        </p>
      </div>
    </>
  );
}

const FIELDS: { [K in ComponentKind]: ComponentType<FieldsProps<K>> } = {
  appServer: AppServerFields,
  loadBalancer: LoadBalancerFields,
  cache: CacheFields,
  database: DatabaseFields,
  readReplicas: ReadReplicasFields,
};
