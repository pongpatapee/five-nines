/**
 * Measured legibility for the rewards screens, the chapter 3 readouts, the napkin working and the level's numbers: every audited text is at
 * least 12px as rendered and has at least 4.5:1 contrast (WCAG AA) against each paper it sits on; graphics that carry
 * meaning get 3:1. Sizes and colours are read from the stylesheets and tokens themselves, so a change to either is
 * re-measured.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BadgeSeal } from '../src/theme/notebook/ink.tsx';
import { BADGE_GLYPHS } from '../src/theme/notebook/BadgeShelf.tsx';
import { MAP_SIZE } from '../src/theme/notebook/mapLayout.ts';

const dir = join(import.meta.dirname, '../src/theme/notebook/styles');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom properties declared in tokens.css. */
const tokens = new Map<string, string>();
for (const [, name, value] of strip(readFileSync(join(dir, 'tokens.css'), 'utf8')).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
  tokens.set(name!, value!.trim());
}

/** Every rule's declarations by selector, later rules overriding earlier ones (selectors in a list are split). */
const rules = new Map<string, Map<string, string>>();
for (const file of readdirSync(dir).filter((name) => name.endsWith('.css')).sort()) {
  for (const [, selectors, body] of strip(readFileSync(join(dir, file), 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors!.split(',').map((s) => s.trim())) {
      const declarations = rules.get(selector) ?? new Map<string, string>();
      for (const [, property, value] of body!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) declarations.set(property!, value!.trim());
      rules.set(selector, declarations);
    }
  }
}

function resolve(value: string): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (!reference) return value;
  const token = tokens.get(reference[1]!);
  if (token === undefined) throw new Error(`Unknown token ${reference[1]}`);
  return resolve(token);
}

function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(resolve(value));
  if (!hex) throw new Error(`${value} is not an opaque #rrggbb colour (${resolve(value)})`);
  const n = Number.parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2 relative luminance and contrast ratio. */
