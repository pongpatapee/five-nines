/**
 * Small ink doodles for each component kind: the palette and node headers use them. Decorative.
 *
 * `DOODLES` is the notebook's art registry, keyed like the component registry (`components/registry.ts`): adding a
 * component kind there makes TypeScript ask for its doodle here.
 */
import type { ComponentKind } from '@five-nines/sim';
import type { ReactNode } from 'react';
import { paint } from './ink.tsx';

export type DoodleKind = ComponentKind | 'clients';

const STROKE = paint(null, 'currentColor', 1.8);
/** The far copy behind a replica: a lighter line, as if sketched first. */
const STROKE_BACK = paint(null, 'currentColor', 1.4);
const FILL = paint('currentColor');

/** Each kind's drawing, in a 28 × 28 box. */
const DOODLES: Record<DoodleKind, ReactNode> = {
  // A laptop: the users on the internet.
  clients: (
    <>
      <path d="M5,6 C10,5.5 17,5.5 22,6 C22.5,10 22.5,14 22,17 C17,17.5 10,17.5 5,17 C4.6,13 4.6,9.5 5,6 Z" style={STROKE} />
      <path d="M2,21 L26,21 L23,24 L5,24 Z" style={STROKE} />
      <path d="M9,11 L12,11 M15,13 L19,13" style={STROKE} />
    </>
  ),

  // A server chassis in three-quarter view: top, side, and a front with two drive bays and a power light. Drawn as
  // a box with depth so it reads as a machine, not as a list or a menu icon.
  appServer: (
    <>
      <path d="M3.5,10.5 C9.5,10.1 15.5,10.1 21.5,10.5 L21.5,25 C15.5,25.4 9.5,25.4 3.5,25 Z" style={STROKE} />
      <path d="M3.5,10.5 L9,5 C15,4.6 20.5,4.6 26.5,5 L21.5,10.5" style={STROKE} />
      <path d="M21.5,10.5 L26.5,5 L26.5,19.8 L21.5,25" style={STROKE} />
      <path d="M6.5,13.5 L14.5,13.5 L14.5,16.5 L6.5,16.5 Z M6.5,19 L14.5,19 L14.5,22 L6.5,22 Z" style={STROKE_BACK} />
      <circle cx="18.2" cy="15" r="1.4" style={FILL} />
      <path d="M16.8,19.6 L19.6,19.6 M16.8,21.8 L19.6,21.8" style={STROKE_BACK} />
    </>
  ),

  // One line in, a box, three arrows out.
  loadBalancer: (
    <>
      <path d="M2,14 L9,14" style={STROKE} />
      <path d="M9,8 C11.5,7.6 13.5,7.6 15,8 C15.4,12 15.4,16 15,20 C13.5,20.4 11.5,20.4 9,20 C8.6,16 8.6,12 9,8 Z" style={STROKE} />
      <path d="M15,11 C19,8 21,5 25,4.5 M15,14 L25,14 M15,17 C19,20 21,23 25,23.5" style={STROKE} />
      <path d="M22.5,2.5 L25.5,4.5 L23,7 M22.5,11.5 L25.5,14 L22.5,16.5 M23,21 L25.5,23.5 L22.5,25.5" style={STROKE} />
    </>
  ),

  // A memory stick with a lightning bolt: fast, and forgetful.
  cache: (
    <>
      <path d="M3,8 C10,7.4 18,7.4 25,8 C25.3,11.4 25.3,14.6 25,18 C18,18.5 10,18.5 3,18 C2.7,14.6 2.7,11.4 3,8 Z" style={STROKE} />
      <path d="M6.5,18.4 L6.4,22 M10.5,18.5 L10.6,22 M14,18.5 L14,22 M17.5,18.5 L17.4,22 M21.5,18.4 L21.6,22" style={STROKE} />
      <path d="M15.6,9.4 L10.6,13.8 L13.8,13.8 L12.4,17.2 L17.6,12.3 L14.3,12.3 Z" style={FILL} />
    </>
  ),

  // The classic cylinder, banded once.
  database: (
    <>
      <path d="M6,6.8 C6,4.3 22,4.2 22,6.8 C22,9.3 6,9.4 6,6.8 Z" style={STROKE} />
      <path d="M6,6.8 C5.8,11.5 5.9,16.5 6.1,21.2 C6.6,24 21.4,24.1 21.9,21.2 C22.2,16.5 22.1,11.5 22,6.8" style={STROKE} />
      <path d="M6,14 C6.6,16.7 21.4,16.8 22,14" style={STROKE} />
    </>
  ),

  // Two cylinders: a copy peeking out behind the front one.
  readReplicas: (
    <>
      <path d="M11,4.6 C11,2.4 25,2.3 25,4.6 C25,6.8 11,6.9 11,4.6 Z" style={STROKE_BACK} />
      <path d="M11,4.6 L11.1,9 M25,4.6 C25.2,8.7 25.1,13 25,17 C24.8,18.9 21,19.6 17.4,19.6" style={STROKE_BACK} />
      <path d="M3,11.6 C3,9.2 17,9.1 17,11.6 C17,14 3,14.1 3,11.6 Z" style={STROKE} />
      <path d="M3,11.6 C2.8,15.4 2.9,19.4 3.1,23 C3.5,25.6 16.6,25.7 16.9,23 C17.2,19.4 17.1,15.4 17,11.6" style={STROKE} />
      <path d="M3.1,17.4 C3.6,19.8 16.5,19.9 17,17.4" style={STROKE} />
    </>
  ),
};

export function ComponentDoodle({ kind, size = 24 }: { kind: DoodleKind; size?: number }) {
  return (
    <svg className="component-doodle" width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <g strokeLinejoin="round" strokeLinecap="round">
        {DOODLES[kind]}
      </g>
    </svg>
  );
}
