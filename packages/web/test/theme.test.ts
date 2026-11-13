/**
 * The theme contract, checked against whichever theme `theme/index.ts` selects: every role, situation and component
 * kind the game can ask for has an answer, and the game reaches the theme only through `theme/index.ts`.
 */
import { CHAPTERS, ComponentKindSchema, evaluateDesign, LEVELS, type SimEvent } from '@five-nines/sim';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FAILURE_REASON_TEXT } from '../src/describe.ts';
import { incidentAtFreeze } from '../src/playback/incident.ts';
import {
  cast,
  CastLine,
  ComponentArt,
  eventCaption,
  mentorHint,
  theme,
  troublemakerTease,
  words,
} from '../src/theme/index.ts';
import { checkSummary, levelStress, verdictFor, type Verdict } from '../src/theme/situations.ts';

const ROLES = ['boss', 'mentor', 'troublemaker'] as const;
const FAILURE_REASONS = Object.keys(FAILURE_REASON_TEXT) as (keyof typeof FAILURE_REASON_TEXT)[];

describe('cast roles', () => {
  it('names every role, and the speech bubble says who is speaking', () => {
    for (const role of ROLES) {
      const { name, title } = cast.members[role];
      expect(name.length).toBeGreaterThan(0);
      expect(title.length).toBeGreaterThan(0);
      const html = renderToStaticMarkup(createElement(CastLine, { role, children: 'hello' }));
      expect(html).toContain(name);
      expect(html).toContain('hello');
    }
  });

  it('gives the mentor a hint for every failure reason, and a sign-off for none', () => {
    for (const reason of FAILURE_REASONS) {
      expect(cast.mentorHints[reason], reason).toBeTruthy();
      expect(mentorHint(reason)).toBe(cast.mentorHints[reason]);
    }
    expect(Object.keys(cast.mentorHints).sort()).toEqual([...FAILURE_REASONS].sort());
    expect(mentorHint(null)).toBe(cast.mentorSignOff);
  });

  it('gives the troublemaker a tease for every level with stress', () => {
    for (const level of LEVELS) {
      expect(levelStress(level), level.id).not.toBeNull();
      expect(troublemakerTease(level), level.id).toBeTruthy();
    }
  });

  it('gives the boss a verdict for every grade and every failed check', () => {
    const verdicts: Verdict[] = [
      { kind: 'availability', availability: 0.99, staleReads: false, lostOrders: false },
      { kind: 'availability', availability: 0.99, staleReads: true, lostOrders: false },
      { kind: 'availability', availability: 0.99, staleReads: false, lostOrders: true },
      { kind: 'latency', p99Ms: 120, requiredMs: 75 },
      { kind: 'budget', costUsdPerMonth: 300, budgetUsdPerMonth: 250 },
      { kind: 'praise', grade: 'pass' },
      { kind: 'praise', grade: 'star' },
      { kind: 'praise', grade: 'mastered' },
    ];
    for (const verdict of verdicts) {
      const { exclaim, line } = cast.bossVerdict(verdict);
      expect(exclaim && line, verdict.kind).toBeTruthy();
    }
    expect(cast.bossBrief(LEVELS[0]!)).toBeTruthy();
  });

  it('gives the mentor a line for every state of the design checks', () => {
    for (const summary of [
      { errors: 0, warnings: 0 },
      { errors: 0, warnings: 2 },
      { errors: 1, warnings: 0 },
      { errors: 3, warnings: 1 },
    ]) {
      expect(cast.mentorChecks(summary)).toBeTruthy();
    }
  });
});

