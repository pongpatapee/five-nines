import { describe, expect, it } from 'vitest';
import {
  createClock,
  currentRate,
  DEFAULT_SPEED,
  easeDistance,
  easingSpeed,
  FREEZE_EASE_SEC,
  keepWatching,
  pause,
  play,
  seek,
  setSpeed,
  skipToEnd,
  SLOW_MOTION_SPEED,
  tick,
  togglePlay,
  type ClockState,
} from '../../src/playback/clock.ts';

/** Runs the clock at 60 fps until `until` says stop or `maxSec` real seconds pass. Returns real seconds elapsed. */
function run(state: ClockState, until: (s: ClockState) => boolean, maxSec = 600): { state: ClockState; realSec: number } {
  let realSec = 0;
  while (!until(state) && realSec < maxSec) {
    state = tick(state, 1 / 60);
    realSec += 1 / 60;
  }
  return { state, realSec };
}

describe('clock basics', () => {
  it('starts playing at 4× from zero', () => {
    const clock = createClock(180, null);
    expect(clock).toMatchObject({ timeSec: 0, playing: true, speed: DEFAULT_SPEED, freeze: { kind: 'none' } });
  });

  it('advances by speed × real time, and not at all when paused', () => {
    let clock = createClock(180, null);
    clock = tick(clock, 0.05);
    expect(clock.timeSec).toBeCloseTo(0.2);
    clock = tick(setSpeed(clock, 16), 0.05);
    expect(clock.timeSec).toBeCloseTo(1);
    expect(tick(pause(clock), 0.05).timeSec).toBeCloseTo(1);
    expect(currentRate(pause(clock))).toBe(0);
  });

  it('caps a single step so a backgrounded tab does not leap ahead', () => {
    expect(tick(createClock(180, null), 10).timeSec).toBeCloseTo(0.4);
  });

  it('finishes at the end, and replays from the start on play', () => {
    const { state } = run(createClock(10, null), (s) => !s.playing);
    expect(state).toMatchObject({ timeSec: 10, playing: false, finished: true });
    expect(play(state)).toMatchObject({ timeSec: 0, playing: true, finished: false });
  });

  it('skip to end finishes immediately when nothing goes wrong', () => {
    expect(skipToEnd(createClock(10, null))).toMatchObject({ timeSec: 10, playing: false, finished: true });
  });

  it('skip to end stops on the incident first if it has not been shown yet', () => {
    const skipped = skipToEnd(createClock(10, 5));
    expect(skipped).toMatchObject({ timeSec: 5, playing: false, finished: false, freeze: { kind: 'frozen', atSec: 5 } });
    // From the freeze-frame, skipping again finishes.
    expect(skipToEnd(skipped)).toMatchObject({ timeSec: 10, finished: true, freeze: { kind: 'dismissed' } });
  });

  it('skip to end also cuts an ease into the freeze short', () => {
    const { state } = run(createClock(10, 5), (s) => s.freeze.kind === 'easing');
    expect(skipToEnd(state)).toMatchObject({ timeSec: 5, finished: false, freeze: { kind: 'frozen' } });
  });

  it('skip to end finishes once the incident is behind the playhead or dismissed', () => {
    expect(skipToEnd(seek(createClock(10, 5), 7))).toMatchObject({ timeSec: 10, finished: true });
    expect(skipToEnd(keepWatching({ ...createClock(10, 5), timeSec: 5 }))).toMatchObject({ timeSec: 10, finished: true });
  });

  it('seeking clamps, keeps the play state, and never finishes', () => {
    const clock = createClock(10, null);
    expect(seek(clock, 4)).toMatchObject({ timeSec: 4, playing: true, finished: false });
    expect(seek(clock, -3).timeSec).toBe(0);
    expect(seek(clock, 99)).toMatchObject({ timeSec: 10, playing: false, finished: false });
  });
});

