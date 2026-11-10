import { useId, type ReactNode } from 'react';
import { NotebookDefs } from './ink.tsx';
import './notebook.css';

/** The spiral binding down the left edge of every page. Decorative. */
export function SpiralBinding() {
  const id = useId();
  return (
    <svg className="spiral-binding" aria-hidden focusable="false">
      <defs>
        <pattern id={id} width="44" height="36" patternUnits="userSpaceOnUse">
          <circle cx="32" cy="18" r="5" style={{ fill: 'var(--spiral-hole)' }} />
          <path
            d="M32,18 C22,6 6,7 5,16 C4,25 13,29 20,26"
            style={{ fill: 'none', stroke: 'var(--spiral-wire)', strokeWidth: 3.5, strokeLinecap: 'round' }}
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width="14" height="100%" style={{ fill: 'var(--spiral-spine)' }} />
      <rect x="0" y="0" width="100%" height="100%" style={{ fill: `url(#${id})` }} />
    </svg>
  );
}

/** Every screen is a page in the notebook: spiral binding on the left, graph paper behind. */
export function NotebookShell({ children }: { children: ReactNode }) {
  return (
    <div className="notebook graph-paper">
      <NotebookDefs />
      <SpiralBinding />
      <div className="notebook__page">{children}</div>
    </div>
  );
}
