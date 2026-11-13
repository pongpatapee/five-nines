/**
 * Sound effects: plays the theme's synthesised cues through one shared AudioContext. Silent unless the player has
 * turned sound on (`settingsStore`), and the context is only created once they have, from the toggle's click, which
 * is the user gesture browsers require before audio may start.
 */
import type { StoreApi } from 'zustand/vanilla';
import { settingsStore, type SettingsState } from '../state/index.ts';
import { theme, type SoundCue, type SoundSynth } from '../theme/index.ts';

/** Overall level: the cues are mixed for this, so they sit quietly under the player's own audio. */
export const MASTER_VOLUME = 0.6;

export interface SfxOptions {
  settings: StoreApi<SettingsState>;
  sounds: Readonly<Record<SoundCue, SoundSynth>>;
  /** Makes the context; null when the browser has no Web Audio. */
  createContext(): AudioContext | null;
}

export interface Sfx {
  play(cue: SoundCue): void;
}

export function createSfx({ settings, sounds, createContext }: SfxOptions): Sfx {
  let audio: { context: AudioContext; master: GainNode } | null = null;

  const open = () => {
    if (audio) return audio;
    const context = createContext();
    if (!context) return null;
    const master = context.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(context.destination);
    audio = { context, master };
    return audio;
  };

  return {
    play(cue) {
      if (!settings.getState().sound) return;
      try {
        const opened = open();
        if (!opened) return;
        const { context, master } = opened;
        if (context.state === 'suspended') void context.resume();
        sounds[cue](context, master, context.currentTime + 0.01);
      } catch {
        // Sound is a nicety: a browser that refuses it must never break the game.
      }
    },
  };
}

function browserContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? new Context() : null;
}

export const sfx = createSfx({ settings: settingsStore, sounds: theme.sounds, createContext: browserContext });

/** Plays a cue if sound is on. */
export function playCue(cue: SoundCue): void {
  sfx.play(cue);
}