function luminance(value: string): number {
  const [r, g, b] = rgb(value).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function px(value: string): number {
  const match = /^([\d.]+)px$/.exec(resolve(value));
  if (!match) throw new Error(`${value} is not a px size`);
  return Number(match[1]);
}

interface Audit {
  selector: string;
  /** The papers it sits on. */
  on: string[];
  /** Colours to check when the rule's colour isn't a plain token (or it inherits one). */
  colors?: string[];
  /** The size it inherits when its rule sets none. */
  inheritsSize?: string;
  /** Rendered size ÷ declared size (an SVG drawn smaller than its user units). */
  scale?: number;
}

/** The map is drawn 880 units wide and never shrinks below 640px. */
const MAP_SCALE = 640 / MAP_SIZE.width;
const ZONES = ['var(--healthy)', 'var(--busy)', 'var(--failing)'];

const TEXT: Audit[] = [
  // Rewards and progression.
  { selector: '.contents__target', on: ['var(--paper)'], colors: ['var(--text)'] },
  { selector: '.sound-toggle__state', on: ['var(--paper)', 'var(--paper-card)'], inheritsSize: 'var(--text-sm)' },
  { selector: ".sound-toggle[data-on='true'] .sound-toggle__state", on: ['var(--paper)', 'var(--paper-card)'], inheritsSize: 'var(--text-sm)' },
  { selector: '.badge-shelf__count', on: ['var(--paper-card)'] },
  { selector: '.badge-shelf__name', on: ['var(--paper-card)'], colors: ['var(--text)'] },
  { selector: '.badge-shelf__how', on: ['var(--paper-card)'] },
  { selector: ".badge-shelf__badge[data-earned='true'] .badge-shelf__how", on: ['var(--paper-card)'], inheritsSize: 'var(--text-sm)' },
  { selector: '.grade-card__payout-gain', on: ['var(--paper-card)'] },
  { selector: ".grade-card__payout[data-gained='false'] .grade-card__payout-gain", on: ['var(--paper-card)'], inheritsSize: 'var(--text-hand-lg)' },
  { selector: '.grade-card__payout-total', on: ['var(--highlighter-green)', 'var(--paper-card)'], colors: ['var(--text)'] },
  { selector: '.grade-card__payout-note', on: ['var(--paper-card)'], colors: ['var(--text-muted)'] },
  { selector: '.grade-card__payout-opened', on: ['var(--paper-card)'], inheritsSize: 'var(--text-md)' },
  { selector: '.grade-card__savings-figure', on: ['var(--paper-card)'] },
  { selector: '.grade-card__savings-line .cast-line__bubble', on: ['var(--paper-card)'], colors: ['var(--text)'] },
  { selector: '.locked-level__concept', on: ['var(--paper)'], colors: ['var(--text-muted)'] },
  { selector: '.map-text--lock-note', on: ['var(--paper)'], scale: MAP_SCALE },
  { selector: '.map-stop--locked .map-text--title', on: ['var(--paper)'], inheritsSize: '17px', scale: MAP_SCALE },
  // Chapter 3: gauges (now with queue wording), the inspector's working and the nodes' live readouts.
  { selector: '.util-gauge__zone-word', on: ['var(--paper)', 'var(--paper-card)'], colors: ZONES },
  { selector: '.util-gauge--mark .util-gauge__value', on: ['var(--paper-card)'], colors: ZONES },
  { selector: '.expected-load__working', on: ['var(--paper)'] },
  { selector: '.expected-load__crash', on: ['var(--paper)'] },
  { selector: '.expected-load__peak', on: ['var(--paper)'] },
  { selector: '.live-row__label', on: ['var(--paper-card)'], inheritsSize: 'var(--text-xs)' },
  { selector: '.live-row__value', on: ['var(--paper-card)'], inheritsSize: 'var(--text-xs)', colors: ['var(--ink)', ...ZONES] },
  // The napkin working: the worked solution after the estimate.
  { selector: '.napkin-working__title', on: ['var(--paper-card)'], inheritsSize: 'var(--text-2xl)' },
  { selector: '.napkin-working__step::before', on: ['var(--paper-card)'] },
  { selector: '.napkin-working__why', on: ['var(--paper-card)'] },
  { selector: '.napkin-working__line', on: ['var(--paper-card)'] },
  { selector: '.napkin-working__sum', on: ['var(--paper-card)'], inheritsSize: 'var(--text-lg)' },
  { selector: '.napkin-working__result', on: ['var(--paper-card)', 'var(--highlighter)'], inheritsSize: 'var(--text-lg)' },
  { selector: '.napkin-working__line[data-answer] .napkin-working__result', on: ['var(--paper-card)'] },
  { selector: '.napkin-working__note', on: ['var(--paper-card)'] },
  { selector: '.napkin-working__takeaway', on: ['var(--paper-card)'] },
  { selector: '.napkin-working__takeaway-lead', on: ['var(--paper-card)'] },
  // The numbers: a sticky note in the briefing and on the napkin card.
  { selector: '.numbers-box__title', on: ['var(--sticky)'] },
  { selector: '.numbers-box__heading', on: ['var(--sticky)'] },
  { selector: '.numbers-box__row dt', on: ['var(--sticky)'], inheritsSize: 'var(--text-sm)' },
  { selector: '.numbers-box__row dd', on: ['var(--sticky)'], inheritsSize: 'var(--text-sm)' },
  { selector: '.numbers-box__during', on: ['var(--sticky)'] },
];

/**
 * Marks that carry meaning without text: the timeline's event dots (chapter 3 added restarts, hot keys, full queues and
 * lag). A dot's ink outline and its fill must each stand out from the paper; the troublemaker's crosses must too.
 */
const EVENT_DOTS = [
  '.pb-timeline__event',
  '.pb-timeline__event--removedFromRotation',
  '.pb-timeline__event--restoredToRotation',
  '.pb-timeline__event--replicationLagRecovered',
  '.pb-timeline__event--hotKeyEnded',
  '.pb-timeline__event--replicationLagHigh',
  '.pb-timeline__event--queueFull',
];
const EVENT_CROSSES = ['.pb-timeline__event--cacheRestarted::before', '.pb-timeline__event--hotKeyStarted::before'];
const TIMELINE_PAPERS = ['var(--paper)', 'var(--paper-card)'];

describe('legibility of the rewards and chapter 3 elements', () => {
  it.each(TEXT)('$selector is at least 12px', ({ selector, inheritsSize, scale = 1 }) => {
    const declared = rules.get(selector)?.get('font-size') ?? inheritsSize;
    expect(declared, `${selector} has no font-size`).toBeDefined();
    expect(px(declared!) * scale).toBeGreaterThanOrEqual(12);
  });

  it.each(TEXT)('$selector has at least 4.5:1 contrast', ({ selector, on, colors }) => {
    const rule = rules.get(selector);
    const own = rule?.get('color') ?? rule?.get('fill');
    const checked = own && !/zone-color/.test(own) ? [own] : (colors ?? []);
    expect(checked.length, `${selector} has no colour to check`).toBeGreaterThan(0);
    for (const color of checked) {
      for (const paper of on) expect(contrast(color, paper), `${color} on ${paper}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(EVENT_DOTS)('%s stands out from the paper, outline and fill', (selector) => {
    const fill = rules.get(selector)!.get('--event-color')!;
    const outline = /solid (var\([\w-]+\))/.exec(rules.get('.pb-timeline__event::before')!.get('border')!)![1]!;
    for (const paper of TIMELINE_PAPERS) {
      expect(contrast(outline, paper), `${outline} on ${paper}`).toBeGreaterThanOrEqual(3);
      expect(contrast(fill, paper), `${fill} on ${paper}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(EVENT_CROSSES)('%s stands out from the paper', (selector) => {
    const color = rules.get(selector)!.get('background')!;
    for (const paper of TIMELINE_PAPERS) expect(contrast(color, paper), `${color} on ${paper}`).toBeGreaterThanOrEqual(3);
  });

  it('inks earned badge seals at least 3:1', () => {
    const ring = rules.get(".badge-seal[data-earned='true'] .badge-seal__ring")!.get('stroke')!;
    expect(contrast(ring, 'var(--paper-card)')).toBeGreaterThanOrEqual(3);
  });

  it('draws badge glyphs at least 12px at the smallest seal', () => {
    for (const glyph of Object.values(BADGE_GLYPHS)) {
      const html = renderToStaticMarkup(createElement(BadgeSeal, { glyph, earned: true, size: 48 }));
      const fontSize = Number(/font-size:(\d+(?:\.\d+)?)/.exec(html)![1]);
      const viewBox = Number(/viewBox="0 0 (\d+)/.exec(html)![1]);
      expect(fontSize * (48 / viewBox), glyph).toBeGreaterThanOrEqual(12);
    }
  });

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
