import { CLIENTS_ID } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import { loadSave, parseSave, serializeSave, STORAGE_KEY, writeSave, type StorageLike } from '../src/state/persistence.ts';

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
    const save = { drafts: { '01-hello-traffic': draft }, bestGrades: { '01-hello-traffic': 'star' as const } };
    expect(writeSave(storage, save)).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(loadSave(storage)).toEqual(save);
  });

  it('starts empty when nothing is stored, storage is missing, or it throws', () => {
    const empty = { drafts: {}, bestGrades: {} };
    expect(loadSave(new MemoryStorage())).toEqual(empty);
    expect(loadSave(null)).toEqual(empty);
    expect(loadSave(throwingStorage)).toEqual(empty);
    expect(writeSave(throwingStorage, empty)).toBe(false);
    expect(writeSave(null, empty)).toBe(false);
  });

  it('ignores malformed JSON and other versions', () => {
    expect(parseSave('{not json')).toEqual({ drafts: {}, bestGrades: {} });
    expect(parseSave(JSON.stringify({ version: 2, drafts: { x: draft } }))).toEqual({ drafts: {}, bestGrades: {} });
    expect(parseSave('null')).toEqual({ drafts: {}, bestGrades: {} });
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

  it('repairs layouts: drops bad positions and fills missing ones', () => {
    const raw = serializeSave({
      drafts: { l: { design: draft.design, layout: { [CLIENTS_ID]: { x: 5, y: 5 }, app: { x: 'nope', y: 1 } } as never } },
      bestGrades: {},
    });
    const layout = parseSave(raw).drafts.l!.layout;
    expect(layout[CLIENTS_ID]).toEqual({ x: 5, y: 5 });
    expect(layout.app).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });
});
