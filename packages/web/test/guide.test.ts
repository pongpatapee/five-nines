/** The field guide: never spoils ahead, every figure from the catalog, and words for every entry. */
import { APP_SERVER_SIZES, CACHE_SIZES, ComponentKindSchema, DATABASE_SIZES, LEVELS, type Grade } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatCount, formatUsdPerMonth } from '../src/format.ts';
import {
  CONCEPT_IDS,
  CONCEPT_INTRODUCED_AT,
  ESTIMATE_GUIDE_ENTRY,
  isMet,
  metEntries,
  specTable,
} from '../src/guide/guide.ts';
import { campaignState } from '../src/screens/campaign.ts';
import { fieldGuide, FieldGuide } from '../src/theme/index.ts';

const met = (best: Record<string, Grade>, unlockAll = false) => metEntries(LEVELS, campaignState(best, unlockAll).access);
const passedThrough = (n: number) => Object.fromEntries(LEVELS.slice(0, n).map((level) => [level.id, 'mastered' as Grade]));

describe('which entries the guide shows', () => {
  it('starts with page 1: app servers and the first concepts, nothing ahead', () => {
    const fresh = met({});
    expect(fresh.components).toEqual(['appServer']);
    expect(fresh.concepts).toEqual(['nines', 'p99', 'utilization']);
    expect(fresh.unmet).toBe(ComponentKindSchema.options.length + CONCEPT_IDS.length - 4);
  });

  it('adds what each newly opened page uses', () => {
    expect(met(passedThrough(1)).components).toEqual(['appServer', 'loadBalancer']);
    expect(met(passedThrough(2)).concepts).toContain('errorBudget');
    expect(met(passedThrough(3)).components).toEqual(expect.arrayContaining(['cache', 'database']));
    expect(met(passedThrough(3)).components).not.toContain('readReplicas');
  });

  it('shows everything when every page is open', () => {
    const all = met({}, true);
    expect(all.components).toEqual(ComponentKindSchema.options);
    expect(all.concepts).toEqual(CONCEPT_IDS);
    expect(all.unmet).toBe(0);
  });

  it('introduces each concept on a real page', () => {
    for (const id of CONCEPT_IDS) expect(LEVELS.some((level) => level.id === CONCEPT_INTRODUCED_AT[id]), id).toBe(true);
  });

  it("links each napkin question to an entry the player has met by that page", () => {
    for (const [index, level] of LEVELS.entries()) {
      if (!level.estimate) continue;
      const entry = ESTIMATE_GUIDE_ENTRY[level.estimate.quantity];
      expect(isMet(met(passedThrough(index)), entry), level.id).toBe(true);
    }
  });
});

describe('spec tables', () => {
  it('lists every size from the catalog with its capacity and price', () => {
    const app = specTable('appServer');
    expect(app.rows.map((row) => row[0])).toEqual(Object.keys(APP_SERVER_SIZES));
    expect(app.rows[1]).toEqual(['medium', '4', '4,000', formatUsdPerMonth(APP_SERVER_SIZES.medium.usdPerMonth)]);
    const db = specTable('database');
    expect(db.rows.map((row) => row[0])).toEqual(Object.keys(DATABASE_SIZES));
    const large = DATABASE_SIZES.large;
    expect(db.rows.find((row) => row[0] === 'large')).toEqual([
      'large',
      formatCount(large.readsPerSec),
      formatCount(large.writesPerSec),
      `${large.readsPerSec / large.writesPerSec} reads`,
      formatUsdPerMonth(large.usdPerMonth),
    ]);
    expect(specTable('cache').rows.map((row) => row[0])).toEqual(Object.keys(CACHE_SIZES));
  });

  it('has a table with full rows for every component', () => {
    for (const kind of ComponentKindSchema.options) {
      const table = specTable(kind);
      expect(table.rows.length, kind).toBeGreaterThan(0);
      for (const row of table.rows) expect(row.length, kind).toBe(table.columns.length);
    }
  });
});

describe('the guide, drawn', () => {
  const render = (focus: null | 'cache') => {
    const all = met({}, true);
    return renderToStaticMarkup(
      createElement(FieldGuide, {
        components: all.components.map((kind) => ({ kind, table: specTable(kind) })),
        concepts: all.concepts,
        unmet: 0,
        focus,
        onClose: () => {},
      }),
    );
  };

  it('names every entry, with a worked example and the gotchas', () => {
    const html = render(null);
    for (const kind of ComponentKindSchema.options) expect(html).toContain(fieldGuide.entryName(kind));
    for (const id of CONCEPT_IDS) expect(html).toContain(fieldGuide.entryName(id).replace("'", '&#x27;'));
    expect(html.match(/Worked example/g)).toHaveLength(ComponentKindSchema.options.length);
    expect(html).toContain('1,000 ÷ 0.5 = 2,000 req/s per vCPU');
    expect(html).toContain('4 × 2,000 = 8,000 req/s');
    expect(html).toContain('It starts empty');
    expect(html).toContain('Replicas lag');
    expect(html).toContain('until health checks notice');
  });

  it('says how many entries are still to come, without naming them', () => {
    const fresh = met({});
    const html = renderToStaticMarkup(
      createElement(FieldGuide, {
        components: fresh.components.map((kind) => ({ kind, table: specTable(kind) })),
        concepts: fresh.concepts,
        unmet: fresh.unmet,
        focus: null,
        onClose: () => {},
      }),
    );
    expect(html).toContain(`${fresh.unmet} more entries to come`);
    expect(html).not.toContain(fieldGuide.entryName('cache'));
    expect(html).not.toContain(fieldGuide.entryName('errorBudget'));
  });
});
