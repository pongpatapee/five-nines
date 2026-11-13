/**
 * Player settings, kept apart from progress in their own versioned localStorage key. Sound is off until the player
 * turns it on. Like progress, every storage access is wrapped: settings that can't be read fall back to the defaults.
 */
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { browserStorage, type StorageLike } from './persistence.ts';

export const SETTINGS_KEY = 'five-nines:settings';
export const SETTINGS_VERSION = 1;

export interface Settings {
  /** Sound effects. Off by default. */
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({ sound: false });

export function parseSettings(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== SETTINGS_VERSION) {
      return DEFAULT_SETTINGS;
    }
    const { sound } = data as { sound?: unknown };
    return { sound: typeof sound === 'boolean' ? sound : DEFAULT_SETTINGS.sound };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, ...settings });
}

export interface SettingsState extends Settings {
  setSound(on: boolean): void;
}

export function createSettingsStore(storage: StorageLike | null): StoreApi<SettingsState> {
  let initial = DEFAULT_SETTINGS;
  try {
    initial = parseSettings(storage?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    // Blocked storage: defaults.
  }
  const store = createStore<SettingsState>()((set) => ({
    ...initial,
    setSound: (sound) => set((state) => (state.sound === sound ? state : { sound })),
  }));
  store.subscribe((state, prev) => {
    if (state.sound === prev.sound) return;
    try {
      storage?.setItem(SETTINGS_KEY, serializeSettings({ sound: state.sound }));
    } catch {
      // Full or blocked storage: the setting lasts this session.
    }
  });
  return store;
}

export const settingsStore = createSettingsStore(browserStorage());

export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}
