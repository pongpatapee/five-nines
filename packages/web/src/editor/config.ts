/** Inspector options and the small rules behind them. */
import type { ComponentKind } from '@five-nines/sim';

export const MIN_INSTANCES = 1;
export const MAX_INSTANCES = 64;

/** The health-check intervals the inspector offers, in seconds. */
export const HEALTH_CHECK_INTERVALS = [5, 10, 30, 60] as const;

/** Rounds a typed or stepped value to a whole number in [min, max]. Non-finite values become `min`. */
export function clampWhole(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** One-line palette hints. */
export const COMPONENT_HINTS: Record<ComponentKind, string> = {
  appServer: 'Runs your code. Choose a size and how many instances.',
  loadBalancer: 'Spreads requests across app server instances.',
};

/** The MIME type used to drag a palette item onto the canvas. */
export const PALETTE_DRAG_TYPE = 'application/x-five-nines-component';

/** Whether a key event comes from somewhere the player is typing, so single-key shortcuts must not fire. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
