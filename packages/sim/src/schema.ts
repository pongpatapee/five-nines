import { z } from 'zod';
import { CLIENTS_ID, QUEUE, REPLICATION, SHARDING } from './catalog.ts';

// ---------------------------------------------------------------------------
// Designs: what the player builds.
// ---------------------------------------------------------------------------

const NodeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes, starting with a letter.')
  .refine((id) => id !== CLIENTS_ID, `"${CLIENTS_ID}" is reserved for the traffic source.`);

export const ComponentKindSchema = z.enum([
  'appServer',
  'loadBalancer',
  'cache',
  'database',
  'readReplicas',
  'shards',
  'queue',
  'paymentProvider',
  'blobStorage',
]);
export type ComponentKind = z.output<typeof ComponentKindSchema>;

export const AppServerSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('appServer'),
  size: z.enum(['small', 'medium', 'large', 'xlarge']),
  instances: z.int().min(1).max(64).default(1),
});
export type AppServerSpec = z.output<typeof AppServerSpecSchema>;

export const LoadBalancerSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('loadBalancer'),
  healthCheckIntervalSec: z.int().min(5).max(300).default(30),
  /** Retry a request on another instance when the chosen one refuses the connection. */
  retryOnConnectFailure: z.boolean().default(false),
});
export type LoadBalancerSpec = z.output<typeof LoadBalancerSpecSchema>;

const SizeSchema = z.enum(['small', 'medium', 'large', 'xlarge']);

/** A look-aside cache: app servers check it before the database, and fill it on a miss. */
export const CacheSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('cache'),
  size: SizeSchema,
  /** How long a cached value lives before it expires and the next read fetches it again. */
  ttlSec: z.int().min(1).max(86_400).default(60),
  /**
   * Request coalescing: a miss on a key that is already being fetched waits for that fetch instead of sending its own
   * read to the database. Absent means off, as for the other options below.
   */
  coalesceMisses: z.boolean().optional(),
  /** Every write deletes its key from the cache, so the next read fetches the new value. */
  invalidateOnWrite: z.boolean().optional(),
  /** A standby copy of the cache node that takes over, contents intact, if the node restarts. */
  replicated: z.boolean().optional(),
});
export type CacheSpec = z.output<typeof CacheSpecSchema>;

/** The primary database: every write goes here, and any read not sent elsewhere. */
export const DatabaseSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('database'),
  size: SizeSchema,
});
export type DatabaseSpec = z.output<typeof DatabaseSpecSchema>;

/** Copies of the primary that serve reads. They replay the primary's writes, a little behind it. */
export const ReadReplicasSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('readReplicas'),
  size: SizeSchema,
  count: z.int().min(1).max(REPLICATION.maxCount).default(2),
  /**
   * Read-your-writes pinning: a user's reads within this many seconds of their own write go to the primary instead,
   * so they can't miss that write. 0 turns it off.
   */
  readYourWritesSec: z.number().min(0).max(60).default(0),
});
export type ReadReplicasSpec = z.output<typeof ReadReplicasSpecSchema>;

/**
 * A sharded database: `count` primaries of one size, each holding the keys the shard key sends it. Takes the place of
 * a single database; every read and write goes to the shard that owns its key.
 */
export const ShardsSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('shards'),
  size: SizeSchema,
  count: z.int().min(SHARDING.minCount).max(SHARDING.maxCount).default(4),
  /** Which of the level's shard keys (`workload.data.shardKeys`) splits the data. Validation checks it exists. */
  shardKey: z.string(),
});
export type ShardsSpec = z.output<typeof ShardsSpecSchema>;

/**
 * A message queue with a pool of workers. App servers put each order on it and answer at once; the workers take
 * orders off in arrival order and charge them at the payment provider.
 */
export const QueueSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('queue'),
  /** How many messages it holds (`QUEUE_SIZES`). */
  size: SizeSchema,
  workers: z.int().min(1).max(QUEUE.maxWorkers).default(4),
});
export type QueueSpec = z.output<typeof QueueSpecSchema>;

/** The external payment provider of the level's `workload.payments`. Calls over its rate limit are refused. */
export const PaymentProviderSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('paymentProvider'),
});
export type PaymentProviderSpec = z.output<typeof PaymentProviderSpecSchema>;

