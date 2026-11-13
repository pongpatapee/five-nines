/**
 * The maths the game explains: why p99 rose, what a crash cost, and the mentor's hint ladder for every level.
 */
import { evaluateDesign, LEVELS, type Design, type Level } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import type { GradedEvaluation } from '../src/engine/index.ts';
import { litTiers } from '../src/results/grading.ts';
import { cast, hintLadder } from '../src/theme/index.ts';
import { GENERAL_HINTS, LEVEL_HINTS } from '../src/theme/notebook/hints.ts';
import {
  busiestAt,
  failoverSituation,
  failureStory,
  HINT_STEPS,
  HINT_TOPICS,
  latencyAt,
  latencyWorthNoting,
  worstLatency,
  type FailureStory,
} from '../src/theme/situations.ts';

type L = (typeof LEVELS)[number];
const [level1, , level3, , level5, level6] = LEVELS as unknown as [L, L, L, L, L, L];

function graded(level: Level, design: Design): GradedEvaluation {
  const evaluation = evaluateDesign(level, design);
  if (evaluation.status !== 'graded') throw new Error(`${level.id}: design should grade`);
  return evaluation;
}
const anti = (level: Level, name: string) => level.antiSolutions.find((a) => a.name === name)!.design;

describe('grade card tiers', () => {
  it('lights nines only when every check passed', () => {
    expect(litTiers('fail')).toEqual([]);
    expect(litTiers('pass')).toEqual(['pass']);
    expect(litTiers('star')).toEqual(['pass', 'star']);
    expect(litTiers('mastered')).toEqual(['pass', 'star', 'mastered']);
  });
});

describe('latency', () => {
  it("explains level 1's latency-only failure with the server and its utilization", () => {
    const medium = graded(level1, anti(level1, 'One medium server'));
    expect(medium.failedChecks).toEqual(['latency']);
    const worst = worstLatency(medium.simulation.timeline, level1.requirements.p99Ms)!;
    expect(worst.p99Ms).toBeGreaterThan(75);
    expect(worst.busiest?.nodeId).toBe('app');
    expect(worst.busiest!.utilization).toBeGreaterThan(0.8);
    expect(worst.busiest!.utilization).toBeLessThan(0.95);
    const line = cast.mentorLatency(worst);
    expect(line).toMatch(/^p99 hit \d+ ms at t=\d+s \(limit 75 ms\) while app was 8\d% busy\./);
  });

  it('picks the busiest up machine of a second, ignoring crashed ones', () => {
    const frame = {
      nodes: {
        lb: { arrivalRps: 1, failedRps: 0, instances: [] },
        app: {
          arrivalRps: 1,
          failedRps: 0,
          instances: [
            { up: false, utilization: 3, queued: 0 },
            { up: true, utilization: 0.8, queued: 0 },
          ],
        },
        db: { arrivalRps: 1, failedRps: 0, instances: [{ up: true, utilization: 0.6, queued: 0 }] },
      },
    };
    expect(busiestAt(frame)).toEqual({ nodeId: 'app', utilization: 0.8 });
    expect(busiestAt({ nodes: {} })).toBeNull();
  });

  it('speaks up only when p99 nears or passes the limit', () => {
    const at = (p99Ms: number | null) =>
      latencyAt({ atSec: 3, offeredRps: 1, failedRps: 0, p99Ms, nodes: {}, edges: {} }, 100);
    expect(latencyWorthNoting(at(null))).toBe(false);
    expect(latencyWorthNoting(at(79))).toBe(false);
    expect(latencyWorthNoting(at(81))).toBe(true);
    expect(cast.mentorLatency(at(81)!)).toMatch(/climbing/);
    expect(cast.mentorLatency(at(140)!)).toMatch(/p99 hit 140 ms at t=3s, over the 100 ms limit/);
  });
});

