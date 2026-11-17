/**
 * Everything the UI knows about each component kind, in one place: palette text, default settings, the one-line
 * summary on its canvas node, where it sits in the flow, and its rows on the briefing's reference card. What players
 * call each kind (a real-world product beside the concept) is presentation, so it is the theme's: `componentNames`.
 *
 * Pure data and functions, no React, so the draft operations and tests can use it. The React pieces per kind (canvas
 * node, inspector fields) are registered next to their components: `canvas/nodes/index.ts`, `editor/fields.tsx`.
 * Adding a component kind means adding an entry here and in those two maps; TypeScript points out anything missing.
 */
import {
  APP_SERVER_SIZES,
  CACHE,
  CACHE_SIZES,
  DATABASE_SIZES,
  LOAD_BALANCER,
  PAYMENT_PROVIDER,
  QUEUE,
  QUEUE_SIZES,
  REPLICATION,
  SHARDING,
  workerThroughput,
  type ComponentKind,
  type Level,
  type NodeSpec,
} from '@five-nines/sim';
import { formatCompact, formatDurationShort, formatMs, formatUsd, formatUsdPerMonth } from '../format.ts';

/** The spec type of one component kind. */
export type SpecOf<K extends ComponentKind> = Extract<NodeSpec, { kind: K }>;

export interface ComponentMeta<K extends ComponentKind> {
  /** New ids are `${idPrefix}-1`, `${idPrefix}-2`, … */
  idPrefix: string;
  /** One-line palette hint. */
  hint: string;
  /** Palette price, e.g. "from $60". */
  priceLabel: string;
  /**
   * A new component with the engine's defaults. `level`, when given, fills settings that only make sense against a
   * level's workload (a sharded database's shard key).
   */
  create(id: string, level?: Level): SpecOf<K>;
  /** The node's one-line summary under its name, e.g. "xlarge × 4 · 64 vCPU". */
  summary(spec: SpecOf<K>): string;
  /**
   * The kinds this one naturally sits to the right of in the left-to-right flow. A new one is placed a column
   * right of the rightmost of them, or of the clients when there are none.
   */
  follows: readonly ComponentKind[];
  /**
   * The briefing's reference card: what its figures are per (shown after the theme's name for the kind), or null, and
   * rows of [option, capacity, monthly price].
   */
  reference: { per: string | null; rows: readonly (readonly [string, string, string])[] };
}

type Registry = { [K in ComponentKind]: ComponentMeta<K> };

const sizes = <S extends string>(table: Record<S, unknown>) => Object.keys(table) as S[];