/**
 * Blob storage (S3-like): objects kept by key, paid for by use rather than by machine. In the catalog but not yet in
 * any level (`COMPONENTS_IN_CAMPAIGN`), so validation turns it away everywhere and the engine never runs it.
 */
export const BlobStorageSpecSchema = z.strictObject({
  id: NodeIdSchema,
  kind: z.literal('blobStorage'),
});
export type BlobStorageSpec = z.output<typeof BlobStorageSpecSchema>;

export const NodeSpecSchema = z.discriminatedUnion('kind', [
  AppServerSpecSchema,
  LoadBalancerSpecSchema,
  CacheSpecSchema,
  DatabaseSpecSchema,
  ReadReplicasSpecSchema,
  ShardsSpecSchema,
  QueueSpecSchema,
  PaymentProviderSpecSchema,
  BlobStorageSpecSchema,
]);
export type NodeSpec = z.output<typeof NodeSpecSchema>;

export const EdgeSchema = z.strictObject({ from: z.string(), to: z.string() });
export type Edge = z.output<typeof EdgeSchema>;

export const DesignSchema = z.strictObject({
  nodes: z.array(NodeSpecSchema),
  edges: z.array(EdgeSchema),
});
export type Design = z.output<typeof DesignSchema>;

// ---------------------------------------------------------------------------
// Levels: the puzzle definitions.
// ---------------------------------------------------------------------------

export const GradeSchema = z.enum(['fail', 'pass', 'star', 'mastered']);
export type Grade = z.output<typeof GradeSchema>;

export const CheckNameSchema = z.enum(['availability', 'latency', 'budget']);
export type CheckName = z.output<typeof CheckNameSchema>;

const TrafficPointSchema = z.strictObject({
  atSec: z.number().min(0),
  rps: z.number().min(0),
});

const KeyDistributionSchema = z.strictObject({
  /** Distinct keys (rows, articles, profiles…) in the dataset. */
  count: z.int().min(1),
  /** What one key is, plural, as the player reads it in the level's numbers: "articles", "profiles". */
  label: z.string().min(1).optional(),
  /**
   * Zipf skew of how reads spread over the keys: the k-th most popular key gets a share proportional to k^−zipf.
   * 0 is uniform; around 1 is typical of web content, where a few keys get most of the traffic. Writes follow the
   * same spread.
   */
  zipf: z.number().min(0).max(2),
  /** Size of one cached value, which decides how many keys fit in a cache's memory. */
  valueKb: z.number().positive(),
});
export type KeyDistribution = z.output<typeof KeyDistributionSchema>;

/**
 * An attribute a sharded database can split its data by, and how the data operations spread over its values.
 *
 * - `hash`: each value goes to the shard its hash picks. Values are as skewed as Zipf with this exponent says, so the
 *   most popular values can still pile up on one shard.
 * - `sequential`: values only grow (a timestamp, an auto-increment id), and shards own ranges of them, so all new
 *   data goes to the shard with the newest range.
 */
const ShardKeySchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  /** "user ID", as the player reads it. */
  label: z.string().min(1),
  spread: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('hash'), count: z.int().min(1), zipf: z.number().min(0).max(2) }),
    z.strictObject({ kind: z.literal('sequential') }),
  ]),
});
export type ShardKey = z.output<typeof ShardKeySchema>;

/**
 * What each request does to the data tier, after its CPU work on an app server: one read or one write of a key.
 * Levels without it have no data tier at all.
 */
const DataWorkloadSchema = z.strictObject({
  /** Share of requests that read; the rest write. */
  readShare: z.number().min(0).max(1),
  keys: KeyDistributionSchema,
  /**
   * Reads by a user of something they just wrote themselves (e.g. checking a balance after a transfer). They fail as
   * stale reads unless they see that write. The gap since the write is exponentially distributed.
   */
  readAfterWrite: z
    .strictObject({
      /** Share of reads that are read-after-write. */
      share: z.number().min(0).max(1),
      meanGapSec: z.number().positive(),
    })
    .optional(),
  /** The attributes a sharded database can be split by, in the order the player is offered them. */
  shardKeys: z
    .array(ShardKeySchema)
    .min(1)
    .refine((keys) => new Set(keys.map((key) => key.id)).size === keys.length, 'Shard key ids must be unique.')
    .optional(),
});
export type DataWorkload = z.output<typeof DataWorkloadSchema>;

