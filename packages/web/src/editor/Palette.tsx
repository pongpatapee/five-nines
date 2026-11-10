import { APP_SERVER_SIZES, COMPONENT_LABELS, LOAD_BALANCER, type ComponentKind } from '@five-nines/sim';
import type { DragEvent } from 'react';
import { formatUsd } from '../format.ts';
import { COMPONENT_HINTS, PALETTE_DRAG_TYPE } from './config.ts';

export interface PaletteProps {
  components: readonly ComponentKind[];
  onAdd(kind: ComponentKind): void;
}

const PRICE_LABEL: Record<ComponentKind, string> = {
  appServer: `from ${formatUsd(APP_SERVER_SIZES.small.usdPerMonth)}`,
  loadBalancer: formatUsd(LOAD_BALANCER.usdPerMonth),
};

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
              <span className="palette-item__glyph" data-kind={kind} aria-hidden />
              <span className="palette-item__text">
                <span className="palette-item__name">
                  {COMPONENT_LABELS[kind]}
                  <span className="palette-item__price num">{PRICE_LABEL[kind]}/mo</span>
                </span>
                <span className="palette-item__hint">{COMPONENT_HINTS[kind]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
