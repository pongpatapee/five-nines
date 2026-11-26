/**
 * The way on from a page the player passes through (the title page, an all-hands): Enter takes it from anywhere on
 * the page, and Esc too where the page is skippable. A focused button or link keeps its own Enter.
 */
import { useEffect, useRef } from 'react';

export function useWayOnKeys(go: () => void, { escape }: { escape: boolean }): void {
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const onControl = event.target instanceof HTMLElement && event.target.closest('a, button, input, textarea, select') !== null;
      if ((escape && event.key === 'Escape') || (event.key === 'Enter' && !onControl)) {
        event.preventDefault();
        goRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [escape]);
}
