/**
 * Measured legibility for the chapter 3 readouts: every audited text is at least 12px as
 * rendered and has at least 4.5:1 contrast (WCAG AA) against each paper it sits on; graphics that carry meaning get
 * 3:1. Sizes and colours are read from the stylesheets and tokens themselves, so a change to either is re-measured.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

const ZONES = ['var(--healthy)', 'var(--busy)', 'var(--failing)'];

const TEXT: Audit[] = [
  // Chapter 3: gauges (now with queue wording), the inspector's working and the nodes' live readouts.
  { selector: '.util-gauge__zone-word', on: ['var(--paper)', 'var(--paper-card)'], colors: ZONES },
  { selector: '.util-gauge--mark .util-gauge__value', on: ['var(--paper-card)'], colors: ZONES },
  { selector: '.expected-load__working', on: ['var(--paper)'] },
  { selector: '.expected-load__crash', on: ['var(--paper)'] },
  { selector: '.expected-load__peak', on: ['var(--paper)'] },
  { selector: '.live-row__label', on: ['var(--paper-card)'], inheritsSize: 'var(--text-xs)' },
  { selector: '.live-row__value', on: ['var(--paper-card)'], inheritsSize: 'var(--text-xs)', colors: ['var(--ink)', ...ZONES] },
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

describe('legibility of the chapter 3 elements', () => {
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

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
