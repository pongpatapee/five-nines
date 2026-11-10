import { LevelSchema, type Design, type Level } from '../src/schema.ts';

type LevelOverrides = Partial<Omit<Level, 'workload' | 'requirements'>> & {
  workload?: Partial<Level['workload']>;
  requirements?: Partial<Level['requirements']>;
};

/** A minimal level for engine tests: constant traffic, generous budget. */
export function makeLevel(overrides: LevelOverrides = {}): Level {
  const { workload, requirements, ...rest } = overrides;
  return LevelSchema.parse({
    id: '00-test',
    title: 'Test',
    concept: 'Test',
    briefing: ['Test'],
    debrief: ['Test'],
    components: ['appServer', 'loadBalancer'],
    durationSec: 60,
    seed: 1,
    requirements: { p99Ms: 100, budgetUsdPerMonth: 100_000, ...requirements },
    solutions: [{ name: 'placeholder', explanation: 'placeholder', design: singleServer('large'), expectedGrade: 'pass' }],
    ...rest,
    workload: {
      cpuMsPerRequest: 10,
      timeoutMs: 1000,
      traffic: [{ atSec: 0, rps: 300 }],
      ...workload,
    },
  });
}

export function singleServer(size: 'small' | 'medium' | 'large' | 'xlarge'): Design {
  return {
    nodes: [{ id: 'app', kind: 'appServer', size, instances: 1 }],
    edges: [{ from: 'clients', to: 'app' }],
  };
}

export function balanced(
  instances: number,
  size: 'small' | 'medium' | 'large' | 'xlarge',
  balancer: { healthCheckIntervalSec?: number; retryOnConnectFailure?: boolean } = {},
): Design {
  return {
    nodes: [
      {
        id: 'lb',
        kind: 'loadBalancer',
        healthCheckIntervalSec: balancer.healthCheckIntervalSec ?? 30,
        retryOnConnectFailure: balancer.retryOnConnectFailure ?? false,
      },
      { id: 'app', kind: 'appServer', size, instances },
    ],
    edges: [
      { from: 'clients', to: 'lb' },
      { from: 'lb', to: 'app' },
    ],
  };
}

export const CRASH_AT_30: Level['events'] = [
  { atSec: 30, kind: 'instanceFailure', target: { kind: 'appServer', pick: 'busiest' } },
];
