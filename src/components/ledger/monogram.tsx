import * as React from 'react';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { initials, isWalkIn } from './helpers';

export interface MonogramProps {
  name: string | null | undefined;
  size?: number;
  className?: string;
}

/** A person as a circle of initials (serif, accent); a walk-in is a person glyph. Decorative: the name sits beside it. */
export function Monogram({ name, size = 40, className }: MonogramProps) {
  const walkIn = isWalkIn(name);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/[.13] text-primary', className)}
      style={{ width: size, height: size }}
    >
      {walkIn ? (
        <User className="opacity-80" style={{ width: size * 0.45, height: size * 0.45 }} />
      ) : (
        <span className="font-serif font-semibold leading-none" style={{ fontSize: size * 0.38 }}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}
