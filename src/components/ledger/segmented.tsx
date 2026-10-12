"use client";

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
}

export interface SegmentedProps<T extends string = string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name, e.g. "Show by". */
  label?: string;
  className?: string;
}

/** The system segmented picker: capsule track, selected segment lifts onto the card colour. */
export function Segmented<T extends string = string>({ value, options, onChange, label, className }: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number) => {
    const n = options.length;
    const to = (from + step + n) % n;
    onChange(options[to].value);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex h-9 items-stretch gap-0.5 rounded-full bg-muted p-[3px]', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            }}
            className={cn(
              'min-w-0 flex-1 whitespace-nowrap rounded-full px-3 text-ios-sub transition-colors duration-150 ease-exit motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              on ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