describe('situations', () => {
  it("picks each level's most specific stress", () => {
    expect(LEVELS.map((level) => levelStress(level)?.kind)).toEqual([
      'surge',
      'surge',
      'crash',
      'spike',
      'staleness',
      'readAfterWrite',
      'hotKey',
      'cacheRestart',
      'staleness',
      'spike',
    ]);
  });

  it('judges the check that actually failed', () => {
    const level3 = LEVELS[2]!;
    for (const anti of level3.antiSolutions) {
      const evaluation = evaluateDesign(level3, anti.design);
      if (evaluation.status !== 'graded') continue;
      expect(verdictFor(evaluation).kind).toBe(evaluation.failedChecks[0]);
    }
    const level6 = LEVELS[5]!;
    const stale = evaluateDesign(level6, level6.antiSolutions.find((anti) => anti.name === 'Pinned for 1 second')!.design);
    if (stale.status !== 'graded') throw new Error('anti-solution should grade');
    expect(verdictFor(stale)).toMatchObject({ kind: 'availability', staleReads: true, lostOrders: false });
    const best = evaluateDesign(level3, level3.solutions[0]!.design);
    if (best.status !== 'graded') throw new Error('solution should grade');
    expect(verdictFor(best)).toEqual({ kind: 'praise', grade: 'mastered' });
  });

  it('counts design checks by severity', () => {
    const issue = (severity: string) => ({ code: 'x', severity, message: '' }) as never;
    expect(checkSummary([issue('error'), issue('warning'), issue('error')])).toEqual({ errors: 2, warnings: 1 });
  });

  it('credits the troublemaker with the scripted events only', () => {
    const crash: SimEvent = { atSec: 61, kind: 'instanceFailed', nodeId: 'app', instance: 0, message: 'app #1 crashed.' };
    expect(eventCaption(crash)).toEqual({ text: cast.troublemakerCrash('app', 0), byTroublemaker: true });
    const rotation: SimEvent = { ...crash, kind: 'removedFromRotation', balancerId: 'lb', message: 'lb removed app #1.' };
    expect(eventCaption(rotation)).toEqual({ text: 'lb removed app #1.', byTroublemaker: false });
    const restart: SimEvent = { atSec: 90, kind: 'cacheRestarted', nodeId: 'cache', message: 'cache restarted.' };
    expect(eventCaption(restart)).toEqual({ text: cast.troublemakerCacheRestart('cache'), byTroublemaker: true });
    const hot: SimEvent = { atSec: 100, kind: 'hotKeyStarted', nodeId: '', shardKey: 'postId', label: 'a post', message: '' };
    expect(eventCaption(hot)).toEqual({ text: cast.troublemakerHotKey('a post'), byTroublemaker: true });
    const full: SimEvent = { atSec: 70, kind: 'queueFull', nodeId: 'queue', message: 'queue is full.' };
    expect(eventCaption(full)).toEqual({ text: 'queue is full.', byTroublemaker: false });
  });

  it("keeps the postmortem to what had happened by the freeze", () => {
    const cause = (nodeId: string, firstAtSec: number) => ({ nodeId, reason: 'timeout', firstAtSec }) as never;
    const event = (atSec: number) => ({ atSec, kind: 'instanceFailed', nodeId: 'app', message: '' }) as SimEvent;
    const incident = incidentAtFreeze([cause('a', 10), cause('b', 20), cause('c', 40)], [event(5), event(21), event(30)], 20);
    expect(incident.rootCause).toMatchObject({ nodeId: 'a' });
    expect(incident.knockOn.map((c: { nodeId: string }) => c.nodeId)).toEqual(['b']);
    expect(incident.events.map((e) => e.atSec)).toEqual([5, 21]);
    expect(incidentAtFreeze([], [], 20).rootCause).toBeUndefined();
  });
});

describe('theme slots', () => {
  it('has art for every component kind and the clients', () => {
    for (const kind of [...ComponentKindSchema.options, 'clients' as const]) {
      const html = renderToStaticMarkup(createElement(ComponentArt, { kind }));
      expect(html, kind).toMatch(/<(path|circle|rect)/);
    }
  });

  it('fills every widget slot and mark', () => {
    for (const slot of [
      'Shell',
      'CastLine',
      'ComponentArt',
      'BudgetMeter',
      'PostmortemCard',
      'GradeCard',
      'CampaignMap',
      'UtilizationGauge',
    ] as const) {
      expect(typeof theme[slot], slot).toBe('function');
    }
    for (const [name, mark] of Object.entries(theme.marks)) expect(typeof mark, name).toBe('function');
    expect(words.level).toBeTruthy();
    expect(words.levelShort(3)).toContain('3');
  });

  it('labels the utilization gauge with its reading and zone', () => {
    const gauge = (utilization: number, variant: 'full' | 'mark') =>
      renderToStaticMarkup(createElement(theme.UtilizationGauge, { utilization, variant }));
    expect(gauge(0.44, 'full')).toMatch(/aria-label="Expected peak utilization 44%, comfortable"/);
    expect(gauge(0.875, 'mark')).toMatch(/aria-label="Expected peak utilization 88%, hot[^"]*"/);
    expect(gauge(1.75, 'full')).toMatch(/data-zone="overloaded"/);
    expect(gauge(Infinity, 'full')).toMatch(/no capacity left/);
  });

  it('draws the campaign map for every chapter and level', () => {
    const html = renderToStaticMarkup(
      createElement(theme.CampaignMap, { chapters: CHAPTERS, levels: LEVELS, best: {}, nextUp: 0 }),
    );
    for (const chapter of CHAPTERS) expect(html).toContain(chapter.title);
    for (const level of LEVELS) expect(html).toContain(level.title);
  });
});

describe('theme boundary', () => {
  const src = join(import.meta.dirname, '../src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
    );

  it('lets the game reach a theme only through theme/index.ts', () => {
    const offenders = files(src)
      .map((file) => relative(src, file))
      .filter((file) => !file.startsWith('theme/'))
      .filter((file) => /from '[^']*theme\/(?!index\.ts')[^']*'/.test(readFileSync(join(src, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps stylesheets and raw colours inside the theme', () => {
    const outside = files(src).filter((file) => !relative(src, file).startsWith('theme/'));
    for (const file of outside) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/import '\.[^']*\.css'/);
      expect(text, file).not.toMatch(/['"`]#[0-9a-f]{3,8}['"`]|rgba?\(/i);
    }
  });
});