/**
 * Each request a server finishes also charges a payment at an external provider: synchronously, or through a queue
 * whose workers make the call later.
 */
const PaymentWorkloadSchema = z.strictObject({
  /** The provider's hard limit: calls beyond it in any second are refused. */
  rateLimitRps: z.number().positive(),
  /** How long one charge takes at the provider. */
  latencyMs: z.number().positive(),
});
export type PaymentWorkload = z.output<typeof PaymentWorkloadSchema>;

const WorkloadSchema = z.strictObject({
  /** CPU time one request needs on an app server. */
  cpuMsPerRequest: z.number().positive(),
  /** Requests still waiting in a queue after this long fail. */
  timeoutMs: z.number().positive(),
  /** Request rate over time, linearly interpolated between points. */
  traffic: z
    .array(TrafficPointSchema)
    .min(1)
    .refine(
      (points) => points.every((p, i) => i === 0 || p.atSec > points[i - 1]!.atSec),
      'Traffic points must be in strictly increasing time order.',
    ),
  data: DataWorkloadSchema.optional(),
  payments: PaymentWorkloadSchema.optional(),
});

const InstanceFailureEventSchema = z.strictObject({
  atSec: z.number().min(0),
  kind: z.literal('instanceFailure'),
  /** Which instance crashes. "busiest" is the up instance receiving the most traffic (first in design order on ties). */
  target: z.strictObject({ kind: z.literal('appServer'), pick: z.literal('busiest') }),
});

/** A cache node restarts. Unless it is replicated, it comes back empty. */
const CacheRestartEventSchema = z.strictObject({
  atSec: z.number().min(0),
  kind: z.literal('cacheRestart'),
  /** "busiest" is the cache receiving the most lookups (first in design order on ties). */
  target: z.strictObject({ kind: z.literal('cache'), pick: z.literal('busiest') }),
});

/**
 * One value of a shard key suddenly takes a share of all data operations (a celebrity posts, and everyone reacts to
 * that one post). A database sharded by that key sends all of it to one shard; sharded by any other key, it spreads
 * like the rest.
 */
const HotKeyEventSchema = z.strictObject({
  atSec: z.number().min(0),
  kind: z.literal('hotKey'),
  untilSec: z.number().positive(),
  /** One of the level's `workload.data.shardKeys`. */
  shardKey: z.string(),
  /** Share of all data operations that go to the one value while it lasts. */
  share: z.number().gt(0).lt(1),
  /** What the value is, for the event log: "a celebrity's post". */
  label: z.string().min(1),
});

export const ScenarioEventSchema = z.discriminatedUnion('kind', [
  InstanceFailureEventSchema,
  CacheRestartEventSchema,
  HotKeyEventSchema,
]);
export type ScenarioEvent = z.output<typeof ScenarioEventSchema>;

const SolutionSchema = z.strictObject({
  name: z.string().min(1),
  explanation: z.string().min(1),
  design: DesignSchema,
  /** The grade CI asserts this design gets. A change here is a deliberate recalibration. */
  expectedGrade: GradeSchema.exclude(['fail']),
});

const AntiSolutionSchema = z.strictObject({
  name: z.string().min(1),
  explanation: z.string().min(1),
  design: DesignSchema,
  /** "invalid" if the design must be rejected before simulation, otherwise exactly the checks it must fail. */
  expectedFailure: z.union([z.literal('invalid'), z.array(CheckNameSchema).min(1)]),
});

/**
 * The napkin-math question the mentor asks before the player builds. Each quantity is worked out from the level's
 * own numbers (`estimate.ts`); `answer` records the result in the unit the player answers in, and CI checks it
 * against that working, so the two can't drift apart.
 */