describe('failover', () => {
  const failoverOf = (name: string, asOf?: number) => {
    const design = anti(level3, name);
    return failoverSituation(design, graded(level3, design).simulation, asOf)!;
  };

  it("shows that shorter health checks shrink the window but don't close it (level 3)", () => {
    const fast = failoverOf('N+1 with fast health checks, no retries');
    const slow = failoverOf('N+1 with default health checks, no retries');
    for (const s of [fast, slow]) {
      expect(s).toMatchObject({ nodeId: 'app', balancerId: 'lb', rotationSize: 5, retries: false, checksToRemove: 2 });
    }
    expect(fast.removedAtSec! - fast.crashedAtSec).toBeLessThanOrEqual(10);
    expect(slow.removedAtSec! - slow.crashedAtSec).toBeGreaterThan(30);
    // About a fifth of 5,000 req/s for about 9 seconds: roughly 1% of the run, ten times the error budget.
    expect(fast.lostShare).toBeGreaterThan(0.005);
    expect(fast.lostShare).toBeLessThan(0.015);
    expect(slow.lostShare).toBeGreaterThan(fast.lostShare * 3);
    const lines = cast.failoverLines(fast);
    expect(lines.join(' ')).toMatch(/lb checks every 5 s and needs 2 failed checks/);
    expect(lines.join(' ')).toMatch(/1 in 5 requests went to a dead server/);
    expect(cast.failoverLines(slow).join(' ')).toMatch(/checks every 30 s/);
  });

  it('counts only what had happened by the freeze, and says the balancer has yet to notice', () => {
    const design = anti(level3, 'N+1 with fast health checks, no retries');
    const evaluation = graded(level3, design);
    const freeze = evaluation.errorBudgetExhaustedAtSec!;
    const atFreeze = failoverSituation(design, evaluation.simulation, freeze + 1)!;
    const whole = failoverSituation(design, evaluation.simulation)!;
    expect(atFreeze.lostRequests).toBeLessThan(whole.lostRequests);
    expect(atFreeze.removedAtSec).toBeGreaterThan(atFreeze.asOfSec);
    expect(cast.failoverLines(atFreeze).join(' ')).toMatch(/will take it out of rotation/);
  });

  it('credits retries with covering the gap', () => {
    const design = level3.solutions[0]!.design;
    const s = failoverSituation(design, graded(level3, design).simulation)!;
    expect(s.retries).toBe(true);
    expect(s.lostShare).toBeLessThan(0.0001);
    expect(cast.failoverLines(s).join(' ')).toMatch(/Retries sent its share/);
  });

  it('is absent when nothing crashed', () => {
    const design = level1.solutions[0]!.design;
    expect(failoverSituation(design, graded(level1, design).simulation)).toBeNull();
  });
});

describe('the hint ladder', () => {
  /** Every graded wrong answer of every level, plus a budget buster, so each level shows each likely failure. */
  const failures = LEVELS.flatMap((level) => {
    const designs = level.antiSolutions
      .filter((a) => a.expectedFailure !== 'invalid')
      .map((a) => [a.name, a.design] as const);
    return designs.map(([name, design]) => [level.id, name, level, design] as const);
  });

  it.each(failures)('%s, "%s": four worded rungs, with a fix written for this level', (_, __, level, design) => {
    const evaluation = graded(level, design);
    const story = failureStory(level, design, evaluation)!;
    expect(story).not.toBeNull();
    const ladder = hintLadder(level, story);
    expect(ladder.rungs.map((rung) => rung.step)).toEqual([...HINT_STEPS]);
    for (const rung of ladder.rungs) expect(rung.text.length, rung.step).toBeGreaterThan(20);
    const own = LEVEL_HINTS[level.id]?.[story.topic];
    expect(own, `${level.id} needs its own ${story.topic} hints`).toBeDefined();
    expect(ladder.rungs[3]!.text).toBe(own!.fix);
    expect(ladder.rungs[3]!.text).not.toBe(GENERAL_HINTS[story.topic].fix);
  });

  it('gives every level its own concept and fix for overload, latency and the budget', () => {
    for (const level of LEVELS) {
      for (const topic of ['overload', 'latency', 'budget'] as const) {
        expect(LEVEL_HINTS[level.id]?.[topic], `${level.id} ${topic}`).toBeDefined();
      }
    }
  });

  it('words every rung of every topic in every level', () => {
    for (const level of LEVELS) {
      for (const topic of HINT_TOPICS) {
        expect(cast.mentorLadder.concept(level.id, topic)).toBeTruthy();
        expect(cast.mentorLadder.fix(level.id, topic)).toBeTruthy();
      }
    }
    for (const step of HINT_STEPS) expect(cast.mentorLadder.stepLabels[step]).toBeTruthy();
  });

  it('tells the stories behind the known traps', () => {
    const story = (level: Level, name: string): FailureStory => {
      const design = anti(level, name);
      return failureStory(level, design, graded(level, design))!;
    };
    expect(story(level1, 'One medium server')).toMatchObject({ topic: 'latency', requiredMs: 75 });
    expect(story(level1, 'One small server')).toMatchObject({ topic: 'overload', nodeId: 'app', kind: 'appServer' });
    expect(story(level1, 'One xlarge server')).toMatchObject({
      topic: 'budget',
      costUsdPerMonth: 480,
      priciest: { nodeId: 'app', usdPerMonth: 480 },
    });
    const crash = story(level3, 'N+1 with fast health checks, no retries');
    expect(crash).toMatchObject({ topic: 'crash', nodeId: 'app', noneLeft: false });
    expect(hintLadder(level3, crash).rungs[1]!.text).toMatch(/1 in 5 requests went to a dead server/);
    expect(story(level6, 'Pinned for 1 second')).toMatchObject({ topic: 'stale', readAfterWrite: true, pinnedSec: 1 });
    expect(story(level5, 'Two large read replicas').topic).toMatch(/stale|overload/);
    const overload = story(level1, 'One small server');
    expect(hintLadder(level1, overload).rungs[1]!.text).toMatch(/app got as far as 1\d\d% busy, more than it can serve/);
  });

  it('has nothing to say about a run that passed', () => {
    const design = level1.solutions[0]!.design;
    expect(failureStory(level1, design, graded(level1, design))).toBeNull();
  });
});
