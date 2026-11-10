import { describe, expect, it } from 'vitest';
import { focusViewport } from '../../src/playback/focus.ts';

const node = { x: 300, y: 0, width: 200, height: 80 };
const size = { width: 940, height: 520 };
const screenCentre = (v: { x: number; y: number; zoom: number }) => ({
  x: (node.x + node.width / 2) * v.zoom + v.x,
  y: (node.y + node.height / 2) * v.zoom + v.y,
});

describe('freeze-frame focus', () => {
  it('centres the node on the canvas when nothing covers it', () => {
    expect(screenCentre(focusViewport(node, 1.2, size, null))).toEqual({ x: 470, y: 260 });
  });

  it('centres the node in the space left of the postmortem card', () => {
    const viewport = focusViewport(node, 1.2, size, 520);
    expect(viewport.zoom).toBe(1.2);
    expect(screenCentre(viewport)).toEqual({ x: 260, y: 260 });
  });

  it('falls back to the canvas centre when the node does not fit beside the card', () => {
    expect(screenCentre(focusViewport(node, 1.2, size, 200)).x).toBe(470);
  });
});
