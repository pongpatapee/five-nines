/**
 * Hash routing: `#/` is level select, `#/level/<id>` is a level. Hash routes work on any static host without
 * server rewrites.
 */
import { useSyncExternalStore } from 'react';

export type Route = { name: 'levels' } | { name: 'level'; levelId: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const match = /^\/level\/([^/?#]+)\/?$/.exec(path);
  if (match) return { name: 'level', levelId: decodeURIComponent(match[1]!) };
  return { name: 'levels' };
}

export function routeHref(route: Route): string {
  return route.name === 'level' ? `#/level/${encodeURIComponent(route.levelId)}` : '#/';
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;

/** The current route, re-rendering on hash changes. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  return parseHash(hash);
}
