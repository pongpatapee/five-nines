/**
 * Saved progress in one versioned localStorage key. Every access is wrapped: the game must keep working when storage
 * is missing, full, disabled or holds garbage. Invalid entries are dropped one by one rather than discarding the save.
 */
import { DesignSchema, GradeSchema, type Grade } from '@five-nines/sim';
import { completeLayout } from '../canvas/layout.ts';
import type { Draft, XY } from '../canvas/types.ts';

/** Bump the version (and add a migration in `parseSave`) when the stored shape changes incompatibly. */
export const STORAGE_KEY = 'five-nines:v1';

export interface SaveData {
  /** Per-level drafts, keyed by level id. */
  drafts: Record<string, Draft>;
  /** Best grade ever recorded per level id. */
  bestGrades: Record<string, Grade>;
  /** The napkin-maths step per level id. Levels never asked have no entry. */
  estimates: Record<string, EstimateRecord>;
}

/** A level's napkin-maths answer. Kept for the "Napkin Wizard" badge (estimates within 10% on several levels). */
export interface EstimateRecord {
  /** The latest guess, or null when the player skipped without ever answering. */
  guess: number | null;
  /** Whether any guess on this level was close enough for the bonus mark. Once earned, it stays. */
  close: boolean;
}

/** The subset of `Storage` we use, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptySave(): SaveData {
  return { drafts: {}, bestGrades: {}, estimates: {} };
}

/** `window.localStorage`, or null when it doesn't exist or access throws (e.g. blocked cookies). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown): XY | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function parseDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null;
  const design = DesignSchema.safeParse(value.design);
  if (!design.success) return null;
  const layout: Record<string, XY> = {};
  if (isRecord(value.layout)) {
    for (const [id, raw] of Object.entries(value.layout)) {
      const position = parsePosition(raw);
      if (position) layout[id] = position;
    }
  }
  return completeLayout({ design: design.data, layout });
}

/** Parses stored JSON into a save, keeping every valid entry. Never throws. */
export function parseSave(raw: string | null): SaveData {
  const save = emptySave();
  if (raw === null) return save;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return save;
  }
  if (!isRecord(data) || data.version !== 1) return save;

  if (isRecord(data.drafts)) {
    for (const [levelId, value] of Object.entries(data.drafts)) {
      const draft = parseDraft(value);
      if (draft) save.drafts[levelId] = draft;
    }
  }
  if (isRecord(data.bestGrades)) {
    for (const [levelId, value] of Object.entries(data.bestGrades)) {
      const grade = GradeSchema.safeParse(value);
      if (grade.success) save.bestGrades[levelId] = grade.data;
    }
  }
  if (isRecord(data.estimates)) {
    for (const [levelId, value] of Object.entries(data.estimates)) {
      const record = parseEstimate(value);
      if (record) save.estimates[levelId] = record;
    }
  }
  return save;
}

function parseEstimate(value: unknown): EstimateRecord | null {
  if (!isRecord(value) || typeof value.close !== 'boolean') return null;
  const { guess } = value;
  if (guess !== null && !(typeof guess === 'number' && Number.isFinite(guess))) return null;
  return { guess, close: value.close };
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify({ version: 1, drafts: save.drafts, bestGrades: save.bestGrades, estimates: save.estimates });
}

/** Reads the save. Returns an empty save if storage is unavailable or broken. */
export function loadSave(storage: StorageLike | null): SaveData {
  if (!storage) return emptySave();
  try {
    return parseSave(storage.getItem(STORAGE_KEY));
  } catch {
    return emptySave();
  }
}

/** Writes the save. Returns false (and keeps playing) if storage is unavailable or the write fails. */
export function writeSave(storage: StorageLike | null, save: SaveData): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeSave(save));
    return true;
  } catch {
    return false;
  }
}
