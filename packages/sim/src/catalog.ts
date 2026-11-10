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
} as const;
