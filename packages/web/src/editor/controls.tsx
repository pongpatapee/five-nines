/** Small form controls for the inspector, styled in `editor.css`. */
import { useId, useState, type ReactNode } from 'react';
import { clampWhole } from './config.ts';

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  /** Secondary line under the label, e.g. vCPU and price. */
  detail?: ReactNode;
}

export interface SegmentedControlProps<T> {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
}

/** A row of mutually exclusive choices (a radio group). */
export function SegmentedControl<T extends string | number>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="segmented__option"
          onClick={() => onChange(option.value)}
        >
          <span className="segmented__label">{option.label}</span>
          {option.detail !== undefined && <span className="segmented__detail">{option.detail}</span>}
        </button>
      ))}
    </div>
  );
}

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Receives values already clamped to [min, max]. */
  onChange(value: number): void;
}

/** − [number] + for whole numbers. Typing commits as soon as the text is a valid number. */
export function Stepper({ label, value, min, max, onChange }: StepperProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  // Follow outside changes (buttons, undo, another node) without clobbering what the player is typing.
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }

  const commit = (next: number) => onChange(clampWhole(next, min, max));

  return (
    <div className="stepper">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <button
        type="button"
        className="stepper__button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => commit(value - 1)}
      >
        −
      </button>
      <input
        id={id}
        className="stepper__input num"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(parsed)) commit(parsed);
        }}
        onBlur={() => setText(String(value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className="stepper__button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => commit(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

/** An on/off switch with its label. */
export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__label">{label}</span>
      <span className="toggle__state">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}
