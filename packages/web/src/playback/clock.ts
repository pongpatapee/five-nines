/**
 * The playback clock: a pure state machine over simulated time.
 *
 * `tick(state, dt)` advances it by `dt` real seconds; the actions (`play`, `seek`, …) are the only other way it
 * changes. It knows about the freeze-frame: when the playhead approaches the instant the error budget runs out, it
 * eases the speed down to slow motion so that it arrives exactly at that instant, then pauses and reports `frozen`.
 */
import { clamp } from './series.ts';

export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 4;

/** Speed the freeze eases down to (simulated seconds per real second). */
export const SLOW_MOTION_SPEED = 0.25;
/** Real seconds the freeze takes to ease from playing speed to slow motion. */
export const FREEZE_EASE_SEC = 1.5;
/** Largest real-time step taken in one tick, so a backgrounded tab doesn't jump ahead on return. */
export const MAX_TICK_SEC = 0.1;

export type FreezeState =
  /** The budget never runs out in this run. */
  | { kind: 'none' }
  /** Will freeze when playback reaches `atSec`. */
  | { kind: 'armed'; atSec: number }
  /**
   * Slowing down towards `atSec`: `elapsedSec` real seconds into an ease of `easeSec` that started at `fromSpeed`.
   * `easeSec` is fitted to the distance left when the ease began, so it arrives at `atSec` as it reaches slow motion.
   */
  | { kind: 'easing'; atSec: number; fromSpeed: number; elapsedSec: number; easeSec: number }
  /** Paused on the incident; the postmortem card is showing. */
  | { kind: 'frozen'; atSec: number }
  /** The player chose to keep watching. Never freezes again. */
  | { kind: 'dismissed' };

export interface ClockState {
  /** Playhead, in simulated seconds, 0…`durationSec`. */
  timeSec: number;
  durationSec: number;
  playing: boolean;
  /** The speed the player chose. The actual rate can be lower while easing into the freeze. */
  speed: Speed;
  freeze: FreezeState;
  /** Playback reached the end by playing or by "skip to end": time to show the results. */
  finished: boolean;
}

export function createClock(durationSec: number, freezeAtSec: number | null, speed: Speed = DEFAULT_SPEED): ClockState {
  return {
    timeSec: 0,
    durationSec,
    playing: true,
    speed,
    freeze: freezeAtSec === null ? { kind: 'none' } : { kind: 'armed', atSec: freezeAtSec },
    finished: false,
  };
}

/** Speed during the ease at progress `u` ∈ [0, 1]: decelerates hard at first, then settles into slow motion. */
export function easingSpeed(fromSpeed: number, u: number): number {
  const remaining = 1 - clamp(u, 0, 1);
  const slow = Math.min(SLOW_MOTION_SPEED, fromSpeed);
  return slow + (fromSpeed - slow) * remaining * remaining;
}

/** Simulated seconds covered by a full ease from `fromSpeed`: the integral of `easingSpeed` over the ease. */
export function easeDistance(fromSpeed: number, easeSec = FREEZE_EASE_SEC): number {
  return easeSec * meanEasingSpeed(fromSpeed);
}

/** Real seconds an ease from `fromSpeed` must last to cover `distanceSec` simulated seconds. */
export function easeDurationFor(fromSpeed: number, distanceSec: number): number {
  const mean = meanEasingSpeed(fromSpeed);
  return mean > 0 ? Math.max(0, distanceSec) / mean : 0;
}

function meanEasingSpeed(fromSpeed: number): number {
  const slow = Math.min(SLOW_MOTION_SPEED, fromSpeed);
  return slow + (fromSpeed - slow) / 3;
}

/** Simulated seconds per real second right now: 0 when paused, lower than `speed` while easing. */
export function currentRate(state: ClockState): number {
  if (!state.playing) return 0;
  if (state.freeze.kind === 'easing') {
    return easingSpeed(state.freeze.fromSpeed, easeProgress(state.freeze.elapsedSec, state.freeze.easeSec));
  }
  return state.speed;
}

function easeProgress(elapsedSec: number, easeSec: number): number {
  return easeSec > 0 ? elapsedSec / easeSec : 1;
}

