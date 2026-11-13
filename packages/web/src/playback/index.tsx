/**
 * Run mode: plays back a graded simulation on the read-only canvas.
 *
 * - `controller.ts` owns the clock and the requestAnimationFrame loop; React only sees throttled snapshots (~20 Hz).
 * - `ParticleLayer` draws request dots and failure marks on a Canvas2D overlay, every frame, outside React.
 * - `TimelineStrip`, the theme's `BudgetMeter` and `ControlBar` make up the dock under the canvas.
 * - On the freeze-frame (the error budget runs out) the root-cause node is highlighted and the theme's `PostmortemCard` shows.
 *
 * The maths (clock, interpolation, edge flows, spawn rates, budget) lives in pure modules with unit tests.
 */
import { AVAILABILITY_TIERS, type Level } from '@five-nines/sim';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DesignCanvas, type CanvasHandle, type Draft, type NodeMark } from '../canvas/index.ts';
import type { GradedEvaluation } from '../engine/index.ts';
import { ControlBar } from './ControlBar.tsx';
import { PlaybackController } from './controller.ts';
import { ParticleLayer } from './ParticleLayer.tsx';
import { focusViewport } from './focus.ts';
import { incidentAtFreeze } from './incident.ts';
import { prepareSeries } from './series.ts';
import { TimelineStrip } from './TimelineStrip.tsx';
import { useReducedMotion } from './useReducedMotion.ts';
import { BudgetMeter, failoverSituation, PostmortemCard } from '../theme/index.ts';
import { LatencyNote } from './LatencyNote.tsx';

export interface PlaybackProps {
  /** The level that was run. */
  level: Level;
  /** Exactly the draft that was simulated (a snapshot; the editor's draft may differ later). Render it read-only. */
  draft: Draft;
  /** The graded result. `evaluation.simulation.timeline` has one frame per simulated second. */
  evaluation: GradedEvaluation;
  /**
   * Go to the result screen: call when playback reaches the end, on "See results" in the postmortem card, or on
   * "skip to end" if playback treats that as finishing. Records the grade.
   */
  onFinished(): void;
  /** Abandon the run and return to the editor (e.g. an Esc or "Stop" control). */
  onExit(): void;
}

/** The beat between reaching the end and moving on to the results. */
const FINISH_DELAY_MS = 900;
const NO_MARKS: Readonly<Record<string, NodeMark>> = {};

