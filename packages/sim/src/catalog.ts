/**
 * Every tunable constant of the simulation lives here, so calibration happens in one place.
 * Prices are monthly USD, loosely based on public-cloud on-demand pricing.
 */

/** Simulated time per tick. */
export const TICK_SEC = 0.1;

/** Sampled requests walked through the design each tick, used for latency percentiles and visuals. */
export const PROBES_PER_TICK = 40;

/** Network latency of one hop inside a region. */
export const HOP_LATENCY_MS = 0.5;

/** Time to learn that a crashed instance refused the connection. */
export const CONNECT_FAIL_MS = 1;

/** Consecutive health checks needed to remove an instance from rotation, or to restore it. */
export const HEALTH_CHECK = {
  unhealthyThreshold: 2,
  healthyThreshold: 2,
} as const;

export type AppServerSize = 'small' | 'medium' | 'large' | 'xlarge';

/** An app server works on one request per vCPU at a time (CPU-bound workloads). */
export const APP_SERVER_SIZES: Record<AppServerSize, { vcpu: number; usdPerMonth: number }> = {
  small: { vcpu: 2, usdPerMonth: 60 },
  medium: { vcpu: 4, usdPerMonth: 120 },
  large: { vcpu: 8, usdPerMonth: 240 },
  xlarge: { vcpu: 16, usdPerMonth: 480 },
};

export const LOAD_BALANCER = {
  usdPerMonth: 25,
  maxRps: 100_000,
  latencyMs: 1,
} as const;

/** Availability needed for each grade. Requests that fail or time out count against it. */
export const AVAILABILITY_TIERS = {
  pass: 0.999,
  star: 0.9999,
  mastered: 0.99999,
} as const;

/** The reserved id of the traffic source in every design. */
export const CLIENTS_ID = 'clients';

export const COMPONENT_LABELS = {
  appServer: 'App server',
  loadBalancer: 'Load balancer',
  cache: 'Cache',
  database: 'Database',
  readReplicas: 'Read replicas',
  shards: 'Shards',
  queue: 'Queue',
  paymentProvider: 'Payment provider',
  blobStorage: 'Blob storage',
} as const;

// ---------------------------------------------------------------------------
// Data tier
// ---------------------------------------------------------------------------

export type CacheSize = 'small' | 'medium' | 'large' | 'xlarge';

/**
 * An in-memory cache node (Redis/Memcached-like). It holds as many values as fit in memory, and the hit rate follows
 * from how the level's reads spread over the keys. Every size serves the same number of operations: memory is what
 * you pay for.
 */
export const CACHE_SIZES: Record<CacheSize, { memoryGb: number; usdPerMonth: number }> = {
  small: { memoryGb: 2, usdPerMonth: 30 },
  medium: { memoryGb: 8, usdPerMonth: 110 },
  large: { memoryGb: 32, usdPerMonth: 420 },
  xlarge: { memoryGb: 128, usdPerMonth: 1_600 },
};

export const CACHE = {
  /** Lookups per second one cache node serves. Invalidations (deletes on write) cost one lookup each. */
  opsPerSec: 100_000,
  /** Lookups it works on at once. */
  workers: 4,
  /** A replicated cache runs a standby copy that takes over, contents intact, if the node restarts: it costs this many times as much. */
  replicatedCostFactor: 2,
} as const;

export type DatabaseSize = 'small' | 'medium' | 'large' | 'xlarge';

/**
 * A relational database server (Postgres-like). Reads and writes share the machine: a write costs as much as
 * `readsPerSec / writesPerSec` reads. Read replicas are the same machines.
 */
export const DATABASE_SIZES: Record<DatabaseSize, { vcpu: number; readsPerSec: number; writesPerSec: number; usdPerMonth: number }> =
  {
    small: { vcpu: 2, readsPerSec: 2_500, writesPerSec: 1_000, usdPerMonth: 150 },
    medium: { vcpu: 4, readsPerSec: 5_000, writesPerSec: 2_000, usdPerMonth: 300 },
    large: { vcpu: 8, readsPerSec: 10_000, writesPerSec: 4_000, usdPerMonth: 600 },
    xlarge: { vcpu: 16, readsPerSec: 20_000, writesPerSec: 8_000, usdPerMonth: 1_200 },
  };

