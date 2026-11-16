/** Giving up: the rules for seeing a solution before passing (progression/peek.ts), and the store that keeps them. */
import { CHAPTERS, LEVELS } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { addNode, createNodeSpec } from '../src/canvas/draft.ts';
import { creditedGrade, creditedRunBadges, peekCosts, PEEK_GRADE_CAP } from '../src/progression/index.ts';
import { levelAccess } from '../src/progression/unlocks.ts';
import { STORAGE_KEY, type StorageLike } from '../src/state/persistence.ts';
import { createProgressStore, selectDraft, STARTING_DRAFT } from '../src/state/store.ts';
import { cast, theme } from '../src/theme/index.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const L1 = '01-hello-traffic';
const L2 = '02-scale-out';
const mine = addNode(STARTING_DRAFT, createNodeSpec('appServer', 'app'), { x: 300, y: 0 });
const solution = addNode(STARTING_DRAFT, createNodeSpec('loadBalancer', 'lb'), { x: 300, y: 0 });
const other = addNode(STARTING_DRAFT, createNodeSpec('cache', 'cache'), { x: 300, y: 0 });

describe('the peek rules', () => {
  it('caps a peeked run at a pass, and leaves the rest alone', () => {
    expect(PEEK_GRADE_CAP).toBe('pass');
    expect(creditedGrade('mastered', true)).toBe('pass');
    expect(creditedGrade('star', true)).toBe('pass');
    expect(creditedGrade('pass', true)).toBe('pass');
    expect(creditedGrade('fail', true)).toBe('fail');
    expect(creditedGrade('mastered', false)).toBe('mastered');
  });

  it('credits no run badges on a peeked level', () => {
    expect(creditedRunBadges(['rightSized', 'nPlusOne'], true)).toEqual([]);
    expect(creditedRunBadges(['rightSized'], false)).toEqual(['rightSized']);
  });

  it('costs something only before the level is passed, and only once', () => {
    expect(peekCosts(undefined, false)).toBe(true);
    expect(peekCosts('fail', false)).toBe(true);
    expect(peekCosts('pass', false)).toBe(false);
    expect(peekCosts('mastered', false)).toBe(false);
    expect(peekCosts(undefined, true)).toBe(false);
  });
});

describe('a peeked level in the progress store', () => {
  it('records a peek only before the level is passed', () => {
    const store = createProgressStore({ storage: null });
    store.getState().recordRun(L2, 'star', []);
    store.getState().recordPeek(L2);
    expect(store.getState().peeked[L2]).toBeUndefined();
    store.getState().recordRun(L1, 'fail', []);
    store.getState().recordPeek(L1);
    expect(store.getState().peeked[L1]).toBe(true);
  });

  it('pays at most a pass and no badges, but still opens the next level', () => {
    const store = createProgressStore({ storage: null });
    store.getState().recordPeek(L1);
    const reward = store.getState().recordRun(L1, 'mastered', ['rightSized']);
    expect(store.getState().bestGrades[L1]).toBe('pass');
    expect(store.getState().badges.rightSized).toBeUndefined();
    expect(reward).toMatchObject({ levelNines: { before: 0, after: 3 }, newBadges: [], capped: true });
    expect(levelAccess(CHAPTERS, { best: store.getState().bestGrades }, L2).kind).toBe('open');
  });

  it('says nothing is capped when the run earned no more than a pass anyway', () => {
    const store = createProgressStore({ storage: null });
    store.getState().recordPeek(L1);
    expect(store.getState().recordRun(L1, 'pass', []).capped).toBe(false);
    expect(store.getState().recordRun(L1, 'fail', []).capped).toBe(false);
  });

  it('never lowers a grade recorded before the peek', () => {
    const storage = memoryStorage();
    storage.data.set(
      STORAGE_KEY,
      JSON.stringify({ version: 3, bestGrades: { [L1]: 'mastered' }, peeked: { [L1]: true } }),
    );
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    store.getState().recordRun(L1, 'star', []);
    expect(store.getState().bestGrades[L1]).toBe('mastered');
  });

  it('keeps the peek across sessions', () => {
    const storage = memoryStorage();
    createProgressStore({ storage, writeDelayMs: 0 }).getState().recordPeek(L1);
    const again = createProgressStore({ storage, writeDelayMs: 0 });
    expect(again.getState().peeked).toEqual({ [L1]: true });
    expect(again.getState().recordRun(L1, 'mastered', []).capped).toBe(true);
  });
});

describe('loading a solution onto the canvas', () => {
  it("keeps the player's design aside, and puts it back", () => {
    const storage = memoryStorage();
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    store.getState().updateDraft(L1, mine);
    store.getState().loadSolution(L1, solution);
    expect(selectDraft(store.getState(), L1)).toBe(solution);
    expect(store.getState().stashedDrafts[L1]).toBe(mine);
    // A second solution replaces the first, never the player's design.
    store.getState().loadSolution(L1, other);
    expect(store.getState().stashedDrafts[L1]).toBe(mine);
    // It survives a reload.
    expect(createProgressStore({ storage }).getState().stashedDrafts[L1]?.design).toEqual(mine.design);
    store.getState().restoreStashedDraft(L1);
    expect(selectDraft(store.getState(), L1)).toBe(mine);
    expect(store.getState().stashedDrafts[L1]).toBeUndefined();
  });

  it('keeps an empty canvas aside too', () => {
    const store = createProgressStore({ storage: null });
    store.getState().loadSolution(L1, solution);
    store.getState().restoreStashedDraft(L1);
    expect(selectDraft(store.getState(), L1)).toBe(STARTING_DRAFT);
  });
});

describe('what the player is told', () => {
  it('says what a peek costs before it happens', () => {
    const text = cast.giveUp.confirmLines.join(' ');
    expect(text).toMatch(/at most a pass/);
    expect(text).toMatch(/no badges/);
    expect(text).toMatch(/next page still opens/);
    expect(cast.giveUp.capped).toMatch(/at most a pass/);
  });

  it('marks peeked pages on the map, in words as well as pencil', () => {
    const html = renderToStaticMarkup(
      createElement(theme.CampaignMap, {
        chapters: CHAPTERS,
        levels: LEVELS,
        best: { [L1]: 'pass' },
        peeked: { [L1]: true },
        nextUp: 1,
        access: { [L1]: { kind: 'open' }, [L2]: { kind: 'open' } },
        chapterAccess: {},
      }),
    );
    expect(html.match(/map-text--peek/g)).toHaveLength(1);
    expect(html).toMatch(/Hello, Traffic[^"]*Solution seen: pays at most a pass\./);
  });
});
