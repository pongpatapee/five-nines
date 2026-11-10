import type { ComponentKind } from '@five-nines/sim';
import type { DragEvent } from 'react';
import { COMPONENTS } from '../components/registry.ts';
import { ComponentDoodle } from '../notebook/index.ts';
import { PALETTE_DRAG_TYPE } from './config.ts';

export interface PaletteProps {
  components: readonly ComponentKind[];
  onAdd(kind: ComponentKind): void;
}

/** The components this level allows. Click to add one at its place in the flow, or drag it onto the canvas. */
export function Palette({ components, onAdd }: PaletteProps) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>, kind: ComponentKind) => {
    event.dataTransfer.setData(PALETTE_DRAG_TYPE, kind);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <section className="editor-section" aria-labelledby="palette-title">
      <h2 id="palette-title" className="editor-section__title">
        Components
      </h2>
      <ul className="palette">
        {components.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              className="palette-item"
              draggable
              onDragStart={(event) => handleDragStart(event, kind)}
              onClick={() => onAdd(kind)}
              title="Click to add, or drag onto the canvas"
            >
              <span className="palette-item__glyph" data-kind={kind} aria-hidden>
                <ComponentDoodle kind={kind} size={30} />
              </span>
              <span className="palette-item__text">
                <span className="palette-item__name">
                  {COMPONENTS[kind].label}
                  <span className="palette-item__price num">{COMPONENTS[kind].priceLabel}/mo</span>
                </span>
                <span className="palette-item__hint">{COMPONENTS[kind].hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