export const COMPONENTS: Registry = {
  appServer: {
    idPrefix: 'app',
    hint: 'Runs your code. Choose a size and how many instances.',
    priceLabel: `from ${formatUsd(APP_SERVER_SIZES.small.usdPerMonth)}`,
    create: (id) => ({ id, kind: 'appServer', size: 'small', instances: 1 }),
    summary: (spec) => `${spec.size} × ${spec.instances} · ${APP_SERVER_SIZES[spec.size].vcpu * spec.instances} vCPU`,
    follows: ['loadBalancer'],
    reference: {
      per: 'per instance',
      rows: sizes(APP_SERVER_SIZES).map((size) => [
        size,
        `${APP_SERVER_SIZES[size].vcpu} vCPU`,
        formatUsdPerMonth(APP_SERVER_SIZES[size].usdPerMonth),
      ]),
    },
  },

  loadBalancer: {
    idPrefix: 'lb',
    hint: 'Spreads requests across app server instances.',
    priceLabel: formatUsd(LOAD_BALANCER.usdPerMonth),
    create: (id) => ({ id, kind: 'loadBalancer', healthCheckIntervalSec: 30, retryOnConnectFailure: false }),
    summary: (spec) => `checks ${spec.healthCheckIntervalSec}s · retries ${spec.retryOnConnectFailure ? 'on' : 'off'}`,
    follows: [],
    reference: {
      per: null,
      rows: [['any', `${formatMs(LOAD_BALANCER.latencyMs)} added`, formatUsdPerMonth(LOAD_BALANCER.usdPerMonth)]],
    },
  },

  cache: {
    idPrefix: 'cache',
    hint: 'Keeps popular data in memory. App servers check it before the database.',
    priceLabel: `from ${formatUsd(CACHE_SIZES.small.usdPerMonth)}`,
    create: (id) => ({ id, kind: 'cache', size: 'small', ttlSec: 60 }),
    summary: (spec) =>
      [
        `${CACHE_SIZES[spec.size].memoryGb} GB · TTL ${formatDurationShort(spec.ttlSec)}`,
        spec.coalesceMisses && 'coalesced',
        spec.invalidateOnWrite && 'invalidated',
        spec.replicated && 'replicated',
      ]
        .filter(Boolean)
        .join(' · '),
    follows: ['appServer'],
    reference: {
      per: `${formatCompact(CACHE.opsPerSec)} lookups/s`,
      rows: sizes(CACHE_SIZES).map((size) => [
        size,
        `${CACHE_SIZES[size].memoryGb} GB`,
        formatUsdPerMonth(CACHE_SIZES[size].usdPerMonth),
      ]),
    },
  },

  database: {
    idPrefix: 'db',
    hint: 'The primary: every write goes here, and any read not sent elsewhere.',
    priceLabel: `from ${formatUsd(DATABASE_SIZES.small.usdPerMonth)}`,
    create: (id) => ({ id, kind: 'database', size: 'small' }),
    summary: (spec) => `${spec.size} · ${databaseCapacity(spec.size)}`,
    follows: ['appServer'],
    reference: {
      per: 'reads or writes per second',
      rows: sizes(DATABASE_SIZES).map((size) => [
        size,
        databaseCapacity(size),
        formatUsdPerMonth(DATABASE_SIZES[size].usdPerMonth),
      ]),
    },
  },

  readReplicas: {
    idPrefix: 'replicas',
    hint: 'Copies of the database that serve reads, a little behind it.',
    priceLabel: `from ${formatUsd(DATABASE_SIZES.small.usdPerMonth)}`,
    create: (id) => ({ id, kind: 'readReplicas', size: 'small', count: 2, readYourWritesSec: 0 }),
    summary: (spec) =>
      `${spec.size} × ${spec.count} · ${spec.readYourWritesSec > 0 ? `pin ${formatDurationShort(spec.readYourWritesSec)}` : 'no pinning'}`,
    follows: ['database'],
    reference: {
      per: 'per replica',
      rows: [
        ['any', 'same sizes as the database', 'same price'],
        ['lag', `${REPLICATION.baseLagSec} s ÷ (1 − busy)`, ''],
      ],
    },
  },

  shards: {
    idPrefix: 'shards',
    hint: 'Splits the data across several databases by a shard key. Each shard takes its own writes.',
    priceLabel: `from ${formatUsd(DATABASE_SIZES.small.usdPerMonth * SHARDING.minCount)}`,
    create: (id, level) => ({
      id,
      kind: 'shards',
      size: 'small',
      count: 4,
      shardKey: level?.workload.data?.shardKeys?.[0]?.id ?? '',
    }),
    summary: (spec) => `${spec.size} × ${spec.count} · by ${spec.shardKey || '?'}`,
    follows: ['appServer'],
    reference: {
      per: 'per shard',
      rows: [
        ['any', 'same sizes as the database', 'same price'],
        ['count', `${SHARDING.minCount} to ${SHARDING.maxCount} shards`, ''],
      ],
    },
  },

  queue: {
    idPrefix: 'queue',
    hint: 'Holds orders so app servers answer at once; workers charge them at the provider later.',
    priceLabel: `from ${formatUsd(QUEUE_SIZES.small.usdPerMonth)}`,
    create: (id) => ({ id, kind: 'queue', size: 'small', workers: 4 }),
    summary: (spec) => `holds ${formatCompact(QUEUE_SIZES[spec.size].maxDepth)} · ${spec.workers} workers`,
    follows: ['appServer'],
    reference: {
      per: 'messages it holds',
      rows: [
        ...sizes(QUEUE_SIZES).map(
          (size) =>
            [
              size,
              `${formatCompact(QUEUE_SIZES[size].maxDepth)} messages`,
              formatUsdPerMonth(QUEUE_SIZES[size].usdPerMonth),
            ] as const,
        ),
        ['worker', `${QUEUE.workerConcurrency} charges in flight`, formatUsdPerMonth(QUEUE.workerUsdPerMonth)],
      ],
    },
  },

  paymentProvider: {
    idPrefix: 'payments',
    hint: 'The outside service that charges cards. It refuses calls over its rate limit.',
    priceLabel: formatUsd(PAYMENT_PROVIDER.usdPerMonth),
    create: (id) => ({ id, kind: 'paymentProvider' }),
    summary: () => 'external · rate limited',
    follows: ['queue', 'appServer'],
    reference: {
      per: null,
      rows: [['any', 'rate limit set by the level', formatUsdPerMonth(PAYMENT_PROVIDER.usdPerMonth)]],
    },
  },
};

/** "100 charges/s per worker" for a level's provider latency. */
export function workerRateLabel(level: Level): string | null {
  const payments = level.workload.payments;
  return payments ? `${formatCompact(workerThroughput(payments))} charges/s per worker` : null;
}

/** "10k reads · 4k writes" */
function databaseCapacity(size: keyof typeof DATABASE_SIZES): string {
  const { readsPerSec, writesPerSec } = DATABASE_SIZES[size];
  return `${formatCompact(readsPerSec)} reads · ${formatCompact(writesPerSec)} writes`;
}

export function componentMeta<K extends ComponentKind>(kind: K): ComponentMeta<K> {
  return COMPONENTS[kind];
}

/** The summary line of any node spec. */
export function nodeSummary(spec: NodeSpec): string {
  // TypeScript can't relate `spec.kind` to the matching entry's parameter type; the registry's type guarantees it.
  return (COMPONENTS[spec.kind].summary as (spec: NodeSpec) => string)(spec);
}
