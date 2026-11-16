/**
 * Esc for stacked overlays: only the topmost open overlay hears it. The napkin card, the field guide opened from it,
 * the hints and the solution can be open together, and one press should close one of them, the one on top.
 */
import { useEffect, useRef, useState } from 'react';

const stack: { current: () => void }[] = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || stack.length === 0) return;
  event.preventDefault();
  stack[stack.length - 1]!.current();
}

/** Calls `onEscape` when Esc is pressed while this is the topmost overlay that asked. Off while `active` is false. */
export function useEscape(onEscape: () => void, active = true): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const entry = { get current() { return handler.current; } };
    if (stack.length === 0) window.addEventListener('keydown', onKeyDown);
    stack.push(entry);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
}

/**
 * Focus for an overlay: when it opens, remember what had the focus; when it closes, give it back, so a keyboard
 * player lands where they were.
 */
export function useRestoreFocus(): void {
  // Read while rendering, before this overlay's own effects move the focus into it.
  const [previous] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(
    () => () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    },
    [previous],
  );
}
