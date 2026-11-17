/**
 * Ink doodles for each component kind, game-icon style: the outline of the thing itself (a drum of disks, a rack
 * tower, a chip struck by lightning, a fork, a conveyor of envelopes, a person with a phone), inked and washed with
 * token colours. The palette, the inspector and the canvas nodes use them. Decorative.
 *
 * `DOODLES` is the notebook's art registry, keyed like the component registry (`components/registry.ts`): adding a
 * component kind there makes TypeScript ask for its doodle here.
 */
import type { ComponentKind } from '@five-nines/sim';
import type { ReactNode } from 'react';
import { paint } from './ink.tsx';

export type DoodleKind = ComponentKind | 'clients';

const STROKE = paint(null, 'currentColor', 1.8);
/** Detail lines and far copies: a lighter line, as if sketched first. */
const STROKE_BACK = paint(null, 'currentColor', 1.3);
const FILL = paint('currentColor');

/** A shape inked and washed with a highlighter or watercolour token, the way the notebook colours its doodles in. */
const washed = (token: string, strokeWidth = 1.8) => paint(`var(${token})`, 'currentColor', strokeWidth);
/** A wash with no outline, under strokes drawn separately. */
const wash = (token: string) => paint(`var(${token})`);
/** Card stock inside a drawing: blank paper that hides what's behind it. */
const PAPER = washed('--paper-card');

/**
 * A drum (the database cylinder): its lid's centre line at `top`, `width` wide from `x`, `height` from lid to base.
 * The sides wobble a little, as drawn by hand.
 */
function drum(x: number, top: number, width: number, height: number, body: string, back = false): ReactNode {
  const right = x + width;
  const bottom = top + height;
  const rim = Math.max(1.6, width * 0.16);
  const line = back ? STROKE_BACK : STROKE;
  return (
    <>
      <path
        d={`M${x},${top} L${right},${top} L${right},${bottom} C${right},${bottom + rim} ${x},${bottom + rim} ${x},${bottom} Z`}
        style={wash(body)}
      />
      <path
        d={`M${x},${top} C${x - 0.2},${top + height * 0.4} ${x - 0.1},${top + height * 0.75} ${x + 0.1},${bottom} C${x + 0.6},${bottom + rim * 1.05} ${right - 0.6},${bottom + rim * 1.1} ${right - 0.1},${bottom} C${right + 0.2},${top + height * 0.75} ${right + 0.1},${top + height * 0.4} ${right},${top}`}
        style={line}
      />
      <path
        d={`M${x},${top} C${x},${top - rim} ${right},${top - rim - 0.1} ${right},${top} C${right},${top + rim} ${x},${top + rim + 0.1} ${x},${top} Z`}
        style={{ ...wash('--paper-card'), ...line }}
      />
    </>
  );
}

