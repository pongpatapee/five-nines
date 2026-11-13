import { CLIENTS_ID } from '@five-nines/sim';
import { describe, expect, it, vi } from 'vitest';
import { addNode, createNodeSpec } from '../src/canvas/draft.ts';
import { STORAGE_KEY, type StorageLike } from '../src/state/persistence.ts';
import { createProgressStore, selectDraft, STARTING_DRAFT } from '../src/state/store.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const LEVEL = '01-hello-traffic';
const edited = addNode(STARTING_DRAFT, createNodeSpec('appServer', 'app-1'), { x: 300, y: 0 });

describe('progress store', () => {
  it('serves the starting draft (a stable object) for levels without one', () => {
    const store = createProgressStore({ storage: null });
    expect(selectDraft(store.getState(), LEVEL)).toBe(STARTING_DRAFT);
    expect(selectDraft(store.getState(), LEVEL)).toBe(selectDraft(store.getState(), LEVEL));
    expect(STARTING_DRAFT.layout[CLIENTS_ID]).toEqual({ x: 0, y: 0 });
  });

  it('updates and resets drafts per level', () => {
    const store = createProgressStore({ storage: null });
    store.getState().updateDraft(LEVEL, edited);
    expect(selectDraft(store.getState(), LEVEL)).toBe(edited);
    expect(selectDraft(store.getState(), 'other')).toBe(STARTING_DRAFT);
    store.getState().resetDraft(LEVEL);
    expect(selectDraft(store.getState(), LEVEL)).toBe(STARTING_DRAFT);
  });

  it('keeps only the best grade', () => {
    const store = createProgressStore({ storage: null });
    const { recordRun } = store.getState();
    recordRun(LEVEL, 'fail', []);
    expect(store.getState().bestGrades[LEVEL]).toBe('fail');
    recordRun(LEVEL, 'star', []);
    recordRun(LEVEL, 'pass', []);
    expect(store.getState().bestGrades[LEVEL]).toBe('star');
    recordRun(LEVEL, 'mastered', []);
    expect(store.getState().bestGrades[LEVEL]).toBe('mastered');
  });

  it('pays out a run: nines, new badges once, and chapters opened', () => {
    const store = createProgressStore({ storage: null });
    const { recordRun } = store.getState();
    expect(recordRun('01-hello-traffic', 'pass', [])).toMatchObject({
      levelNines: { before: 0, after: 3 },
      totalNines: { before: 0, after: 3, total: 50 },
      newBadges: [],
    });
    recordRun('02-scale-out', 'pass', ['rightSized']);
    expect(store.getState().badges).toEqual({ rightSized: { levelId: '02-scale-out' } });
    // A replay that earns the same badge again announces nothing new, and a worse grade pays nothing.
    expect(recordRun('02-scale-out', 'fail', ['rightSized'])).toMatchObject({
      levelNines: { before: 3, after: 3 },
      totalNines: { before: 6, after: 6 },
      newBadges: [],
    });
    // 6 + 5 = 11 nines: chapter 2 (10) opens.
    expect(recordRun('03-pull-the-plug', 'mastered', ['nPlusOne'])).toMatchObject({
      newBadges: ['nPlusOne'],
      openedChapterIds: ['growing-pains'],
    });
    // Mastering every page of chapter 1 earns the Five Nines Club.
    recordRun('01-hello-traffic', 'mastered', []);
    expect(recordRun('02-scale-out', 'mastered', [])).toMatchObject({
      levelNines: { before: 3, after: 5 },
      newBadges: ['fiveNinesClub'],
      openedChapterIds: [],
    });
    expect(store.getState().badges.fiveNinesClub).toEqual({ levelId: '02-scale-out' });
  });

  it('awards Napkin Wizard on the third close estimate', () => {
    const store = createProgressStore({ storage: null });
    const { recordEstimate } = store.getState();
    expect(recordEstimate('a', 1, true)).toEqual([]);
    expect(recordEstimate('b', 1, true)).toEqual([]);
    expect(recordEstimate('c', 1, false)).toEqual([]);
    expect(recordEstimate('c', 2, true)).toEqual(['napkinWizard']);
    expect(store.getState().badges.napkinWizard).toEqual({ levelId: 'c' });
  });

  it('remembers napkin-maths answers: a bonus stays earned, a skip keeps the last guess', () => {
    const store = createProgressStore({ storage: null });
    const { recordEstimate } = store.getState();
    recordEstimate(LEVEL, null, false);
    expect(store.getState().estimates[LEVEL]).toEqual({ guess: null, close: false });
    recordEstimate(LEVEL, 3.5, true);
    expect(store.getState().estimates[LEVEL]).toEqual({ guess: 3.5, close: true });
    recordEstimate(LEVEL, 9, false);
    expect(store.getState().estimates[LEVEL]).toEqual({ guess: 9, close: true });
    recordEstimate(LEVEL, null, false);
    expect(store.getState().estimates[LEVEL]).toEqual({ guess: 9, close: true });
    // A skip can't claim the bonus.
    store.getState().recordEstimate('other', null, true);
    expect(store.getState().estimates.other).toEqual({ guess: null, close: false });
  });

  it('persists changes and restores them in a new store', () => {
    const storage = memoryStorage();
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    store.getState().updateDraft(LEVEL, edited);
    store.getState().recordRun(LEVEL, 'pass', ['rightSized']);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);

    const reloaded = createProgressStore({ storage });
    expect(selectDraft(reloaded.getState(), LEVEL)).toEqual(edited);
    expect(reloaded.getState().bestGrades).toEqual({ [LEVEL]: 'pass' });
    expect(reloaded.getState().badges).toEqual({ rightSized: { levelId: LEVEL } });
  });

  it('migrates a version 1 save without losing anything, and awards the badges it already earned', () => {
    const storage = memoryStorage();
    const v1 = {
      version: 1,
      drafts: { [LEVEL]: edited },
      bestGrades: { '01-hello-traffic': 'mastered', '02-scale-out': 'mastered', '03-pull-the-plug': 'mastered', '07-the-write-wall': 'fail' },
      estimates: { a: { guess: 1, close: true }, b: { guess: 2, close: true }, c: { guess: 3, close: true } },
    };
    storage.data.set(STORAGE_KEY, JSON.stringify(v1));
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    const state = store.getState();
    expect(selectDraft(state, LEVEL)).toEqual(edited);
    expect(state.bestGrades).toEqual(v1.bestGrades);
    expect(state.estimates).toEqual(v1.estimates);
    expect(state.badges).toEqual({ fiveNinesClub: { levelId: null }, napkinWizard: { levelId: null } });
    // Nothing is written until something changes; then it's the current version, with everything kept.
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!).version).toBe(1);
    state.updateDraft('other', edited);
    const written = JSON.parse(storage.data.get(STORAGE_KEY)!);
    expect(written.version).toBe(2);
    expect(written.bestGrades).toEqual(v1.bestGrades);
    expect(written.badges).toEqual({ fiveNinesClub: { levelId: null }, napkinWizard: { levelId: null } });
  });

  it('never writes over a save it could neither read nor back up', () => {
    const data = new Map([[STORAGE_KEY, '{garbage']]);
    const storage: StorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: () => {
        throw new Error('full');
      },
    };
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    store.getState().updateDraft(LEVEL, edited);
    expect(data.get(STORAGE_KEY)).toBe('{garbage');
  });

  it('debounces writes and flushes on demand', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const store = createProgressStore({ storage, writeDelayMs: 300 });
      store.getState().updateDraft(LEVEL, edited);
      expect(storage.data.size).toBe(0);
      vi.advanceTimersByTime(300);
      expect(storage.data.size).toBe(1);

      store.getState().resetDraft(LEVEL);
      store.flush();
      expect(JSON.parse(storage.data.get(STORAGE_KEY)!).drafts).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps working when storage throws', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    expect(() => store.getState().updateDraft(LEVEL, edited)).not.toThrow();
    expect(selectDraft(store.getState(), LEVEL)).toBe(edited);
  });
});
