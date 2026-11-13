/**
 * The progress store: per-level drafts, best grades, estimates and badges, persisted to localStorage.
 *
 * Use the hooks (`useDraft`, `useBestGrade`, `useBestGrades`, `useBadges`) in components and
 * `progressStore.getState()` for actions. Writes to storage are debounced, and flushed when the page is hidden or
 * unloaded.
 */
import { CHAPTERS, type Chapter, type Grade } from '@five-nines/sim';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { emptyDraft } from '../canvas/draft.ts';
import type { Draft } from '../canvas/types.ts';
import {
  awardBadges,
  bestOf,
  progressBadges,
  runReward,
  type BadgeId,
  type EarnedBadges,
  type RunReward,
} from '../progression/index.ts';
import { browserStorage, openSave, writeSave, type EstimateRecord, type StorageLike } from './persistence.ts';

export interface ProgressState {
  /** Saved drafts by level id. Levels without an entry use `STARTING_DRAFT`. */
  drafts: Readonly<Record<string, Draft>>;
  /** Best grade per level id. Levels never graded have no entry. */
  bestGrades: Readonly<Record<string, Grade>>;
  /** The napkin-maths step per level id. Levels never asked have no entry. */
  estimates: Readonly<Record<string, EstimateRecord>>;
  /** Badges earned. */
  badges: EarnedBadges;

  /** Replaces a level's draft (design and layout). Autosaved. */
  updateDraft(levelId: string, draft: Draft): void;
  /** Throws away a level's draft, back to the starting draft (just the clients). */
  resetDraft(levelId: string): void;
  /**
   * Records a graded run: keeps the grade if it beats the level's best, awards `earned` (the run's badges, from
   * `runBadges`) and any progress badges the new best grade earns. Returns what the run paid out.
   */
  recordRun(levelId: string, grade: Grade, earned: readonly BadgeId[]): RunReward;
  /**
   * Records a napkin-maths answer (`guess` null for a skip). A skip never forgets an earlier guess, and a bonus once
   * earned stays earned. Returns the badges this answer earned for the first time.
   */
  recordEstimate(levelId: string, guess: number | null, close: boolean): BadgeId[];
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
  /** The campaign, for chapter badges and unlocks. */
  chapters?: readonly Chapter[];
}

export type ProgressStore = StoreApi<ProgressState> & {
  /** Writes any pending change to storage now. */
  flush(): void;
};

type Facts = Pick<ProgressState, 'bestGrades' | 'estimates' | 'badges'>;

/** The progress badges `facts` earn that it doesn't hold yet, credited to `levelId`. */
function withProgressBadges(chapters: readonly Chapter[], facts: Facts, levelId: string | null): EarnedBadges {
  const closeEstimates = Object.entries(facts.estimates)
    .filter(([, record]) => record.close)
    .map(([id]) => id);
  return awardBadges(facts.badges, progressBadges(chapters, { best: facts.bestGrades, closeEstimates }), levelId);
}

export function createProgressStore({ storage, writeDelayMs = 300, chapters = CHAPTERS }: ProgressStoreOptions): ProgressStore {
  const { save: initial, writable } = openSave(storage);
  // Saves from before badges (or from before a badge existed) get what their progress already earned.
  const initialBadges = withProgressBadges(chapters, initial, null);

  const store = createStore<ProgressState>()((set, get) => ({
    drafts: initial.drafts,
    bestGrades: initial.bestGrades,
    estimates: initial.estimates,
    badges: initialBadges,
    updateDraft: (levelId, draft) =>
      set((state) => (state.drafts[levelId] === draft ? state : { drafts: { ...state.drafts, [levelId]: draft } })),
    resetDraft: (levelId) =>
      set((state) => {
        if (!(levelId in state.drafts)) return state;
        const { [levelId]: _removed, ...drafts } = state.drafts;
        return { drafts };
      }),
    recordRun: (levelId, grade, earned) => {
      const before = get();
      const best = bestOf(before.bestGrades[levelId], grade);
      const bestGrades = best === before.bestGrades[levelId] ? before.bestGrades : { ...before.bestGrades, [levelId]: best };
      const withRun = awardBadges(before.badges, earned, levelId);
      const badges = withProgressBadges(chapters, { ...before, bestGrades, badges: withRun }, levelId);
      if (bestGrades !== before.bestGrades || badges !== before.badges) set({ bestGrades, badges });
      return runReward(chapters, levelId, { best: before.bestGrades, badges: before.badges }, { best: bestGrades, badges });
    },
    recordEstimate: (levelId, guess, close) => {
      const state = get();
      const previous = state.estimates[levelId];
      const next: EstimateRecord = {
        guess: guess ?? previous?.guess ?? null,
        close: (previous?.close ?? false) || (guess !== null && close),
      };
      if (previous && previous.guess === next.guess && previous.close === next.close) return [];
      const estimates = { ...state.estimates, [levelId]: next };
      const badges = withProgressBadges(chapters, { ...state, estimates }, levelId);
      set(badges === state.badges ? { estimates } : { estimates, badges });
      return (Object.keys(badges) as BadgeId[]).filter((id) => state.badges[id] === undefined);
    },
  }));

  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    if (!writable) return;
    const { drafts, bestGrades, estimates, badges } = store.getState();
    writeSave(storage, { drafts, bestGrades, estimates, badges });
  };
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    write();
  };

  store.subscribe((state, prev) => {
    if (
      state.drafts === prev.drafts &&
      state.bestGrades === prev.bestGrades &&
      state.estimates === prev.estimates &&
      state.badges === prev.badges
    ) {
      return;
    }
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

export function useEstimate(levelId: string): EstimateRecord | undefined {
  return useProgress((state) => state.estimates[levelId]);
}

export function useBadges(): EarnedBadges {
  return useProgress((state) => state.badges);
}
