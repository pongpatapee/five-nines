/** The notebook theme's own wording, art helpers, map layout and stylesheets. */
import { CHAPTERS, isWritten, LEVELS } from '@five-nines/sim';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTEBOOK_SCRIPT, roughly } from '../src/theme/notebook/cast.ts';
import { loopPath } from '../src/theme/notebook/ink.tsx';
import {
  CHAPTER_LABELS,
  LEVEL_SLOTS,
  PLANNED_CHAPTER_PAGES,
  TRAIL_SEGMENTS,
} from '../src/theme/notebook/mapLayout.ts';
import { TALLY_STROKES, tallyState } from '../src/theme/notebook/tally.ts';
import { levelStress } from '../src/theme/situations.ts';

type L = (typeof LEVELS)[number];
const [level1, level2, level3, level4, level5, level6] = LEVELS as unknown as [L, L, L, L, L, L];
const tease = (level: L) => NOTEBOOK_SCRIPT.troublemakerTease(levelStress(level)!);

describe('notebook cast lines', () => {
  it("Ms. Tally quotes the level's real budget", () => {
    expect(NOTEBOOK_SCRIPT.bossBrief(level3)).toBe('$2,600 a month. Not a cent over.');
  });

  it("Smudge teases the level's scripted crash, else its traffic surge", () => {
    expect(tease(level3)).toBe('heh. about a minute in, I unplug your busiest app server.');
    expect(tease(level1)).toBe('heh. traffic climbs from 100 to 350 req/s. hope you sized up.');
    expect(tease(level2)).toMatch(/1,000 to 5,000 req\/s/);
  });

  it('Smudge teases chapter 2 with its spike and its freshness rules', () => {
    expect(tease(level4)).toBe('heh. about 2 minutes in, I send 26,000 req/s your way. all at once.');
    expect(tease(level5)).toBe("heh. I'm timing every read. more than 1 second out of date and it counts as a failure.");
    expect(tease(level6)).toBe("heh. 20% of reads check something the reader just wrote. I'd love to show them the old version.");
  });

  it('says times the way a person would', () => {
    expect(roughly(30)).toBe('30 seconds');
    expect(roughly(61)).toBe('about a minute');
    expect(roughly(150)).toBe('about 3 minutes');
  });

  it('credits Smudge with a crash', () => {
    expect(NOTEBOOK_SCRIPT.troublemakerCrash('app', 0)).toBe('Smudge pulls the plug on app instance 1');
  });

  it('Erasmus reacts to design checks by severity', () => {
    expect(NOTEBOOK_SCRIPT.mentorChecks({ errors: 0, warnings: 0 })).toMatch(/runnable/);
    expect(NOTEBOOK_SCRIPT.mentorChecks({ errors: 0, warnings: 1 })).toMatch(/Only warnings.*Ms\. Tally/);
    expect(NOTEBOOK_SCRIPT.mentorChecks({ errors: 1, warnings: 1 })).toMatch(/^One thing/);
    expect(NOTEBOOK_SCRIPT.mentorChecks({ errors: 2, warnings: 0 })).toMatch(/^2 things/);
  });

  it('Ms. Tally complains about the check that failed', () => {
    expect(NOTEBOOK_SCRIPT.bossVerdict({ kind: 'availability', availability: 0.99, staleReads: false, lostOrders: false }).line).toBe(
      'We promised 99.9%. See me after.',
    );
    expect(NOTEBOOK_SCRIPT.bossVerdict({ kind: 'availability', availability: 0.99, staleReads: true, lostOrders: false }).line).toMatch(
      /^Customers saw out-of-date data/,
    );
    expect(
      NOTEBOOK_SCRIPT.bossVerdict({ kind: 'availability', availability: 0.99, staleReads: false, lostOrders: true }).line,
    ).toMatch(/paying customer/);
    expect(NOTEBOOK_SCRIPT.bossVerdict({ kind: 'latency', p99Ms: 120, requiredMs: 75 }).exclaim).toMatch(/^p99 of/);
    expect(NOTEBOOK_SCRIPT.bossVerdict({ kind: 'budget', costUsdPerMonth: 300, budgetUsdPerMonth: 250 }).line).toMatch(
      /Not a cent over/,
    );
    expect(NOTEBOOK_SCRIPT.bossVerdict({ kind: 'praise', grade: 'mastered' }).exclaim).toBe('Five nines.');
  });
});

describe('error budget tally', () => {
  it('crosses out a stroke only once its whole share is spent', () => {
    expect(tallyState(0, false)).toEqual({ total: TALLY_STROKES, spent: 0, left: TALLY_STROKES });
    expect(tallyState(0.019, false).spent).toBe(0);
    expect(tallyState(0.02, false).spent).toBe(1);
    expect(tallyState(0.5, false).spent).toBe(25);
  });

  it('never shows a held budget as fully spent, and always shows an exhausted one as fully spent', () => {
    expect(tallyState(0.9999, false).spent).toBe(TALLY_STROKES - 1);
    expect(tallyState(1.5, false).spent).toBe(TALLY_STROKES - 1);
    expect(tallyState(1, true)).toEqual({ total: TALLY_STROKES, spent: TALLY_STROKES, left: 0 });
    expect(tallyState(Infinity, true).spent).toBe(TALLY_STROKES);
    expect(tallyState(Number.NaN, false).spent).toBe(0);
  });
});

describe('ink loop', () => {
  it('is deterministic and starts with a move', () => {
    expect(loopPath(200, 100)).toBe(loopPath(200, 100));
    expect(loopPath(200, 100)).toMatch(/^M[\d.]+,[\d.]+ C/);
  });
});

describe('campaign map layout', () => {
  it('has a slot and a trail segment for every level, and a label for every chapter', () => {
    expect(LEVEL_SLOTS.length).toBeGreaterThanOrEqual(LEVELS.length);
    expect(TRAIL_SEGMENTS.length).toBeGreaterThanOrEqual(LEVELS.length);
    expect(CHAPTER_LABELS.length).toBeGreaterThanOrEqual(CHAPTERS.length);
    expect(PLANNED_CHAPTER_PAGES.length).toBeGreaterThanOrEqual(CHAPTERS.filter((c) => !isWritten(c)).length);
  });
});

describe('notebook stylesheets', () => {
  const dir = join(import.meta.dirname, '../src/theme/notebook/styles');
  const css = readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');

  it('names raw colours in tokens.css only', () => {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
      const text = readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });

  it('turns off every animation, ink strokes and Smudge included, for reduced motion', () => {
    // Every selector list that starts an animation, outside the reduced-motion blocks.
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
    const outside = css.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, '').replace(/@keyframes[^{]*\{[\s\S]*?\n\}/g, '');
    const animated = [...outside.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;]+;/g)].flatMap((m) =>
      m[1]!.split(',').map((selector) => selector.trim()),
    );
    expect(animated).toEqual(expect.arrayContaining(['.ink-draw', '.smudge-bob']));
    const stilled = reduced
      .flatMap((block) => [...block.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*none;/g)])
      .flatMap((m) => m[1]!.split(',').map((selector) => selector.trim()));
    for (const selector of animated) expect(stilled, selector).toContain(selector);
  });
});
