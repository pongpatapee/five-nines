import { describe, expect, it } from 'vitest';
import { linePath, areaPath, niceCeil, timeAtPointer } from '../../src/playback/charts.ts';
import { PlaybackController, type FrameInfo, type Scheduler } from '../../src/playback/controller.ts';
import { prepareSeries } from '../../src/playback/series.ts';
import { syntheticSimulation } from './fixtures.ts';

/** A manual animation-frame scheduler. */
function fakeScheduler() {
  let time = 0;
  let pending: ((now: number) => void) | null = null;
  const scheduler: Scheduler = {
    now: () => time,
    request: (callback) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  const frame = (ms: number) => {
    time += ms;
    const callback = pending;
    pending = null;
    callback?.(time);
  };
  return { scheduler, frame };
}

describe('PlaybackController', () => {
  const series = prepareSeries(syntheticSimulation(Array(20).fill(1000), Array(20).fill(0)), null);

  it('calls frame listeners every frame but throttles snapshots to ~20 Hz', () => {
    const { scheduler, frame } = fakeScheduler();
    const controller = new PlaybackController(series, scheduler, 50);
    const frames: FrameInfo[] = [];
    let notifications = 0;
    controller.onFrame((info) => frames.push(info));
    controller.subscribe(() => notifications++);
    controller.start();
    for (let i = 0; i < 61; i++) frame(1000 / 60);
    expect(frames.length).toBe(61);
    expect(notifications).toBeGreaterThanOrEqual(15);
    expect(notifications).toBeLessThanOrEqual(21);
    // 4× for one second (the first frame only sets the time base).
    expect(frames.at(-1)!.clock.timeSec).toBeCloseTo(4, 6);
    // The React snapshot lags the clock by at most one throttle interval.
    expect(controller.getSnapshot().clock.timeSec).toBeGreaterThan(4 - 4 * 0.05 - 1e-9);
  });

  it('emits immediately on actions and stops ticking after stop()', () => {
    const { scheduler, frame } = fakeScheduler();
    const controller = new PlaybackController(series, scheduler);
    let notifications = 0;
    controller.subscribe(() => notifications++);
    controller.start();
    controller.pause();
    expect(notifications).toBe(1);
    expect(controller.getSnapshot().clock.playing).toBe(false);
    controller.seek(10);
    expect(controller.getSnapshot().clock.timeSec).toBe(10);
    expect(controller.getSnapshot().frame?.atSec).toBe(10);
    controller.stop();
    controller.play();
    frame(1000);
    expect(controller.getSnapshot().clock.timeSec).toBe(10);
  });
});

describe('chart paths', () => {
  it('rounds axis maxima up to 1, 2 or 5 × 10ⁿ', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(1500)).toBe(2000);
    expect(niceCeil(5000)).toBe(5000);
    expect(niceCeil(5001)).toBe(10000);
    expect(niceCeil(0.3, 0.1)).toBe(0.5);
  });

  it('plots values at the middle of each second, top = max', () => {
    expect(linePath([0, 50, 100], 100, 10)).toBe('M0.5,10L1.5,5L2.5,0');
  });

  it('breaks lines at nulls', () => {
    expect(linePath([10, null, 10], 10, 10)).toBe('M0.5,0M2.5,0');
    expect(linePath([], 10, 10)).toBe('');
  });

  it('closes areas along the baseline across the whole run', () => {
    expect(areaPath([10, 10], 10, 10)).toBe('M0,10L0,0L0.5,0L1.5,0L2,0L2,10Z');
    expect(areaPath([], 10, 10)).toBe('');
  });

  it('maps pointer positions to playhead time, clamped', () => {
    expect(timeAtPointer(150, 100, 200, 180)).toBe(45);
    expect(timeAtPointer(0, 100, 200, 180)).toBe(0);
    expect(timeAtPointer(999, 100, 200, 180)).toBe(180);
  });
});
