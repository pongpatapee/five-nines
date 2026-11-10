/**
 * Run mode. PHASE 1 PLACEHOLDER: the playback agent replaces this file's implementation (and owns `src/playback/`),
 * keeping `PlaybackProps` and the `Playback` export so `screens/LevelScreen.tsx` doesn't change.
 *
 * Canvas APIs to build on (all from `../canvas/index.ts`):
 * - `<DesignCanvas mode="readOnly" draft live={frame} marks={{ [rootCauseId]: 'focus' }} overlay={<Particles/>}>`
 * - inside `overlay`: `useCanvasHandle()` → `getViewport()`, `subscribeViewport()`, `getSize()`, `getNodeRects()`,
 *   `getEdgeGeometry()`, `focusNode(id, { zoom })`, `fitView()`; map with `flowToContainer(point, viewport)` and
 *   walk edges with `pointOnEdge(source, target, t)` from `canvas/geometry.ts`.
 * - `describeCause(cause)` in `../describe.ts` phrases failure causes for the postmortem card.
 */
import type { Level } from '@five-nines/sim';
import { useEffect, useState, type CSSProperties } from 'react';
import { DesignCanvas, type Draft } from '../canvas/index.ts';
import type { GradedEvaluation } from '../engine/index.ts';

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

/** Minimal placeholder: steps quickly through the timeline with live node stats, then shows results. */
export function Playback({ draft, evaluation, onFinished, onExit }: PlaybackProps) {
  const timeline = evaluation.simulation.timeline;
  const [index, setIndex] = useState(0);
  const step = Math.max(1, Math.ceil(timeline.length / 40));

  useEffect(() => {
    if (index >= timeline.length - 1) {
      const done = setTimeout(onFinished, 400);
      return () => clearTimeout(done);
    }
    const tick = setTimeout(() => setIndex((i) => Math.min(timeline.length - 1, i + step)), 50);
    return () => clearTimeout(tick);
  }, [index, step, timeline.length, onFinished]);

  const frame = timeline[index] ?? null;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <DesignCanvas mode="readOnly" draft={draft} live={frame} />
      <div style={barStyle}>
        <span className="num">Running… t={frame?.atSec ?? 0}s</span>
        <button type="button" className="btn btn--sm" onClick={onFinished}>
          See results
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onExit}>
          Back to editor
        </button>
      </div>
    </div>
  );
}

const barStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  bottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 8,
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  zIndex: 10,
};
