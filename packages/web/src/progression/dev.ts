/**
 * The developer escape hatch: `?unlock=all` in the address (before the `#`, e.g. `/?unlock=all#/level/08-thundering-herd`)
 * opens every level, so testing never needs a save that has played through. It changes nothing that's saved: drop the
 * parameter and the real progression is back.
 */
export function devUnlockAll(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).getAll('unlock').includes('all');
}