export const REPLICATION = {
  /**
   * Lag of an idle replica. A busy replica lags more: base ÷ (1 − utilization), so 50% busy doubles it and 90%
   * busy multiplies it by ten.
   */
  baseLagSec: 0.2,
  /** Replaying a write from the primary's log costs a replica this share of what running the write cost the primary. */
  replayCost: 0.5,
  /** The busy-lag formula is capped at this utilization; beyond full load the replica falls further behind instead. */
  maxLagUtilization: 0.98,
  /** Lag at which the event log reports that replicas fell behind. */
  alertLagSec: 1,
  /** Most replicas in one group. */
  maxCount: 16,
} as const;

/** The read-your-writes windows the game offers, in seconds. 0 is off. */
export const READ_YOUR_WRITES_WINDOWS = [0, 1, 2, 5, 10, 30] as const;

/** The cache expiry times (TTL) the game offers, in seconds. */
export const CACHE_TTLS = [5, 10, 60, 300, 3_600] as const;

// ---------------------------------------------------------------------------
// Sharding
// ---------------------------------------------------------------------------

/**
 * A sharded database: several primaries of one size, each holding the keys the shard key assigns it. They are the
 * database machines (`DATABASE_SIZES`), priced per shard.
 */
export const SHARDING = {
  minCount: 2,
  maxCount: 16,
} as const;

// ---------------------------------------------------------------------------
// Queues, workers and the payment provider
// ---------------------------------------------------------------------------

export type QueueSize = 'small' | 'medium' | 'large' | 'xlarge';

/** A message queue (SQS/RabbitMQ-like): its size is how many messages it holds before refusing more. */
export const QUEUE_SIZES: Record<QueueSize, { maxDepth: number; usdPerMonth: number }> = {
  small: { maxDepth: 10_000, usdPerMonth: 20 },
  medium: { maxDepth: 100_000, usdPerMonth: 45 },
  large: { maxDepth: 1_000_000, usdPerMonth: 120 },
  xlarge: { maxDepth: 10_000_000, usdPerMonth: 450 },
};

export const QUEUE = {
  /** Time to put a message on the queue and answer the producer. */
  enqueueMs: 2,
  /**
   * Charges one worker keeps in flight. A worker mostly waits on the provider, so it handles concurrency ÷ the
   * provider's latency charges a second: 30 ÷ 300 ms = 100.
   */
  workerConcurrency: 30,
  /** One worker's monthly price (a small VM). */
  workerUsdPerMonth: 60,
  maxWorkers: 64,
} as const;

/** An external payment provider. It bills per charge, outside the infrastructure budget. */
export const PAYMENT_PROVIDER = {
  usdPerMonth: 0,
} as const;

// ---------------------------------------------------------------------------
// Blob storage
// ---------------------------------------------------------------------------

/**
 * Blob storage (S3-like object storage): objects of any size kept by key, replicated across zones by the provider.
 * Nothing to size or count: it scales by key prefix and bills by use. Figures follow S3 Standard's published numbers.
 *
 * In the catalog, but no level offers it yet. A level that does will need, in the engine: a request-latency model
 * (first byte, plus transfer time for large objects), a per-prefix rate limit that refuses or slows requests over it
 * (the way the payment provider's limit does), and a usage-based cost taken from the level's workload (objects
 * stored, reads and writes a month) instead of a monthly machine price.
 */
export const BLOB_STORAGE = {
  /** GETs a second one key prefix serves before the store starts slowing requests down. */
  readsPerSecPerPrefix: 5_500,
  /** PUTs a second one key prefix serves. */
  writesPerSecPerPrefix: 3_500,
  /** Time to the first byte of a small object, typical. */
  firstByteMs: 30,
  /** Stored data, per GB a month. */
  usdPerGbMonth: 0.023,
  /** Per million GETs. */
  usdPerMillionReads: 0.4,
  /** Per million PUTs. */
  usdPerMillionWrites: 5,
  /** Billed by use, so nothing per month before any is used. */
  usdPerMonth: 0,
} as const;
