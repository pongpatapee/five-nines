/**
 * The timeline strip: three small charts over the whole run (offered req/s, failed req/s, p99 with the requirement
 * line), a playhead you can click or drag to scrub, and event markers with their message on hover.
 */
import type { SimEvent, TimelineFrame } from '@five-nines/sim';
import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatCount, formatMs, formatSimTime } from '../format.ts';
import { areaPath, linePath, niceCeil, timeAtPointer } from './charts.ts';
import type { LiveFrame } from '../canvas/types.ts';

export interface TimelineStripProps {
  timeline: readonly TimelineFrame[];
  events: readonly SimEvent[];
  p99RequirementMs: number;
  /** Playhead, simulated seconds. */
  timeSec: number;
  /** Interpolated values at the playhead, for the readouts. */
  frame: LiveFrame | null;
  /** The engine's freeze second, marked on the strip. */
  exhaustedAtSec: number | null;
  onSeek(timeSec: number): void;
  /** Scrub gesture boundaries, so playback can pause while dragging. */
  onScrubStart?(): void;
  onScrubEnd?(): void;
}

const ROW_HEIGHT = 30;

export function TimelineStrip(props: TimelineStripProps) {
  const { timeline, timeSec, frame, onSeek, onScrubStart, onScrubEnd } = props;
  const durationSec = timeline.length;
  const plotRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const percent = durationSec > 0 ? (timeSec / durationSec) * 100 : 0;
  const index = Math.min(durationSec - 1, Math.max(0, Math.floor(timeSec)));
  const p99Now = timeline[index]?.p99Ms ?? null;

  const seekTo = (event: ReactPointerEvent) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (rect) onSeek(timeAtPointer(event.clientX, rect.left, rect.width, durationSec));
  };

  return (
    <div className="pb-timeline">
      <div className="pb-timeline__labels" aria-hidden>
        <Readout label="offered" value={frame ? `${formatCount(frame.offeredRps, true)}/s` : '—'} />
        <Readout label="failed" value={frame ? `${formatCount(frame.failedRps, true)}/s` : '—'} tone={frame && frame.failedRps >= 0.5 ? 'failing' : undefined} />
        <Readout label={`p99 ≤ ${formatMs(props.p99RequirementMs)}`} value={formatMs(p99Now)} tone={p99Now !== null && p99Now > props.p99RequirementMs ? 'busy' : undefined} />
      </div>
      <div
        ref={plotRef}
        className="pb-timeline__plot"
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={Math.floor(timeSec)}
        aria-valuetext={formatSimTime(timeSec)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          onScrubStart?.();
          seekTo(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event);
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onScrubEnd?.();
        }}
        onPointerCancel={() => onScrubEnd?.()}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          if (event.key === 'ArrowLeft') onSeek(Math.max(0, timeSec - step));
          else if (event.key === 'ArrowRight') onSeek(Math.min(durationSec, timeSec + step));
          else if (event.key === 'Home') onSeek(0);
          else return;
          event.preventDefault();
        }}
      >
        <Charts timeline={timeline} p99RequirementMs={props.p99RequirementMs} exhaustedAtSec={props.exhaustedAtSec} />
        <div className="pb-timeline__played" style={{ width: `${percent}%` }} />
        <div className="pb-timeline__playhead" style={{ left: `${percent}%` }} />
        {props.events.map((event, i) => (
          <div
            key={i}
            className={`pb-timeline__event pb-timeline__event--${event.kind}`}
            style={{ left: `${(event.atSec / Math.max(1, durationSec)) * 100}%` }}
            onPointerEnter={() => setHovered(i)}
            onPointerLeave={() => setHovered((h) => (h === i ? null : h))}
          >
            {hovered === i && (
              <div className="pb-timeline__tooltip" role="tooltip">
                <span className="num faint">{formatSimTime(event.atSec)}</span> {event.message}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone?: 'failing' | 'busy' | undefined }) {
  return (
    <div className="pb-timeline__readout" style={{ height: ROW_HEIGHT }}>
      <span className="pb-timeline__label">{label}</span>
      <span className="pb-timeline__value num" data-tone={tone}>
        {value}
      </span>
    </div>
  );
}

/** The static chart paths. Memoised: they only depend on the run, not the playhead. */
const Charts = memo(function Charts({
  timeline,
  p99RequirementMs,
  exhaustedAtSec,
}: {
  timeline: readonly TimelineFrame[];
  p99RequirementMs: number;
  exhaustedAtSec: number | null;
}) {
  const charts = useMemo(() => {
    const offered = timeline.map((f) => f.offeredRps);
    const failed = timeline.map((f) => f.failedRps);
    const p99 = timeline.map((f) => f.p99Ms);
    const offeredMax = niceCeil(Math.max(0, ...offered));
    // Failures share the offered scale once they're large, but small failure rates still need to be visible.
    const failedMax = niceCeil(Math.max(0, ...failed), 1);
    const p99Max = niceCeil(Math.max(p99RequirementMs * 1.25, ...p99.map((v) => v ?? 0)));
    return {
      offered: areaPath(offered, offeredMax, ROW_HEIGHT),
      failed: areaPath(failed, failedMax, ROW_HEIGHT),
      p99: linePath(p99, p99Max, ROW_HEIGHT),
      requirementY: ROW_HEIGHT * (1 - p99RequirementMs / p99Max),
    };
  }, [timeline, p99RequirementMs]);
  const width = Math.max(1, timeline.length);

  return (
    <div className="pb-timeline__charts">
      <svg className="pb-chart pb-chart--offered" viewBox={`0 0 ${width} ${ROW_HEIGHT}`} preserveAspectRatio="none">
        <path d={charts.offered} />
      </svg>
      <svg className="pb-chart pb-chart--failed" viewBox={`0 0 ${width} ${ROW_HEIGHT}`} preserveAspectRatio="none">
        <path d={charts.failed} />
        {exhaustedAtSec !== null && (
          <line className="pb-chart__exhausted" x1={exhaustedAtSec} x2={exhaustedAtSec} y1={0} y2={ROW_HEIGHT} />
        )}
      </svg>
      <svg className="pb-chart pb-chart--p99" viewBox={`0 0 ${width} ${ROW_HEIGHT}`} preserveAspectRatio="none">
        <line className="pb-chart__requirement" x1={0} x2={width} y1={charts.requirementY} y2={charts.requirementY} />
        <path d={charts.p99} />
      </svg>
    </div>
  );
});