export function Playback({ level, draft, evaluation, onFinished, onExit }: PlaybackProps) {
  const { simulation } = evaluation;
  const reducedMotion = useReducedMotion();
  const [controller] = useState(
    () => new PlaybackController(prepareSeries(simulation, evaluation.errorBudgetExhaustedAtSec)),
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { clock } = snapshot;

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  // ---- freeze-frame: highlight the root cause and bring it into view ----

  const frozen = clock.freeze.kind === 'frozen';
  const exhaustedAtSec = evaluation.errorBudgetExhaustedAtSec;
  const failover = useMemo(
    () => (exhaustedAtSec === null ? null : failoverSituation(draft.design, simulation, exhaustedAtSec + 1)),
    [draft.design, simulation, exhaustedAtSec],
  );
  const rootCauseId = simulation.causes[0]?.nodeId ?? null;
  const marks = useMemo(
    () => (frozen && rootCauseId ? { [rootCauseId]: 'focus' as const } : NO_MARKS),
    [frozen, rootCauseId],
  );
  const handleRef = useRef<CanvasHandle | null>(null);
  const onReady = useCallback((handle: CanvasHandle) => {
    handleRef.current = handle;
  }, []);
  const wasFrozen = useRef(false);
  const postmortemRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const handle = handleRef.current;
    const node = rootCauseId ? handle?.getNodeRect(rootCauseId) : null;
    if (frozen && !wasFrozen.current && handle && node) {
      // Centre the root cause in the space beside the postmortem card, not under it.
      const zoom = Math.min(1.2, Math.max(1, handle.getViewport().zoom));
      const card = postmortemRef.current?.getBoundingClientRect();
      const canvas = handle.getContainer()?.getBoundingClientRect();
      const coveredFromX = card && canvas ? card.left - canvas.left : null;
      const viewport = focusViewport(node, zoom, handle.getSize(), coveredFromX);
      void handle.setViewport(viewport, { durationMs: reducedMotion ? 0 : 800 });
    } else if (!frozen && wasFrozen.current && handle) {
      void handle.fitView({ durationMs: reducedMotion ? 0 : 500, padding: 0.25 });
    }
    wasFrozen.current = frozen;
  }, [frozen, rootCauseId, reducedMotion]);

  // ---- finishing: after a short beat at the end, go to the results ----

  useEffect(() => {
    if (!clock.finished) return;
    const timer = setTimeout(onFinished, FINISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [clock.finished, onFinished]);

  // ---- keyboard: Space plays/pauses (and leaves the freeze-frame) ----

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (!event.repeat) controller.togglePlay();
    };
    // A focused button would also "click" on Space keyup; the shortcut owns Space during playback.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTyping(event.target)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [controller]);

  // ---- scrubbing: hold playback while dragging, then carry on as before ----

  const resumeAfterScrub = useRef(false);
  const onScrubStart = useCallback(() => {
    resumeAfterScrub.current = controller.getSnapshot().clock.playing;
    controller.pause();
  }, [controller]);
  const onScrubEnd = useCallback(() => {
    const { clock: now } = controller.getSnapshot();
    // Scrubbing onto the end stops there rather than restarting the run.
    if (resumeAfterScrub.current && now.timeSec < now.durationSec) controller.play();
    resumeAfterScrub.current = false;
  }, [controller]);

  const overlay = useMemo(
    () => <ParticleLayer controller={controller} design={draft.design} reducedMotion={reducedMotion} />,
    [controller, draft.design, reducedMotion],
  );

  return (
    <div className="playback">
      <div className="playback__stage">
        <DesignCanvas
          mode="readOnly"
          draft={draft}
          live={snapshot.frame}
          marks={marks}
          overlay={overlay}
          onReady={onReady}
        />
        {!frozen && (
          <LatencyNote timeline={simulation.timeline} timeSec={clock.timeSec} requiredMs={level.requirements.p99Ms} />
        )}
        {frozen && (
          <div className="pb-incident-stamp" aria-hidden>
            Incident
          </div>
        )}
        {frozen && evaluation.errorBudgetExhaustedAtSec !== null && (
          <PostmortemCard
            ref={postmortemRef}
            exhaustedAtSec={evaluation.errorBudgetExhaustedAtSec}
            {...incidentAtFreeze(simulation.causes, simulation.events, evaluation.errorBudgetExhaustedAtSec)}
            availability={snapshot.availability}
            failover={failover}
            onKeepWatching={controller.keepWatching}
            onSeeResults={onFinished}
          />
        )}
      </div>
      <div className="playback__dock">
        <ControlBar
          playing={clock.playing}
          speed={clock.speed}
          timeSec={clock.timeSec}
          durationSec={clock.durationSec}
          availability={snapshot.availability}
          passAvailability={AVAILABILITY_TIERS.pass}
          onTogglePlay={controller.togglePlay}
          onSpeed={controller.setSpeed}
          onSkipToEnd={controller.skipToEnd}
          onExit={onExit}
        />
        <div className="playback__panels">
          <TimelineStrip
            timeline={simulation.timeline}
            events={simulation.events}
            p99RequirementMs={level.requirements.p99Ms}
            timeSec={clock.timeSec}
            frame={snapshot.frame}
            exhaustedAtSec={evaluation.errorBudgetExhaustedAtSec}
            onSeek={controller.seek}
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
          />
          <BudgetMeter usage={snapshot.budget} />
        </div>
      </div>
    </div>
  );
}
