"use client";

/**
 * The search-and-filter row that sits above every list.
 *
 * It was hand-rolled on each page and had drifted into four different shapes:
 * a card with a three-column grid, a card with a flex row, a bare div with no
 * card at all, and a card with different padding again. Same control, four
 * layouts, four sets of breakpoints. This is the one shape.
 *
 *   <FilterBar value={q} onChange={setQ} placeholder="Search orders…">
 *     <Select …/>
 *     <Select …/>
 *   </FilterBar>
 *
 * On a phone the filters are folded away behind a button. The controls are
 * set to h-9, but the touch rule in globals.css gives every button a 44px
 * minimum, so three selects and a group toggle came to roughly two hundred
 * pixels of chrome above a list you had to scroll to reach. Shrinking the
 * controls would have been the wrong fix — they are that size because this is
 * used one-handed in a shop. Folding them costs one tap on the rare occasion
 * they are wanted, and gives the list the space the rest of the time.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export const FilterBar: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Selects and toggles. Folded away on a phone, inline from sm. */
  children?: React.ReactNode;
  /** Buttons pinned to the end of the row (export, view toggles, grouping).
   *  Always visible: these are actions, not filters. */
  actions?: React.ReactNode;
  /** Extra content below the row — active-filter chips, summaries. */
  footer?: React.ReactNode;
  /**
   * How many filters are set to something other than their default. Shown on
   * the phone toggle so a folded filter can never be silently narrowing the
   * list — the commonest failure of a pattern like this.
   */
  activeCount?: number;
  className?: string;
}> = ({ value, onChange, placeholder = 'Search…', children, actions, footer, activeCount = 0, className }) => {
  const [open, setOpen] = React.useState(false);
  // Only `children` folds, so a page that passes just `actions` must not get a
  // toggle that opens nothing.
  const hasControls = Boolean(children);

  return (
    <Card className={cn('mb-3', className)}>
      <CardContent className="p-2 sm:p-2.5 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                className="h-9 pl-8 pr-8"
                placeholder={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                aria-label={placeholder}
              />
              {value && (
                <Button
                  type="button" variant="ghost" size="icon"
                  className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                  onClick={() => onChange('')} aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {hasControls && (
              <Button
                type="button"
                variant={activeCount > 0 ? 'default' : 'outline'}
                size="sm"
                className="sm:hidden flex-shrink-0 gap-1.5 px-2.5"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {activeCount > 0 && <span className="text-xs tabular-nums">{activeCount}</span>}
                <span className="sr-only">{open ? 'Hide filters' : 'Show filters'}</span>
              </Button>
            )}
          </div>

          {/* `sm:contents` dissolves this wrapper above the breakpoint so the
              filters rejoin the parent flex row instead of staying a 2-up grid.
              Below it, `hidden` folds them away until asked for. */}
          {children && (
            <div className={cn(
              'grid grid-cols-2 gap-2 sm:contents [&_button]:h-9 [&_[role=combobox]]:h-9',
              !open && 'hidden sm:contents',
            )}>
              {children}
            </div>
          )}

          {/* Never folded. Two pages put an Export button in here, and one
              hidden behind a control labelled "filters" is a button nobody
              finds. Only `children` — which is always selects — folds. */}
          {actions && <div className="flex gap-2 flex-shrink-0 [&_button]:h-9">{actions}</div>}
        </div>
        {footer}
      </CardContent>
    </Card>
  );
};
