import * as React from 'react';
import { cn } from '@/lib/utils';

/** "You": this one is taken by whoever is signed in. */
export function MineTag({ className }: { className?: string }) {
  return (
    <span
      aria-label="Taken by you"
      className={cn('inline-flex rounded-full border border-primary/50 px-1.5 py-0.5 text-2xs font-bold leading-none text-primary', className)}
    >
      You
    </span>
  );
}
