/**
 * Where to put the root-cause node on the freeze-frame. Pure geometry, so it can be unit tested.
 */
import type { Rect } from '../canvas/types.ts';
import type { Viewport } from '../canvas/index.ts';

/** Space (screen pixels) kept between the focused node and the edges of the uncovered area. */
const FOCUS_MARGIN = 24;

/**
 * The viewport that centres `node` at `zoom` in the part of the canvas left of `coveredFromX` (the left edge of the
 * postmortem card, in canvas pixels), so the card doesn't hide it. Falls back to the centre of the whole canvas when
 * the node doesn't fit beside the card.
 */
export function focusViewport(
  node: Rect,
  zoom: number,
  size: { width: number; height: number },
  coveredFromX: number | null,
): Viewport {
  const free = coveredFromX === null ? size.width : Math.min(size.width, Math.max(0, coveredFromX));
  const fits = node.width * zoom + 2 * FOCUS_MARGIN <= free;
  const centreX = fits ? free / 2 : size.width / 2;
  return {
    x: centreX - (node.x + node.width / 2) * zoom,
    y: size.height / 2 - (node.y + node.height / 2) * zoom,
    zoom,
  };
}
