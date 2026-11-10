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
    const { recordGrade } = store.getState();
    recordGrade(LEVEL, 'fail');
    expect(store.getState().bestGrades[LEVEL]).toBe('fail');
    recordGrade(LEVEL, 'star');
    recordGrade(LEVEL, 'pass');
    expect(store.getState().bestGrades[LEVEL]).toBe('star');
    recordGrade(LEVEL, 'mastered');
    expect(store.getState().bestGrades[LEVEL]).toBe('mastered');
  });

  it('persists changes and restores them in a new store', () => {
    const storage = memoryStorage();
    const store = createProgressStore({ storage, writeDelayMs: 0 });
    store.getState().updateDraft(LEVEL, edited);
    store.getState().recordGrade(LEVEL, 'pass');
    expect(storage.data.has(STORAGE_KEY)).toBe(true);

    const reloaded = createProgressStore({ storage });
    expect(selectDraft(reloaded.getState(), LEVEL)).toEqual(edited);
    expect(reloaded.getState().bestGrades).toEqual({ [LEVEL]: 'pass' });
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