/** Each kind's drawing, in a 28 × 28 box: the outline of the thing itself, inked, with a wash of colour. */
const DOODLES: Record<DoodleKind, ReactNode> = {
  // A person and a phone: the users out on the internet.
  clients: (
    <>
      <path d="M2.6,25 C2.4,19 5.4,15.6 9.4,15.6 C13.4,15.6 16.4,19 16.2,25 Z" style={washed('--wash-yellow')} />
      <circle cx="9.4" cy="9" r="4" style={washed('--wash-peach')} />
      <path
        d="M18.8,6.6 L24.6,6.7 C25.5,6.7 25.9,7.2 25.9,8 L25.8,22.4 C25.8,23.2 25.3,23.6 24.5,23.6 L18.9,23.5 C18.1,23.5 17.6,23 17.6,22.2 L17.7,7.9 C17.7,7.1 18.1,6.6 18.8,6.6 Z"
        style={PAPER}
      />
      <path d="M19.2,9.2 L24.3,9.2 L24.3,19.6 L19.2,19.6 Z" style={washed('--wash-blue', 1.3)} />
      <circle cx="21.75" cy="21.6" r="0.9" style={FILL} />
    </>
  ),

  // A tower of three rack units, each with drive bays and a status light.
  appServer: (
    <>
      <path d="M8,24.6 L8,26.6 M20,24.6 L20,26.6" style={STROKE} />
      <path
        d="M5,3 C11,2.6 17,2.6 23,3 C23.3,10 23.3,17.5 23,24.6 C17,25 11,25 5,24.6 C4.7,17.5 4.7,10 5,3 Z"
        style={washed('--wash-blue')}
      />
      <path d="M5,10.2 C11,10.5 17,10.5 23,10.2 M5,17.4 C11,17.7 17,17.7 23,17.4" style={STROKE} />
      <path
        d="M7.8,5.1 L7.8,8.1 M10.2,5.1 L10.2,8.1 M12.6,5.1 L12.6,8.1 M7.8,12.3 L7.8,15.3 M10.2,12.3 L10.2,15.3 M12.6,12.3 L12.6,15.3 M7.8,19.5 L7.8,22.5 M10.2,19.5 L10.2,22.5 M12.6,19.5 L12.6,22.5"
        style={STROKE_BACK}
      />
      <circle cx="19.4" cy="6.6" r="1.5" style={paint('var(--green-pen)')} />
      <circle cx="19.4" cy="13.8" r="1.5" style={paint('var(--green-pen)')} />
      <circle cx="19.4" cy="21" r="1.5" style={paint('var(--amber-pen)')} />
    </>
  ),

  // A fork in the road: one line in, a hub, three arrows fanning out.
  loadBalancer: (
    <>
      <path d="M1.8,14 L7.4,14" style={STROKE} />
      <path d="M14.2,12.2 C17.4,9.2 19.6,6.4 24.6,5.8 M14.8,14 L24.6,14 M14.2,15.8 C17.4,18.8 19.6,21.6 24.6,22.2" style={STROKE} />
      <path d="M22.2,3.6 L25.3,5.8 L22.6,8.3 M22.2,11.5 L25.1,14 L22.2,16.5 M22.6,19.7 L25.3,22.2 L22.2,24.4" style={STROKE} />
      <circle cx="11" cy="14" r="3.9" style={washed('--highlighter')} />
    </>
  ),

  // A memory chip struck by a lightning bolt: fast, and forgetful.
  cache: (
    <>
      <path d="M2.8,9 L6.4,9 M2.8,14 L6.4,14 M2.8,19 L6.4,19 M21.6,9 L25.2,9 M21.6,14 L25.2,14 M21.6,19 L25.2,19" style={STROKE} />
      <path
        d="M6.5,5 C11.5,4.7 16.5,4.7 21.5,5 C21.8,11 21.8,17 21.5,23 C16.5,23.3 11.5,23.3 6.5,23 C6.2,17 6.2,11 6.5,5 Z"
        style={washed('--wash-pink')}
      />
      <path d="M16.4,6.6 L9.8,15.2 L13.6,15.2 L11.8,21.6 L18.4,12.6 L14.6,12.6 Z" style={washed('--highlighter', 1.4)} />
    </>
  ),

  // A stack of disks: the classic database drum, banded.
  database: (
    <>
      {drum(5.5, 6.5, 17, 15.6, '--wash-blue')}
      <path d="M5.5,11.8 C6.2,14.6 21.8,14.7 22.5,11.8 M5.5,17 C6.2,19.8 21.8,19.9 22.5,17" style={STROKE} />
    </>
  ),

  // Two drums: a copy peeking out behind the primary.
  readReplicas: (
    <>
      {drum(11, 5, 14, 12, '--paper-card', true)}
      {drum(3, 12, 14, 11.4, '--wash-blue')}
      <path d="M3,17.6 C3.6,20 16.4,20.1 17,17.6" style={STROKE} />
    </>
  ),

  // Three short drums side by side: one database cut into pieces.
  shards: (
    <>
      {drum(1.8, 10, 7.6, 12, '--wash-blue')}
      {drum(10.2, 6.5, 7.6, 12, '--wash-green')}
      {drum(18.6, 11, 7.6, 12, '--wash-peach')}
    </>
  ),

  // A conveyor belt carrying envelopes, moving to the right.
  queue: (
    <>
      <path d="M12,5.4 L20,5.4 M17.8,3.2 L20.3,5.4 L17.8,7.6" style={STROKE_BACK} />
      <path
        d="M3.6,10.4 L9.8,10.4 L9.8,16.4 L3.6,16.4 Z M11,10.2 L17.2,10.2 L17.2,16.4 L11,16.4 Z M18.4,10.4 L24.6,10.4 L24.6,16.4 L18.4,16.4 Z"
        style={washed('--wash-yellow')}
      />
      <path d="M3.6,10.4 L6.7,13.2 L9.8,10.4 M11,10.2 L14.1,13 L17.2,10.2 M18.4,10.4 L21.5,13.2 L24.6,10.4" style={STROKE_BACK} />
      <path
        d="M3.6,17.8 C10,17.4 18,17.4 24.4,17.8 C26.8,18 26.8,24 24.4,24.2 C18,24.6 10,24.6 3.6,24.2 C1.2,24 1.2,18 3.6,17.8 Z"
        style={PAPER}
      />
      <circle cx="5" cy="21" r="1.5" style={STROKE_BACK} />
      <circle cx="10.6" cy="21" r="1.5" style={STROKE_BACK} />
      <circle cx="16.2" cy="21" r="1.5" style={STROKE_BACK} />
      <circle cx="21.8" cy="21" r="1.5" style={STROKE_BACK} />
    </>
  ),

  // A bank card: a magnetic stripe, a gold chip and the card number.
  paymentProvider: (
    <>
      <path
        d="M2.5,6.6 C10,6.1 18,6.1 25.5,6.6 C25.9,11.3 25.9,16.7 25.5,21.4 C18,21.9 10,21.9 2.5,21.4 C2.1,16.7 2.1,11.3 2.5,6.6 Z"
        style={washed('--wash-green')}
      />
      <path d="M2.3,9.4 L25.7,9.4 L25.7,12.2 L2.3,12.2 Z" style={FILL} />
      <path d="M5.4,14.4 L10.2,14.4 L10.2,18.2 L5.4,18.2 Z" style={washed('--star-gold', 1.3)} />
      <path d="M13.6,17.6 L22.6,17.6" style={STROKE} />
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
