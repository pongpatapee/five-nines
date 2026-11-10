import { CLIENTS_ID, LEVELS, validateDesign, type DesignIssue } from '@five-nines/sim';
import { describe, expect, it } from 'vitest';
import { addNode, connect, createNodeSpec, emptyDraft } from '../src/canvas/draft.ts';
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH } from '../src/canvas/layout.ts';
import type { Rect } from '../src/canvas/types.ts';
import { clampWhole, isTypingTarget } from '../src/editor/config.ts';
import { issueMarks, runBlocker, sortIssues } from '../src/editor/issues.ts';
import {
  centeredAt,
  findFreeSpot,
  occupiedRects,
  PLACEMENT_MARGIN,
  preferredPosition,
  rectContains,
  rectsOverlap,
  visibleFlowRect,
} from '../src/editor/placement.ts';
import { isDeletable, resolveSelection } from '../src/editor/selection.ts';

const VIEW: Rect = { x: -100, y: -400, width: 1400, height: 800 };
const box = (x: number, y: number): Rect => ({ x, y, width: NODE_WIDTH, height: NODE_HEIGHT });

describe('placement', () => {
  it('prefers the column right of the clients for a load balancer', () => {
    const draft = emptyDraft();
    expect(preferredPosition(draft, 'loadBalancer')).toEqual({ x: COLUMN_GAP, y: 0 });
    expect(preferredPosition(draft, 'appServer')).toEqual({ x: COLUMN_GAP, y: 0 });
  });

  it('prefers the column right of the rightmost load balancer for an app server', () => {
    const draft = addNode(emptyDraft(), createNodeSpec('loadBalancer', 'lb-1'), { x: 300, y: 50 });
    expect(preferredPosition(draft, 'appServer')).toEqual({ x: 300 + COLUMN_GAP, y: 0 });
  });

  it('uses the preferred spot when it is free', () => {
    expect(findFreeSpot({ preferred: { x: 310, y: 0 }, view: VIEW, occupied: [box(0, 0)] })).toEqual({ x: 310, y: 0 });
  });

  it('stacks in the same column when the preferred spot is taken', () => {
    const occupied = [box(0, 0), box(310, 0)];
    const spot = findFreeSpot({ preferred: { x: 310, y: 0 }, view: VIEW, occupied });
    expect(spot.x).toBe(310);
    expect(Math.abs(spot.y)).toBeGreaterThanOrEqual(NODE_HEIGHT + PLACEMENT_MARGIN);
    expect(occupied.some((rect) => rectsOverlap(box(spot.x, spot.y), rect, PLACEMENT_MARGIN))).toBe(false);
  });

  it('keeps new nodes inside the visible area', () => {
    const view: Rect = { x: 0, y: 0, width: 600, height: 400 };
    const spot = findFreeSpot({ preferred: { x: 5000, y: -5000 }, view, occupied: [] });
    expect(rectContains(view, box(spot.x, spot.y))).toBe(true);
  });

  it('returns a grid-snapped spot in view when everything is crowded', () => {
    const view: Rect = { x: 0, y: 0, width: 300, height: 200 };
    const spot = findFreeSpot({ preferred: { x: 40, y: 40 }, view, occupied: [{ x: -50, y: -50, width: 400, height: 300 }] });
    expect(spot.x % 10).toBe(0);
    expect(spot.y % 10).toBe(0);
    expect(rectContains(view, box(spot.x, spot.y))).toBe(true);
  });

  it('centres a dropped node on the drop point, snapped to the grid', () => {
    expect(centeredAt({ x: 403, y: 98 })).toEqual({ x: 300, y: 60 });
  });

  it('maps the viewport to the visible flow rectangle', () => {
    expect(visibleFlowRect({ x: 100, y: 50, zoom: 2 }, { width: 800, height: 600 })).toEqual({
      x: -50,
      y: -25,
      width: 400,
      height: 300,
    });
  });

  it('uses measured boxes where available and default sizes otherwise', () => {
    const draft = addNode(emptyDraft(), createNodeSpec('appServer', 'app-1'), { x: 300, y: 0 });
    const rects = occupiedRects(draft, { [CLIENTS_ID]: { x: 0, y: 0, width: 200, height: 60 } });
    expect(rects).toEqual([
      { x: 0, y: 0, width: 200, height: 60 },
      { x: 300, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT },
    ]);
  });
});

describe('issues', () => {
  const warning: DesignIssue = { severity: 'warning', code: 'unreachable', message: 'w', nodeId: 'app-1' };
  const errorA: DesignIssue = { severity: 'error', code: 'no_entry', message: 'first error' };
  const errorB: DesignIssue = { severity: 'error', code: 'no_targets', message: 'b', nodeId: 'app-1' };

  it('sorts errors first and keeps the validator order otherwise', () => {
    expect(sortIssues([warning, errorA, errorB])).toEqual([errorA, errorB, warning]);
  });

  it('marks nodes, with errors outranking warnings', () => {
    expect(issueMarks([warning, errorB])).toEqual({ 'app-1': 'error' });
    expect(issueMarks([warning])).toEqual({ 'app-1': 'warning' });
    expect(issueMarks([errorA])).toEqual({});
  });

  it('blocks running with the first error', () => {
    expect(runBlocker([warning, errorA, errorB])).toBe('first error');
    expect(runBlocker([warning])).toBeNull();
  });

  it('allows running level 3 reference solution', () => {
    const level = LEVELS[2]!;
    expect(runBlocker(validateDesign(level.solutions[0]!.design, level))).toBeNull();
  });
});

describe('selection', () => {
  let draft = addNode(emptyDraft(), createNodeSpec('appServer', 'app-1'), { x: 300, y: 0 });
  draft = connect(draft, { from: CLIENTS_ID, to: 'app-1' });

  it('keeps selections that still exist and drops orphaned ones', () => {
    expect(resolveSelection(draft, { kind: 'node', id: 'app-1' })).toEqual({ kind: 'node', id: 'app-1' });
    expect(resolveSelection(draft, { kind: 'node', id: CLIENTS_ID })).toEqual({ kind: 'node', id: CLIENTS_ID });
    expect(resolveSelection(draft, { kind: 'node', id: 'gone' })).toBeNull();
    expect(resolveSelection(draft, { kind: 'edge', edge: { from: CLIENTS_ID, to: 'app-1' } })).not.toBeNull();
    expect(resolveSelection(draft, { kind: 'edge', edge: { from: CLIENTS_ID, to: 'gone' } })).toBeNull();
  });

  it('never deletes the clients', () => {
    expect(isDeletable({ kind: 'node', id: CLIENTS_ID })).toBe(false);
    expect(isDeletable({ kind: 'node', id: 'app-1' })).toBe(true);
    expect(isDeletable(null)).toBe(false);
  });
});

describe('config helpers', () => {
  it('clamps to whole numbers in range', () => {
    expect(clampWhole(0, 1, 64)).toBe(1);
    expect(clampWhole(100, 1, 64)).toBe(64);
    expect(clampWhole(4.6, 1, 64)).toBe(5);
    expect(clampWhole(Number.NaN, 1, 64)).toBe(1);
  });

  it('recognises typing targets', () => {
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