/** Advances the clock by `dtSec` real seconds. */
export function tick(state: ClockState, dtSec: number): ClockState {
  if (!state.playing || !(dtSec > 0)) return state;
  const dt = Math.min(dtSec, MAX_TICK_SEC);
  let { freeze } = state;
  let timeSec = state.timeSec;

  // Start easing once the remaining distance to the freeze is what an ease from this speed covers.
  if (freeze.kind === 'armed' && timeSec < freeze.atSec && timeSec >= freeze.atSec - easeDistance(state.speed)) {
    const easeSec = easeDurationFor(state.speed, freeze.atSec - timeSec);
    freeze = { kind: 'easing', atSec: freeze.atSec, fromSpeed: state.speed, elapsedSec: 0, easeSec };
  }

  if (freeze.kind === 'easing') {
    const elapsedSec = freeze.elapsedSec + dt;
    // Midpoint rule: integrates the ease almost exactly at any frame rate.
    const rate = easingSpeed(freeze.fromSpeed, easeProgress(freeze.elapsedSec + dt / 2, freeze.easeSec));
    timeSec += rate * dt;
    if (timeSec >= freeze.atSec) {
      return { ...state, timeSec: freeze.atSec, playing: false, freeze: { kind: 'frozen', atSec: freeze.atSec } };
    }
    return { ...state, timeSec, freeze: { ...freeze, elapsedSec } };
  }

  timeSec += state.speed * dt;
  if (freeze.kind === 'armed' && state.timeSec < freeze.atSec && timeSec >= freeze.atSec) {
    // Only reachable if the ease window was skipped entirely (e.g. a huge step); freeze without the ease.
    return { ...state, timeSec: freeze.atSec, playing: false, freeze: { kind: 'frozen', atSec: freeze.atSec } };
  }
  if (timeSec >= state.durationSec) {
    return { ...state, timeSec: state.durationSec, playing: false, freeze, finished: true };
  }
  return { ...state, timeSec, freeze };
}

/** Starts or resumes. From the end, restarts from the beginning. On the freeze, keeps watching. */
export function play(state: ClockState): ClockState {
  if (state.freeze.kind === 'frozen') return keepWatching(state);
  if (state.timeSec >= state.durationSec) return { ...state, timeSec: 0, playing: true, finished: false };
  return { ...state, playing: true };
}

export function pause(state: ClockState): ClockState {
  return state.playing ? { ...state, playing: false } : state;
}

export function togglePlay(state: ClockState): ClockState {
  return state.playing ? pause(state) : play(state);
}

/** Changes the chosen speed. An ease already under way finishes from the speed it started at. */
export function setSpeed(state: ClockState, speed: Speed): ClockState {
  return { ...state, speed };
}

/**
 * Moves the playhead (scrubbing). Scrubbing never triggers the freeze; an interrupted ease re-arms, and seeking while
 * frozen counts as dismissing the incident. Keeps playing or paused as before.
 */
export function seek(state: ClockState, timeSec: number): ClockState {
  let { freeze } = state;
  if (freeze.kind === 'easing') freeze = { kind: 'armed', atSec: freeze.atSec };
  else if (freeze.kind === 'frozen') freeze = { kind: 'dismissed' };
  const t = clamp(timeSec, 0, state.durationSec);
  // Scrubbing onto the end while playing simply stops there; only playing through or skipping finishes.
  const playing = state.playing && t < state.durationSec;
  return { ...state, timeSec: t, playing, freeze, finished: false };
}

/**
 * Jumps to the end of the run and finishes. If the error budget runs out in the skipped stretch and the incident
 * hasn't been shown yet, stops on the freeze-frame instead: the incident is the point of the run.
 */
export function skipToEnd(state: ClockState): ClockState {
  const { freeze } = state;
  if ((freeze.kind === 'armed' || freeze.kind === 'easing') && state.timeSec <= freeze.atSec) {
    return { ...state, timeSec: freeze.atSec, playing: false, freeze: { kind: 'frozen', atSec: freeze.atSec }, finished: false };
  }
  const next: FreezeState = freeze.kind === 'frozen' || freeze.kind === 'easing' ? { kind: 'dismissed' } : freeze;
  return { ...state, timeSec: state.durationSec, playing: false, freeze: next, finished: true };
}

/** Leaves the freeze-frame and resumes playing. The run will not freeze again. */
export function keepWatching(state: ClockState): ClockState {
  return { ...state, freeze: { kind: 'dismissed' }, playing: state.timeSec < state.durationSec };
}
