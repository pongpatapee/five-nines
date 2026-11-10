import { CLIENTS_ID } from '@five-nines/sim';
import { sameEdge } from '../canvas/draft.ts';
import type { CanvasSelection, Draft } from '../canvas/types.ts';

/** The selection if it still points at something in the draft (deletes and resets can orphan it), else null. */
export function resolveSelection(draft: Draft, selection: CanvasSelection | null): CanvasSelection | null {
  if (!selection) return null;
  if (selection.kind === 'node') {
    const exists = selection.id === CLIENTS_ID || draft.design.nodes.some((node) => node.id === selection.id);
    return exists ? selection : null;
  }
  return draft.design.edges.some((edge) => sameEdge(edge, selection.edge)) ? selection : null;
}

/** Whether the selection can be deleted: anything but the clients node. */
export function isDeletable(selection: CanvasSelection | null): boolean {
  return selection !== null && !(selection.kind === 'node' && selection.id === CLIENTS_ID);
}
