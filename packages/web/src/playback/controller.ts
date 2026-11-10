/**
 * The playback runtime: owns the clock, drives it from requestAnimationFrame, and fans out to two kinds of listener:
 *
 * - **frame listeners** (the particle overlay) run on every animation frame, outside React;
 * - **snapshot subscribers** (React, via `useSyncExternalStore`) get a new snapshot at most every `emitIntervalMs`
 *   while playing (~20 Hz), and immediately on any discrete change (play/pause, speed, freeze, finish, seek).
 */
import type { LiveFrame } from '../canvas/types.ts';
import * as Clock from './clock.ts';
import type { ClockState } from './clock.ts';
import { availabilityUpTo, budgetUsage, sampleFrame, type BudgetUsage, type RunSeries } from './series.ts';

export interface PlaybackSnapshot {
  clock: ClockState;
  /** Interpolated live stats at the playhead. */
  frame: LiveFrame | null;
  budget: BudgetUsage;
  /** Availability of the requests seen so far. */
  availability: number;
}

export interface FrameInfo {
  /** Real seconds since the previous animation frame (0 on the first). */
  dtSec: number;
  /** Simulated seconds per real second right now (0 when paused). */
  rate: number;
  clock: ClockState;
  frame: LiveFrame | null;
}

export interface Scheduler {
  now(): number;
  request(callback: (now: number) => void): number;
  cancel(id: number): void;
}

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

export const SNAPSHOT_INTERVAL_MS = 50;

export class PlaybackController {
  private clock: ClockState;
  private snapshot: PlaybackSnapshot;
  private readonly subscribers = new Set<() => void>();
  private readonly frameListeners = new Set<(info: FrameInfo) => void>();
  private rafId: number | null = null;
  private lastNow: number | null = null;
  private lastEmit = -Infinity;
  readonly series: RunSeries;
  private readonly scheduler: Scheduler;
  private readonly emitIntervalMs: number;

  constructor(series: RunSeries, scheduler: Scheduler = browserScheduler, emitIntervalMs = SNAPSHOT_INTERVAL_MS) {
    this.series = series;
    this.scheduler = scheduler;
    this.emitIntervalMs = emitIntervalMs;
    this.clock = Clock.createClock(series.durationSec, series.exhaustedAt);
    this.snapshot = this.makeSnapshot();
  }

  // ---- React-facing store ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  readonly getSnapshot = (): PlaybackSnapshot => this.snapshot;

  /** Registers a per-animation-frame callback. Returns an unsubscribe. */
  onFrame(listener: (info: FrameInfo) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  // ---- loop ----

  start(): void {
    if (this.rafId !== null) return;
    this.lastNow = null;
    this.rafId = this.scheduler.request(this.loop);
  }

  stop(): void {
    if (this.rafId !== null) this.scheduler.cancel(this.rafId);
    this.rafId = null;
  }

  private readonly loop = (now: number): void => {
    const dtSec = this.lastNow === null ? 0 : Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const prev = this.clock;
    this.clock = Clock.tick(prev, dtSec);

    const frame = sampleFrame(this.series.timeline, this.clock.timeSec);
    const info: FrameInfo = { dtSec, rate: Clock.currentRate(this.clock), clock: this.clock, frame };
    for (const listener of this.frameListeners) listener(info);

    if (isDiscreteChange(prev, this.clock) || (this.clock !== prev && now - this.lastEmit >= this.emitIntervalMs)) {
      this.emit(now, frame);
    }
    this.rafId = this.scheduler.request(this.loop);
  };

  // ---- actions ----

  togglePlay = (): void => this.apply(Clock.togglePlay);
  play = (): void => this.apply(Clock.play);
  pause = (): void => this.apply(Clock.pause);
  setSpeed = (speed: Clock.Speed): void => this.apply((s) => Clock.setSpeed(s, speed));
  seek = (timeSec: number): void => this.apply((s) => Clock.seek(s, timeSec));
  skipToEnd = (): void => this.apply(Clock.skipToEnd);
  keepWatching = (): void => this.apply(Clock.keepWatching);

  private apply(action: (state: ClockState) => ClockState): void {
    const next = action(this.clock);
    if (next === this.clock) return;
    this.clock = next;
    this.emit(this.scheduler.now());
  }

  private emit(now: number, frame?: LiveFrame | null): void {
    this.lastEmit = now;
    this.snapshot = this.makeSnapshot(frame);
    for (const subscriber of this.subscribers) subscriber();
  }

  private makeSnapshot(frame?: LiveFrame | null): PlaybackSnapshot {
    const t = this.clock.timeSec;
    return {
      clock: this.clock,
      frame: frame !== undefined ? frame : sampleFrame(this.series.timeline, t),
      budget: budgetUsage(this.series, t),
      availability: availabilityUpTo(this.series, t),
    };
  }
}

function isDiscreteChange(a: ClockState, b: ClockState): boolean {
  return a.playing !== b.playing || a.speed !== b.speed || a.finished !== b.finished || a.freeze.kind !== b.freeze.kind;
}
