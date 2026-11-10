/** Small ink doodles for each component kind: the palette, node headers and the debrief use them. Decorative. */
import type { ComponentKind } from '@five-nines/sim';
import { paint } from './ink.tsx';

export type DoodleKind = ComponentKind | 'clients';

const STROKE = paint(null, 'currentColor', 1.8);

export function ComponentDoodle({ kind, size = 24 }: { kind: DoodleKind; size?: number }) {
  return (
    <svg className="component-doodle" width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      {kind === 'clients' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M5,6 C10,5.5 17,5.5 22,6 C22.5,10 22.5,14 22,17 C17,17.5 10,17.5 5,17 C4.6,13 4.6,9.5 5,6 Z" style={STROKE} />
          <path d="M2,21 L26,21 L23,24 L5,24 Z" style={STROKE} />
          <path d="M9,11 L12,11 M15,13 L19,13" style={STROKE} />
        </g>
      )}
      {kind === 'appServer' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M5,3.5 C11,3 17,3 23,3.5 L23,10 C17,10.4 11,10.4 5,10 Z" style={STROKE} />
          <path d="M5,11 C11,10.6 17,10.6 23,11 L23,17.5 C17,17.9 11,17.9 5,17.5 Z" style={STROKE} />
          <path d="M5,18.5 C11,18.2 17,18.2 23,18.5 L23,25 C17,25.4 11,25.4 5,25 Z" style={STROKE} />
          <circle cx="9" cy="6.8" r="1.3" style={paint('currentColor')} />
          <circle cx="9" cy="14.2" r="1.3" style={paint('currentColor')} />
          <circle cx="9" cy="21.7" r="1.3" style={paint('currentColor')} />
          <path d="M14,6.8 L19.5,6.8 M14,14.2 L19.5,14.2 M14,21.7 L19.5,21.7" style={STROKE} />
        </g>
      )}
      {kind === 'loadBalancer' && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M2,14 L9,14" style={STROKE} />
          <path d="M9,8 C11.5,7.6 13.5,7.6 15,8 C15.4,12 15.4,16 15,20 C13.5,20.4 11.5,20.4 9,20 C8.6,16 8.6,12 9,8 Z" style={STROKE} />
          <path d="M15,11 C19,8 21,5 25,4.5 M15,14 L25,14 M15,17 C19,20 21,23 25,23.5" style={STROKE} />
          <path d="M22.5,2.5 L25.5,4.5 L23,7 M22.5,11.5 L25.5,14 L22.5,16.5 M23,21 L25.5,23.5 L22.5,25.5" style={STROKE} />
        </g>
      )}
    </svg>
  );
}
