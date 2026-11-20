/**
 * The play-first flow's situations (docs/design.md, "Briefing" and "Results"): the trade-off line after a pass, the
 * troublemaker's notes on the canvas, and the mentor's callout after a failed run. Each is derived from the level and
 * the run, so none can claim something the sim didn't do.
 */
import { evaluateDesign, getLevel, type Design, type Level, type SimEvent } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import type { GradedEvaluation } from '../src/engine/index.ts';
import { cast, designComparison, failureStory, recentStrikes, STRIKE_NOTE_SEC } from '../src/theme/index.ts';

const links = getLevel('11-everything-links')!;
const level1 = getLevel('01-hello-traffic')!;

function graded(level: Level, design: Design): GradedEvaluation {
  const evaluation = evaluateDesign(level, design);
  if (evaluation.status !== 'graded') throw new Error('should grade');
  return evaluation;
}
const solution = (level: Level, name: string) => level.solutions.find((s) => s.name === name)!.design;
const anti = (level: Level, name: string) => level.antiSolutions.find((a) => a.name === name)!.design;

describe('the trade-off line', () => {
  it("sets the player's passing design beside the other references, with what each costs", () => {
    const design = solution(links, 'Six medium servers and a medium database');
    const comparison = designComparison(links, design, graded(links, design))!;
    expect(comparison.matchesReference).toBe(true);
    expect(cast.designSketch(comparison.yours)).toBe('6 medium servers (1 spare), load balancer + retries, medium database');
    expect(comparison.yours.costUsdPerMonth).toBe(1045);
    expect(comparison.others.map((other) => [cast.designSketch(other), other.costUsdPerMonth])).toEqual([
      ['4 large servers (1 spare), load balancer + retries, medium database', 1285],
    ]);
  });

  it('says nothing after a failed run, so it never spoils', () => {
    const design = anti(links, 'A small database');
    expect(designComparison(links, design, graded(links, design))).toBeNull();
  });

  it('calls a server spare only when the rest keep up without it', () => {
    const design = anti(getLevel('03-pull-the-plug')!, 'Exactly enough servers, with retries');
    const level3 = getLevel('03-pull-the-plug')!;
    const comparison = designComparison(level3, design, { grade: 'pass' })!;
    expect(comparison.yours.spare).toBe(false);
    expect(comparison.matchesReference).toBe(false);
  });
});

describe("the troublemaker's notes", () => {
  const crash: SimEvent = { atSec: 61, kind: 'instanceFailed', nodeId: 'app', instance: 1, message: 'app instance 2 crashed' };
  const design = solution(getLevel('03-pull-the-plug')!, 'N+1 xlarge servers with retries');

  it('pins a crash to its node for a while, then lets it go', () => {
    expect(recentStrikes([crash], 60, design)).toEqual([]);
    expect(recentStrikes([crash], 61, design)).toEqual([{ kind: 'crash', nodeId: 'app', instance: 1, atSec: 61 }]);
    expect(recentStrikes([crash], 61 + STRIKE_NOTE_SEC + 1, design)).toEqual([]);
    expect(cast.troublemakerNote(recentStrikes([crash], 62, design)[0]!)).toBe('Smudge unplugged instance 2');
  });

  it("ignores the system's own events", () => {
    expect(recentStrikes([{ atSec: 70, kind: 'removedFromRotation', nodeId: 'app', instance: 1, message: 'out' }], 71, design)).toEqual([]);
  });
});

describe("the mentor's callout", () => {
  it('names the overloaded node with how busy the run made it', () => {
    const design = anti(level1, 'One small server');
    const callout = cast.mentorCallout(failureStory(level1, design, graded(level1, design))!);
    expect(callout).toMatch(/^app was 1\d\d% busy, over capacity\. Requests queued until they timed out\.$/);
  });

  it('names the failed requirement when nothing failed outright', () => {
    const design = anti(level1, 'One medium server');
    expect(cast.mentorCallout(failureStory(level1, design, graded(level1, design))!)).toMatch(/^p99 hit \d+ ms, over the 75 ms limit\. app was 8\d% busy/);
  });

  it('counts what a crash cost against what a pass allows', () => {
    const design = anti(links, 'No retries');
    expect(cast.mentorCallout(failureStory(links, design, graded(links, design))!)).toMatch(
      /^app instance \d crashed\. 1 in 4 requests still went to it and failed: [\d.]+% lost, and a pass allows 0\.1%\.$/,
    );
  });
});
