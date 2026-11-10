import { z } from 'zod';
import { CLIENTS_ID } from './catalog.ts';

// ---------------------------------------------------------------------------
// Designs: what the player builds.
// ---------------------------------------------------------------------------

const NodeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes, starting with a letter.')
  .refine((id) => id !== CLIENTS_ID, `"${CLIENTS_ID}" is reserved for the traffic source.`);

export const ComponentKindSchema = z.enum(['appServer', 'loadBalancer']);
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

export const NodeSpecSchema = z.discriminatedUnion('kind', [AppServerSpecSchema, LoadBalancerSpecSchema]);
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
  }),
  /** Reference designs shown to the player after an attempt. Any design that meets the requirements passes. */
  solutions: z.array(SolutionSchema).min(1),
  /** Known wrong answers. CI proves they fail; the debrief can show them as common traps. */
  antiSolutions: z.array(AntiSolutionSchema).default([]),
});
export type Level = z.output<typeof LevelSchema>;