export const EstimateSchema = z.discriminatedUnion('quantity', [
  /** vCPUs kept busy at the peak: peak req/s × CPU time per request. */
  z.strictObject({ quantity: z.literal('busyVcpusAtPeak'), answer: z.number().positive() }),
  /** App servers of one size needed so that losing any one still leaves enough capacity at the peak (N+1). */
  z.strictObject({ quantity: z.literal('serversWithSpare'), size: SizeSchema, answer: z.int().positive() }),
  /** The cache hit rate, in percent, that keeps a database of one size at or under full load at the peak. */
  z.strictObject({ quantity: z.literal('cacheHitRateNeeded'), databaseSize: SizeSchema, answer: z.number().min(0).max(100) }),
  /**
   * On average, the seconds between two reads of the same key at the peak, with reads spread evenly over the keys:
   * keys ÷ reads per second. Compared with a cache's expiry, it says whether a cached copy lives to be read again.
   */
  z.strictObject({ quantity: z.literal('secondsBetweenKeyReads'), answer: z.number().positive() }),
  /**
   * How busy a primary of one size is, in percent, at the peak, serving every read-after-write read (pinned to it so
   * it sees the reader's own write) plus every write.
   */
  z.strictObject({ quantity: z.literal('pinnedPrimaryLoad'), databaseSize: SizeSchema, answer: z.number().positive() }),
  /**
   * How busy a database of one size is, in percent, at the peak, serving every read and every write on its own: (reads
   * + writes × what one write costs in reads) ÷ its read capacity.
   */
  z.strictObject({ quantity: z.literal('databaseBusyAtPeak'), databaseSize: SizeSchema, answer: z.number().positive() }),
  /** Shards of one size that the peak writes fill completely: writes ÷ one shard's write capacity, before headroom. */
  z.strictObject({ quantity: z.literal('shardsAtFullLoad'), size: SizeSchema, answer: z.number().positive() }),
  /**
   * How many times a database of one size's read capacity arrives the moment the level's cache restart empties the
   * cache and every read falls through to it.
   */
  z.strictObject({ quantity: z.literal('coldCacheOverload'), databaseSize: SizeSchema, answer: z.number().positive() }),
  /**
   * The drain rate (per second) a queue needs so that the last order of the level's spike is processed within the
   * deadline: peak rate × spike length ÷ (deadline + spike length).
   */
  z.strictObject({ quantity: z.literal('queueDrainRateNeeded'), answer: z.number().positive() }),
]);
export type Estimate = z.output<typeof EstimateSchema>;
export type EstimateQuantity = Estimate['quantity'];

export const LevelSchema = z
  .strictObject({
    id: z.string().regex(/^\d{2}-[a-z0-9-]+$/),
    title: z.string().min(1),
    concept: z.string().min(1),
    briefing: z.array(z.string().min(1)).min(1),
    debrief: z.array(z.string().min(1)).min(1),
    components: z.array(ComponentKindSchema).min(1),
    durationSec: z.number().positive(),
    seed: z.int(),
    workload: WorkloadSchema,
    events: z.array(ScenarioEventSchema).default([]),
    requirements: z.strictObject({
      p99Ms: z.number().positive(),
      budgetUsdPerMonth: z.number().positive(),
      /**
       * How out of date a read may be: it fails as a stale read if the key changed more than this many seconds before
       * the read and the read missed that change. Unset means any staleness is fine. Read-after-write reads must
       * always see the reader's own write, whatever this says.
       */
      maxStalenessSec: z.number().min(0).optional(),
      /**
       * Work put on a queue must be done within this many seconds of being accepted; later, it fails as a missed
       * deadline. Unset means no deadline.
       */
      processWithinSec: z.number().positive().optional(),
    }),
    /** The napkin-math step before building. Optional: a level without one goes straight to the editor. */
    estimate: EstimateSchema.optional(),
    /** Reference designs shown to the player after an attempt. Any design that meets the requirements passes. */
    solutions: z.array(SolutionSchema).min(1),
    /** Known wrong answers. CI proves they fail; the debrief can show them as common traps. */
    antiSolutions: z.array(AntiSolutionSchema).default([]),
  })
  .superRefine((level, ctx) => {
    const { data, payments } = level.workload;
    if (data && payments) {
      // Each request would fail independently at both, and be counted twice. No level needs both yet.
      ctx.addIssue({ code: 'custom', message: 'A level has a data workload or payments, not both.' });
    }
    const shardKeys = new Set(data?.shardKeys?.map((key) => key.id) ?? []);
    for (const event of level.events) {
      if (event.kind === 'hotKey' && !shardKeys.has(event.shardKey)) {
        ctx.addIssue({ code: 'custom', message: `Hot key event names an unknown shard key "${event.shardKey}".` });
      }
      if (event.kind === 'hotKey' && event.untilSec <= event.atSec) {
        ctx.addIssue({ code: 'custom', message: 'A hot key event must end after it starts.' });
      }
    }
  });
export type Level = z.output<typeof LevelSchema>;
