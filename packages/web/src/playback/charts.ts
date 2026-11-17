/**
 * Path math for the timeline strip's small charts. Charts are drawn in a coordinate space where x is simulated
 * seconds (each frame plotted at the middle of its second) and y runs from 0 (top) to `height` (bottom), and are
 * stretched to the strip's width with `preserveAspectRatio="none"`.
 */

/** Rounds up to 1, 2 or 5 × a power of ten, for a readable axis maximum. Never below `floor`. */
export function niceCeil(value: number, floor = 1): number {
  const v = Math.max(value, floor);
  const magnitude = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 5, 10]) {
    if (v <= step * magnitude + 1e-9 * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function y(value: number, max: number, height: number): number {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return round(height * (1 - ratio));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * An SVG polyline path through the values, breaking the line at nulls (e.g. p99 in a second with no successful
 * requests). Empty string if there is nothing to draw.
 */
export function linePath(values: readonly (number | null)[], max: number, height: number): string {
  let d = '';
  let pen = false;
  values.forEach((value, i) => {
    if (value === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${round(i + 0.5)},${y(value, max, height)}`;
    pen = true;
  });
  return d;
}

/** A closed area under the values, from the start of the first second to the end of the last. */
export function areaPath(values: readonly number[], max: number, height: number): string {
  if (values.length === 0) return '';
  let d = `M0,${height}L0,${y(values[0]!, max, height)}`;
  values.forEach((value, i) => {
    d += `L${round(i + 0.5)},${y(value, max, height)}`;
  });
  d += `L${values.length},${y(values[values.length - 1]!, max, height)}L${values.length},${height}Z`;
  return d;
}

/** The playhead time for a pointer at `clientX` over an element spanning `left`…`left + width`. */
export function timeAtPointer(clientX: number, left: number, width: number, durationSec: number): number {
  if (width <= 0) return 0;
  return Math.min(durationSec, Math.max(0, ((clientX - left) / width) * durationSec));
}
