/** Settings (sound off by default, persisted) and the synthesised sound effects, against a fake Web Audio graph. */
import { describe, expect, it } from 'vitest';
import { createSfx } from '../src/audio/sfx.ts';
import { createSettingsStore, DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY, type StorageLike } from '../src/state/index.ts';
import { theme, type SoundCue } from '../src/theme/index.ts';

const CUES: SoundCue[] = ['navigate', 'hint', 'nine', 'grade', 'badge', 'win', 'crash', 'incident'];

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** Just enough of Web Audio to record what a synth schedules. */
class FakeParam {
  value = 0;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['linear', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError('exponential ramps need a positive target');
    this.events.push(['exp', v, t]);
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect(node: FakeNode) {
    this.connections.push(node);
    return node;
  }
}

class FakeSource extends FakeNode {
  started: number | null = null;
  stopped: number | null = null;
  frequency = new FakeParam();
  type = '';
  buffer: unknown = null;
  start(at = 0) {
    this.started = at;
  }
  stop(at = 0) {
    this.stopped = at;
  }
}

class FakeContext {
  state = 'running';
  currentTime = 5;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() });
  }
  createOscillator() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

describe('settings', () => {
  it('starts with sound off', () => {
    expect(DEFAULT_SETTINGS.sound).toBe(false);
    expect(createSettingsStore(null).getState().sound).toBe(false);
    expect(createSettingsStore(memoryStorage()).getState().sound).toBe(false);
  });

  it('remembers the sound setting', () => {
    const storage = memoryStorage();
    createSettingsStore(storage).getState().setSound(true);
    expect(JSON.parse(storage.data.get(SETTINGS_KEY)!)).toEqual({ version: 1, sound: true });
    expect(createSettingsStore(storage).getState().sound).toBe(true);
  });

  it('falls back to the defaults for anything unreadable', () => {
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ version: 9, sound: true }))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ version: 1, sound: 'loud' }))).toEqual(DEFAULT_SETTINGS);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createSettingsStore(throwing);
    expect(() => store.getState().setSound(true)).not.toThrow();
    expect(store.getState().sound).toBe(true);
  });
});

describe('sound effects', () => {
  it('stays silent, without even making an audio context, while sound is off', () => {
    let made = 0;
    const settings = createSettingsStore(null);
    const sfx = createSfx({
      settings,
      sounds: theme.sounds,
      createContext: () => {
        made++;
        return new FakeContext() as unknown as AudioContext;
      },
    });
    for (const cue of CUES) sfx.play(cue);
    expect(made).toBe(0);
    settings.getState().setSound(true);
    sfx.play('win');
    sfx.play('nine');
    expect(made).toBe(1);
  });

  it('has a synth for every cue that starts at the cue time and stops everything it starts', () => {
    for (const cue of CUES) {
      const context = new FakeContext();
      theme.sounds[cue](context as unknown as BaseAudioContext, context.destination as unknown as AudioNode, 2);
      expect(context.sources.length, cue).toBeGreaterThan(0);
      for (const source of context.sources) {
        expect(source.started, cue).toBeGreaterThanOrEqual(2);
        expect(source.stopped, cue).not.toBeNull();
        // Short sounds: everything is over within a second and a half.
        expect(source.stopped!, cue).toBeGreaterThan(source.started!);
        expect(source.stopped!, cue).toBeLessThanOrEqual(3.5);
      }
    }
  });

  it('never lets a broken audio context break the game', () => {
    const settings = createSettingsStore(null);
    settings.getState().setSound(true);
    const sfx = createSfx({
      settings,
      sounds: theme.sounds,
      createContext: () => {
        throw new Error('NotAllowedError');
      },
    });
    expect(() => sfx.play('grade')).not.toThrow();
  });
});
