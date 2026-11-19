import { CLIENTS_ID } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEY,
  loadSave,
  openSave,
  parseSave,
  SAVE_VERSION,
  serializeSave,
  STORAGE_KEY,
  writeSave,
  type StorageLike,
} from '../src/state/persistence.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

const draft = {
  design: {
    nodes: [{ id: 'app', kind: 'appServer' as const, size: 'large' as const, instances: 2 }],
    edges: [{ from: CLIENTS_ID, to: 'app' }],
  },
  layout: { [CLIENTS_ID]: { x: 0, y: 0 }, app: { x: 300, y: 10 } },
};

describe('persistence', () => {
  it('round-trips drafts and grades through storage', () => {
    const storage = new MemoryStorage();
    const save = {
      drafts: { '01-hello-traffic': draft },
      bestGrades: { '01-hello-traffic': 'star' as const },
      estimates: { '01-hello-traffic': { guess: 3.5, close: true }, '02-scale-out': { guess: null, close: false } },
      badges: { rightSized: { levelId: '02-scale-out' }, napkinWizard: { levelId: null } },
      peeked: { '03-pull-the-plug': true as const },
      stashedDrafts: { '03-pull-the-plug': draft },
      seenAllHands: { 'getting-online': true as const },
    };
    expect(writeSave(storage, save)).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(loadSave(storage)).toEqual(save);
  });

  it('starts empty when nothing is stored, storage is missing, or it throws', () => {
    const empty = { drafts: {}, bestGrades: {}, estimates: {}, badges: {}, peeked: {}, stashedDrafts: {}, seenAllHands: {} };
    expect(loadSave(new MemoryStorage())).toEqual(empty);
    expect(loadSave(null)).toEqual(empty);
    expect(loadSave(throwingStorage)).toEqual(empty);
    expect(writeSave(throwingStorage, empty)).toBe(false);
    expect(writeSave(null, empty)).toBe(false);
  });

  it('ignores malformed JSON and versions it does not know', () => {
    const empty = { drafts: {}, bestGrades: {}, estimates: {}, badges: {}, peeked: {}, stashedDrafts: {}, seenAllHands: {} };
    expect(parseSave('{not json')).toEqual(empty);
    expect(parseSave(JSON.stringify({ version: SAVE_VERSION + 1, drafts: { x: draft } }))).toEqual(empty);
    expect(parseSave(JSON.stringify({ version: 0, drafts: { x: draft } }))).toEqual(empty);
    expect(parseSave('null')).toEqual(empty);
  });

  it('migrates a version 1 save: drafts, grades and estimates kept, no badges yet', () => {
    const v1 = JSON.stringify({
      version: 1,
      drafts: { '01-hello-traffic': draft },
      bestGrades: { '01-hello-traffic': 'mastered', '02-scale-out': 'fail' },
      estimates: { '01-hello-traffic': { guess: 3.5, close: true } },
      // A version 1 save never had badges; anything here is ignored rather than trusted.
      badges: { rightSized: { levelId: 'x' } },
    });
    expect(parseSave(v1)).toEqual({
      drafts: { '01-hello-traffic': draft },
      bestGrades: { '01-hello-traffic': 'mastered', '02-scale-out': 'fail' },
      estimates: { '01-hello-traffic': { guess: 3.5, close: true } },
      badges: {},
      peeked: {},
      stashedDrafts: {},
      seenAllHands: {},
    });
    // Written back as the current version.
    expect(JSON.parse(serializeSave(parseSave(v1))).version).toBe(SAVE_VERSION);
  });

  it('migrates a version 2 save: everything kept, nothing peeked, no design kept aside', () => {
    const v2 = {
      version: 2,
      drafts: { '03-pull-the-plug': draft },
      bestGrades: { '01-hello-traffic': 'mastered', '03-pull-the-plug': 'fail' },
      estimates: { '01-hello-traffic': { guess: 3.5, close: true } },
      badges: { rightSized: { levelId: '01-hello-traffic' } },
      // A version 2 save never had these; anything here is ignored rather than trusted.
      peeked: { '03-pull-the-plug': true },
      stashedDrafts: { '03-pull-the-plug': draft },
    };
    expect(parseSave(JSON.stringify(v2))).toEqual({
      drafts: v2.drafts,
      bestGrades: v2.bestGrades,
      estimates: v2.estimates,
      badges: v2.badges,
      peeked: {},
      stashedDrafts: {},
      seenAllHands: {},
    });
    const written = JSON.parse(serializeSave(parseSave(JSON.stringify(v2))));
    expect(written.version).toBe(SAVE_VERSION);
    expect(written).toMatchObject({ drafts: v2.drafts, bestGrades: v2.bestGrades, estimates: v2.estimates, badges: v2.badges });
  });

  it('migrates a version 3 save: everything kept, no all-hands seen yet', () => {
    const v3 = {
      version: 3,
      drafts: { '03-pull-the-plug': draft },
      bestGrades: { '01-hello-traffic': 'mastered' },
      estimates: {},
      badges: { rightSized: { levelId: '01-hello-traffic' } },
      peeked: { '03-pull-the-plug': true },
      stashedDrafts: { '03-pull-the-plug': draft },
      // A version 3 save never had these; anything here is ignored rather than trusted.
      seenAllHands: { 'getting-online': true },
    };
    const { seenAllHands: _ignored, version: _version, ...kept } = v3;
    expect(parseSave(JSON.stringify(v3))).toEqual({ ...kept, seenAllHands: {} });
    expect(JSON.parse(serializeSave(parseSave(JSON.stringify(v3)))).version).toBe(SAVE_VERSION);
  });

  it('keeps the all-hands seen and drops malformed ones', () => {
    const raw = JSON.stringify({ version: 4, seenAllHands: { 'getting-online': true, 'growing-pains': 'yes', hypergrowth: false } });
    expect(parseSave(raw).seenAllHands).toEqual({ 'getting-online': true });
  });

  it('drops malformed peeks and kept designs', () => {
    const raw = JSON.stringify({
      version: 3,
      peeked: { a: true, b: 'yes', c: false },
      stashedDrafts: { a: draft, b: { design: 'nope' } },
    });
    expect(parseSave(raw).peeked).toEqual({ a: true });
    expect(Object.keys(parseSave(raw).stashedDrafts)).toEqual(['a']);
  });

  it('drops unknown or malformed badges', () => {
    const raw = JSON.stringify({
      version: 2,
      badges: { rightSized: { levelId: 'a' }, napkinWizard: { levelId: null }, legendary: { levelId: 'a' }, nPlusOne: 'yes', pennyPincher: { levelId: 3 } },
    });
    expect(parseSave(raw).badges).toEqual({ rightSized: { levelId: 'a' }, napkinWizard: { levelId: null } });
  });

  it('copies an unreadable save aside before anything can overwrite it', () => {
    const storage = new MemoryStorage();
    const future = JSON.stringify({ version: SAVE_VERSION + 1, bestGrades: { a: 'mastered' } });
    storage.setItem(STORAGE_KEY, future);
    expect(openSave(storage)).toEqual({ save: { drafts: {}, bestGrades: {}, estimates: {}, badges: {}, peeked: {}, stashedDrafts: {}, seenAllHands: {} }, writable: true });
    expect(storage.getItem(BACKUP_KEY)).toBe(future);
    // The first copy is the one kept.
    storage.setItem(STORAGE_KEY, '{garbage');
    openSave(storage);
    expect(storage.getItem(BACKUP_KEY)).toBe(future);
    // Readable saves are never copied.
    const fresh = new MemoryStorage();
    fresh.setItem(STORAGE_KEY, serializeSave({ drafts: {}, bestGrades: { a: 'pass' }, estimates: {}, badges: {}, peeked: {}, stashedDrafts: {}, seenAllHands: {} }));
    expect(openSave(fresh).save.bestGrades).toEqual({ a: 'pass' });
    expect(fresh.getItem(BACKUP_KEY)).toBeNull();
  });

  it('refuses to write over an unreadable save it could not back up', () => {
    const storage: StorageLike = {
      getItem: (key) => (key === STORAGE_KEY ? '{garbage' : null),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(openSave(storage).writable).toBe(false);
  });

  it('drops invalid entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      version: 1,
      drafts: {
        good: draft,
        badDesign: { design: { nodes: [{ id: 'X', kind: 'appServer', size: 'huge' }], edges: [] }, layout: {} },
        notObject: 42,
      },
      bestGrades: { good: 'pass', bad: 'legendary', alsoBad: 3 },
    });
    const save = parseSave(raw);
    expect(Object.keys(save.drafts)).toEqual(['good']);
    expect(save.bestGrades).toEqual({ good: 'pass' });
  });

  it('keeps valid napkin-math answers and drops broken ones', () => {
    const raw = JSON.stringify({
      version: 1,
      estimates: {
        answered: { guess: 50, close: true },
        skipped: { guess: null, close: false },
        noFlag: { guess: 50 },
        badGuess: { guess: 'fifty', close: false },
        badFlag: { guess: 1, close: 'yes' },
      },
    });
    expect(parseSave(raw).estimates).toEqual({
      answered: { guess: 50, close: true },
      skipped: { guess: null, close: false },
    });
    // Saves from before the estimate step load with none.
    expect(parseSave(JSON.stringify({ version: 1, drafts: {}, bestGrades: {} })).estimates).toEqual({});
  });

  it('repairs layouts: drops bad positions and fills missing ones', () => {
    const raw = serializeSave({
      drafts: { l: { design: draft.design, layout: { [CLIENTS_ID]: { x: 5, y: 5 }, app: { x: 'nope', y: 1 } } as never } },
      bestGrades: {},
      estimates: {},
      badges: {},
      peeked: {},
      stashedDrafts: {},
      seenAllHands: {},
    });
    const layout = parseSave(raw).drafts.l!.layout;
    expect(layout[CLIENTS_ID]).toEqual({ x: 5, y: 5 });
    expect(layout.app).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });
});
