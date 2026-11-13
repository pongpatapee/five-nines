/**
 * Pen-and-ink primitives drawn as inline SVG: loops, ticks, crosses, arrows and the nines dots.
 *
 * Colours come from tokens (via `currentColor` or a `style`), never from SVG presentation attributes, so the theme
 * stays in the tokens. Strokes marked `ink-draw` draw themselves in (see notebook.css); reduced motion shows them
 * finished.
 */
import type { CSSProperties } from 'react';

/** Paint for an SVG element from tokens. Presentation attributes can't take `var()`, styles can. */
export function paint(fill: string | null, stroke?: string, strokeWidth?: number): CSSProperties {
  const style: CSSProperties = { fill: fill ?? 'none' };
  if (stroke) style.stroke = stroke;
  if (strokeWidth !== undefined) style.strokeWidth = strokeWidth;
  return style;
}

/**
 * A hand-drawn loop around a `width` × `height` box, overshooting where the pen started like a real circled note.
 * Deterministic for given dimensions.
 */
export function loopPath(width: number, height: number, inset = 4): string {
  const l = inset;
  const t = inset;
  const r = width - inset;
  const b = height - inset;
  const cx = width / 2;
  const cy = height / 2;
  return [
    `M${l + (r - l) * 0.08},${t + (b - t) * 0.22}`,
    `C${l + (r - l) * 0.3},${t - 2} ${r - (r - l) * 0.12},${t + 1} ${r - 2},${cy - (b - t) * 0.12}`,
    `C${r + 3},${cy + (b - t) * 0.22} ${r - (r - l) * 0.18},${b + 1} ${cx},${b - 1}`,
    `C${l + (r - l) * 0.12},${b - 2} ${l - 3},${cy + (b - t) * 0.18} ${l + 2},${cy - (b - t) * 0.08}`,
    `C${l + (r - l) * 0.06},${t + (b - t) * 0.06} ${l + (r - l) * 0.3},${t - 1} ${cx + (r - l) * 0.1},${t + 3}`,
  ].join(' ');
}

export interface InkLoopProps {
  /** The box being circled, in user units (roughly its pixel size, so the stroke stays even). */
  width: number;
  height: number;
  /** Delay before the pen starts, ms. */
  delayMs?: number;
  className?: string;
}

/** A red-pen loop that stretches over its positioned parent. Decorative. */
export function InkLoop({ width, height, delayMs = 0, className }: InkLoopProps) {
  return (
    <svg
      className={`ink-loop${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        className="ink-draw"
        d={loopPath(width, height)}
        pathLength={1}
        style={{ ...paint(null, 'var(--red-pen)', 2.6), animationDelay: `${delayMs}ms` }}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A green tick. */
export function Tick({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 22" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d="M3,12 L9,18 L21,3" style={paint(null, 'var(--green-pen)', 3)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A red cross. */
export function Cross({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d="M4,4 L16,16 M16,4 L4,16" style={paint(null, 'var(--red-pen)', 3)} strokeLinecap="round" />
    </svg>
  );
}

/** An empty hand-drawn checkbox (requirements lists). */
export function HandBox({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className="hand-box">
      <path d="M2,3 C7,2 12,2 16,3 C16,8 16,12 15,16 C10,16 6,16 2,15 C2,11 2,7 2,3 Z" style={paint(null, 'currentColor', 1.8)} />
    </svg>
  );
}

/** A wobbly arrow pointing right. */
export function HandArrow({ width = 40, className }: { width?: number; className?: string }) {
  return (
    <svg className={className} width={width} height={(width * 18) / 40} viewBox="0 0 40 18" aria-hidden>
      <path
        d="M2,10 C12,8 24,10 34,9 M26,2 L36,9 L27,16"
        style={paint(null, 'currentColor', 3)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface NinesDotsProps {
  /** Filled nines, 0 to `total`. */
  filled: number;
  total?: number;
  size?: 'sm' | 'md';
  /** Position when nested inside another SVG. */
  x?: number;
  y?: number;
}

/** The nines earned, as inked "9" coins; unearned ones are dashed pencil outlines. */
export function NinesDots({ filled, total = 3, size = 'md', x, y }: NinesDotsProps) {
  const r = size === 'sm' ? 8 : 10;
  const gap = 2 * r + 3;
  return (
    <svg
      className="nines-dots"
      x={x}
      y={y}
      width={gap * total - 3 + 2}
      height={2 * r + 2}
      viewBox={`-1 -1 ${gap * total - 3 + 2} ${2 * r + 2}`}
      role="img"
      aria-label={`${filled} of ${total} nines`}
    >
      {Array.from({ length: total }, (_, i) => {
        const cx = r + i * gap;
        const on = i < filled;
        return (
          <g key={i}>
            <circle
              cx={cx}
              cy={r}
              r={r - 0.5}
              style={on ? paint('var(--ink)') : paint('var(--paper)', 'var(--pencil)', 1.5)}
              strokeDasharray={on ? undefined : '3 2'}
            />
            <text
              x={cx}
              y={r + (size === 'sm' ? 4 : 4.5)}
              textAnchor="middle"
              className="nines-dots__nine"
              style={{ fill: on ? 'var(--paper-card)' : 'var(--pencil)', fontSize: size === 'sm' ? 12 : 13 }}
            >
              9
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Shared SVG filter defs, mounted once. `filter: url(#nb-wobble)` makes ruled lines look hand-drawn. */
export function NotebookDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        <filter id="nb-wobble" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={7} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3} />
        </filter>
      </defs>
    </svg>
  );
}

/** The playback freeze-frame's verdict over the root-cause node: circled in red pen, with a note. Decorative. */
export function RootCauseCircle() {
  return (
    <div className="root-cause" aria-hidden>
      <InkLoop width={240} height={150} delayMs={200} />
      <span className="root-cause__label">root cause</span>
    </div>
  );
}
