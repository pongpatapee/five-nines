/**
 * The progress store: per-level drafts and best grades, persisted to localStorage.
 *
 * Use the hooks (`useDraft`, `useBestGrade`, `useBestGrades`) in components and `progressStore.getState()` for
 * actions. Writes to storage are debounced, and flushed when the page is hidden or unloaded.
 */
import type { Grade } from '@five-nines/sim';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { emptyDraft } from '../canvas/draft.ts';
import type { Draft } from '../canvas/types.ts';
import { gradeRank } from '../format.ts';
import { browserStorage, loadSave, writeSave, type StorageLike } from './persistence.ts';

export interface ProgressState {
  /** Saved drafts by level id. Levels without an entry use `STARTING_DRAFT`. */
  drafts: Readonly<Record<string, Draft>>;
  /** Best grade per level id. Levels never graded have no entry. */
  bestGrades: Readonly<Record<string, Grade>>;

  /** Replaces a level's draft (design and layout). Autosaved. */
  updateDraft(levelId: string, draft: Draft): void;
  /** Throws away a level's draft, back to the starting draft (just the clients). */
  resetDraft(levelId: string): void;
  /** Records a grade for a level, keeping it only if it beats the best so far. */
  recordGrade(levelId: string, grade: Grade): void;
}

/** Every level starts with just the clients node. Shared and frozen so selectors return a stable reference. */
export const STARTING_DRAFT: Draft = Object.freeze(emptyDraft());

export function selectDraft(state: ProgressState, levelId: string): Draft {
  return state.drafts[levelId] ?? STARTING_DRAFT;
}

export interface ProgressStoreOptions {
  storage: StorageLike | null;
  /** Debounce for storage writes. 0 writes synchronously on every change (tests). */
  writeDelayMs?: number;
}

export type ProgressStore = StoreApi<ProgressState> & {
  /** Writes any pending change to storage now. */
  flush(): void;
};

export function createProgressStore({ storage, writeDelayMs = 300 }: ProgressStoreOptions): ProgressStore {
  const initial = loadSave(storage);

  const store = createStore<ProgressState>()((set) => ({
    drafts: initial.drafts,
    bestGrades: initial.bestGrades,
    updateDraft: (levelId, draft) =>
      set((state) => (state.drafts[levelId] === draft ? state : { drafts: { ...state.drafts, [levelId]: draft } })),
    resetDraft: (levelId) =>
      set((state) => {
        if (!(levelId in state.drafts)) return state;
        const { [levelId]: _removed, ...drafts } = state.drafts;
        return { drafts };
      }),
    recordGrade: (levelId, grade) =>
      set((state) => {
        const best = state.bestGrades[levelId];
        if (best !== undefined && gradeRank(best) >= gradeRank(grade)) return state;
        return { bestGrades: { ...state.bestGrades, [levelId]: grade } };
      }),
  }));

  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    const { drafts, bestGrades } = store.getState();
    writeSave(storage, { drafts, bestGrades });
  };
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    write();
  };

  store.subscribe((state, prev) => {
    if (state.drafts === prev.drafts && state.bestGrades === prev.bestGrades) return;
    if (writeDelayMs <= 0) {
      write();
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(write, writeDelayMs);
  });

  return { ...store, flush };
}

/** The app's single progress store, backed by localStorage. */
export const progressStore = createProgressStore({ storage: browserStorage() });

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => progressStore.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') progressStore.flush();
  });
}

export function useProgress<T>(selector: (state: ProgressState) => T): T {
  return useStore(progressStore, selector);
}

/** The level's current draft (the starting draft if none is saved). */
export function useDraft(levelId: string): Draft {
  return useProgress((state) => selectDraft(state, levelId));
}

export function useBestGrade(levelId: string): Grade | undefined {
  return useProgress((state) => state.bestGrades[levelId]);
}

export function useBestGrades(): Readonly<Record<string, Grade>> {
  return useProgress((state) => state.bestGrades);
}