describe('freeze easing curve', () => {
  it('runs from the playing speed down to slow motion', () => {
    expect(easingSpeed(16, 0)).toBe(16);
    expect(easingSpeed(16, 1)).toBe(SLOW_MOTION_SPEED);
    expect(easingSpeed(16, 0.5)).toBeLessThan(16);
    expect(easingSpeed(16, 0.5)).toBeGreaterThan(SLOW_MOTION_SPEED);
  });

  it('covers easeDistance simulated seconds over the ease', () => {
    // Numerically integrate the curve and compare with the closed form.
    let distance = 0;
    const steps = 10_000;
    for (let i = 0; i < steps; i++) distance += easingSpeed(4, (i + 0.5) / steps) * (FREEZE_EASE_SEC / steps);
    expect(easeDistance(4)).toBeCloseTo(distance, 6);
  });
});

describe('freeze-frame', () => {
  it.each([1, 4, 16] as const)('eases down over ~1.5 s and pauses exactly on the incident at %i×', (speed) => {
    const clock = setSpeed(createClock(180, 64.4), speed);
    const easing = run(clock, (s) => s.freeze.kind !== 'armed');
    expect(easing.state.freeze.kind).toBe('easing');
    expect(easing.state.timeSec).toBeCloseTo(64.4 - easeDistance(speed), 0);

    const frozen = run(easing.state, (s) => s.freeze.kind === 'frozen');
    expect(frozen.state).toMatchObject({ timeSec: 64.4, playing: false, freeze: { kind: 'frozen' } });
    expect(frozen.realSec).toBeGreaterThan(FREEZE_EASE_SEC - 0.1);
    expect(frozen.realSec).toBeLessThan(FREEZE_EASE_SEC + 0.15);
  });

  it('slows down monotonically while easing', () => {
    let state = setSpeed(createClock(180, 50), 16);
    state = run(state, (s) => s.freeze.kind === 'easing').state;
    let previous = Infinity;
    while (state.freeze.kind === 'easing') {
      const rate = currentRate(state);
      expect(rate).toBeLessThanOrEqual(previous);
      previous = rate;
      state = tick(state, 1 / 60);
    }
  });

  it('keep watching resumes and never freezes again', () => {
    let state = run(createClock(100, 20), (s) => s.freeze.kind === 'frozen').state;
    state = keepWatching(state);
    expect(state).toMatchObject({ playing: true, freeze: { kind: 'dismissed' } });
    state = seek(state, 0);
    state = run(state, (s) => !s.playing).state;
    expect(state).toMatchObject({ timeSec: 100, finished: true, freeze: { kind: 'dismissed' } });
  });

  it('play (or Space) on the freeze-frame keeps watching', () => {
    const frozen = run(createClock(100, 20), (s) => s.freeze.kind === 'frozen').state;
    expect(togglePlay(frozen)).toMatchObject({ playing: true, freeze: { kind: 'dismissed' } });
  });

  it('scrubbing past the incident does not freeze; scrubbing back before it re-arms', () => {
    let state = seek(createClock(100, 20), 30);
    state = run(state, (s) => s.timeSec >= 40).state;
    expect(state.freeze.kind).toBe('armed');
    expect(state.playing).toBe(true);
    state = seek(state, 5);
    state = run(state, (s) => s.freeze.kind === 'frozen').state;
    expect(state.timeSec).toBe(20);
  });

  it('an interrupted ease re-arms on seek, and pausing mid-ease resumes the ease', () => {
    let state = run(createClock(100, 20), (s) => s.freeze.kind === 'easing').state;
    const paused = pause(tick(state, 0.2));
    expect(paused.freeze.kind).toBe('easing');
    expect(tick(paused, 0.1)).toBe(paused);
    state = seek(paused, 2);
    expect(state.freeze.kind).toBe('armed');
  });

  it('seeking while frozen dismisses the incident', () => {
    const frozen = run(createClock(100, 20), (s) => s.freeze.kind === 'frozen').state;
    expect(seek(frozen, 10)).toMatchObject({ playing: false, freeze: { kind: 'dismissed' } });
  });

  it('freezes before the end when the incident is in the last second', () => {
    const { state } = run(createClock(10, 9.9), (s) => !s.playing);
    expect(state).toMatchObject({ timeSec: 9.9, finished: false, freeze: { kind: 'frozen' } });
  });
});
