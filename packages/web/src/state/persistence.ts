/**
 * Saved progress in one localStorage key, versioned inside. Every access is wrapped: the game must keep working when
 * storage is missing, full, disabled or holds garbage. Invalid entries are dropped one by one rather than discarding
 * the save, and a save this build can't read at all (garbage, or written by a newer build) is copied aside to
 * `BACKUP_KEY` before anything could overwrite it. A player's progress is never wiped.
 *
 * Versions:
 * - 1: drafts, best grades and napkin-math estimates.
 * - 2: adds earned badges. A version 1 save loads with none; the progress store then awards the badges its grades
 *   and estimates already earn (Five Nines Club, Napkin Wizard).
 * - 3: adds the levels whose solution was seen before passing (`peeked`) and the player's own designs kept aside
 *   while a reference solution is on the canvas (`stashedDrafts`). Older saves load with neither, and keep everything
 *   else.
 */
import { DesignSchema, GradeSchema, type Grade } from '@five-nines/sim';
import { completeLayout } from '../canvas/layout.ts';
import type { Draft, XY } from '../canvas/types.ts';
import { isBadgeId, type BadgeId, type BadgeRecord, type EarnedBadges } from '../progression/index.ts';

/** The key never changes; the version lives in the data. Bump `SAVE_VERSION` and migrate in `parseSave`. */
export const STORAGE_KEY = 'five-nines:v1';
/** Where an unreadable save is copied, once, before the game starts afresh. */
export const BACKUP_KEY = 'five-nines:unreadable-backup';
export const SAVE_VERSION = 3;

export interface SaveData {
  /** Per-level drafts, keyed by level id. */
  drafts: Record<string, Draft>;
  /** Best grade ever recorded per level id. */
  bestGrades: Record<string, Grade>;
  /** The napkin-math step per level id. Levels never asked have no entry. */
  estimates: Record<string, EstimateRecord>;
  /** Badges earned, by id. */
  badges: EarnedBadges;
  /** Levels whose reference solution the player saw before passing them (progression/peek.ts). */
  peeked: Record<string, true>;
  /** The player's own design per level id, kept aside while a reference solution is loaded onto the canvas. */
  stashedDrafts: Record<string, Draft>;
}

/** A level's napkin-math answer. Kept for the "Napkin Wizard" badge (estimates within 10% on several levels). */
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
  return { drafts: {}, bestGrades: {}, estimates: {}, badges: {}, peeked: {}, stashedDrafts: {} };
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

/** A save read from storage: `readable` is false when something was stored but this build can't read it. */
export interface ParsedSave {
  save: SaveData;
  readable: boolean;
}

/** Parses stored JSON into a save, keeping every valid entry and migrating older versions. Never throws. */
export function parseSave(raw: string | null): SaveData {
  return readSave(raw).save;
}

export function readSave(raw: string | null): ParsedSave {
  const save = emptySave();
  if (raw === null) return { save, readable: true };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { save, readable: false };
  }
  if (!isRecord(data) || typeof data.version !== 'number' || data.version < 1 || data.version > SAVE_VERSION) {
    return { save, readable: false };
  }

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
  // Version 1 had no badges: nothing to read.
  if (data.version >= 2 && isRecord(data.badges)) save.badges = parseBadges(data.badges);
  // Versions 1 and 2 had no peeks and no stashed designs.
  if (data.version >= 3) {
    if (isRecord(data.peeked)) {
      for (const [levelId, value] of Object.entries(data.peeked)) if (value === true) save.peeked[levelId] = true;
    }
    if (isRecord(data.stashedDrafts)) {
      for (const [levelId, value] of Object.entries(data.stashedDrafts)) {
        const draft = parseDraft(value);
        if (draft) save.stashedDrafts[levelId] = draft;
      }
    }
  }
  return { save, readable: true };
}

function parseBadges(value: Record<string, unknown>): EarnedBadges {
  const badges: Partial<Record<BadgeId, BadgeRecord>> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isBadgeId(id) || !isRecord(raw)) continue;
    const { levelId } = raw;
    if (levelId === null || typeof levelId === 'string') badges[id] = { levelId };
  }
  return badges;
}

function parseEstimate(value: unknown): EstimateRecord | null {
  if (!isRecord(value) || typeof value.close !== 'boolean') return null;
  const { guess } = value;
  if (guess !== null && !(typeof guess === 'number' && Number.isFinite(guess))) return null;
  return { guess, close: value.close };
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    drafts: save.drafts,
    bestGrades: save.bestGrades,
    estimates: save.estimates,
    badges: save.badges,
    peeked: save.peeked,
    stashedDrafts: save.stashedDrafts,
  });
}

/** Reads the save. Returns an empty save if storage is unavailable or broken. */
export function loadSave(storage: StorageLike | null): SaveData {
  return openSave(storage).save;
}

/**
 * Reads the save for a store that will write it back. A stored save that can't be read is copied to `BACKUP_KEY`
 * first (unless a backup is already there). If that copy fails, `writable` is false: the store must not write, or it
 * would overwrite the only copy.
 */
export function openSave(storage: StorageLike | null): { save: SaveData; writable: boolean } {
  if (!storage) return { save: emptySave(), writable: false };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: writes will fail too, harmlessly.
    return { save: emptySave(), writable: true };
  }
  const { save, readable } = readSave(raw);
  if (readable || raw === null) return { save, writable: true };
  try {
    if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw);
    return { save, writable: true };
  } catch {
    return { save, writable: false };
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
