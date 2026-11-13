import { z } from 'zod';
import { CLIENTS_ID, REPLICATION } from './catalog.ts';

// ---------------------------------------------------------------------------
// Designs: what the player builds.
// ---------------------------------------------------------------------------

const NodeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes, starting with a letter.')
  .refine((id) => id !== CLIENTS_ID, `"${CLIENTS_ID}" is reserved for the traffic source.`);

export const ComponentKindSchema = z.enum(['appServer', 'loadBalancer', 'cache', 'database', 'readReplicas']);
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

export const NodeSpecSchema = z.discriminatedUnion('kind', [
  AppServerSpecSchema,
  LoadBalancerSpecSchema,
  CacheSpecSchema,
  DatabaseSpecSchema,
  ReadReplicasSpecSchema,
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
});
export type DataWorkload = z.output<typeof DataWorkloadSchema>;

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
});

const InstanceFailureEventSchema = z.strictObject({
  atSec: z.number().min(0),
  kind: z.literal('instanceFailure'),
  /** Which instance crashes. "busiest" is the up instance receiving the most traffic (first in design order on ties). */
  target: z.strictObject({ kind: z.literal('appServer'), pick: z.literal('busiest') }),
});

export const ScenarioEventSchema = z.discriminatedUnion('kind', [InstanceFailureEventSchema]);
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
 * The napkin-maths question the mentor asks before the player builds. Each quantity is worked out from the level's
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
  /** Reads per second at the peak. */
  z.strictObject({ quantity: z.literal('readsAtPeak'), answer: z.number().positive() }),
  /** Read-after-write reads (users reading their own fresh write) per second at the peak. */
  z.strictObject({ quantity: z.literal('readAfterWriteReadsAtPeak'), answer: z.number().positive() }),
]);
export type Estimate = z.output<typeof EstimateSchema>;
export type EstimateQuantity = Estimate['quantity'];

export const LevelSchema = z.strictObject({
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
  }),
  /** The napkin-maths step before building. Optional: a level without one goes straight to the editor. */
  estimate: EstimateSchema.optional(),
  /** Reference designs shown to the player after an attempt. Any design that meets the requirements passes. */
  solutions: z.array(SolutionSchema).min(1),
  /** Known wrong answers. CI proves they fail; the debrief can show them as common traps. */
  antiSolutions: z.array(AntiSolutionSchema).default([]),
});
export type Level = z.output<typeof LevelSchema>;
