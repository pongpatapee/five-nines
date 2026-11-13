import { settingsStore, useSettings } from '../state/index.ts';
import { marks } from '../theme/index.ts';
import { playCue } from './sfx.ts';

/**
 * Turns sound effects on or off, remembered in settings. Sound starts off. Turning it on plays a soft tick, so the
 * player hears that it worked (and the click is the gesture the browser needs to start audio).
 */
export function SoundToggle({ className }: { className?: string }) {
  const on = useSettings((state) => state.sound);
  const toggle = () => {
    settingsStore.getState().setSound(!on);
    if (!on) playCue('nine');
  };
  return (
    <button
      type="button"
      className={`btn btn--sm btn--ghost sound-toggle${className ? ` ${className}` : ''}`}
      role="switch"
      aria-checked={on}
      data-on={on}
      onClick={toggle}
      title={on ? 'Sound effects are on: click to mute' : 'Sound effects are off: click to turn them on'}
    >
      <marks.Sound on={on} />
      Sound
      <span className="sound-toggle__state" aria-hidden>
        {on ? 'on' : 'off'}
      </span>
    </button>
  );
}
