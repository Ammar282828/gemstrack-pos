"use client";

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Capsule search: magnifier, clear button, Escape clears. Text stays 16px so iOS does not zoom. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, placeholder = 'Search', label, className, autoFocus }, ref,
) {
  return (
    <div role="search" className={cn('relative flex h-11 items-center rounded-full bg-muted focus-within:ring-2 focus-within:ring-primary/40', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoFocus={autoFocus}
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }}
        className="h-full w-full bg-transparent pl-10 pr-10 text-base outline-none placeholder:text-muted-foreground md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
});
