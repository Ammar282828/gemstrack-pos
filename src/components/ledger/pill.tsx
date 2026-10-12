import * as React from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tone';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: React.ReactNode;
}

/** A status in a word: tinted capsule, tone ink. One at most per card. */
export function Pill({ tone = 'quiet', icon, className, children, ...rest }: PillProps) {
  const t = toneClasses(tone);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[3px] text-ios-cap font-semibold tabular-nums',
        t.ink, t.tint, className,
      )}
      {...rest}
    >
      {icon ? <span aria-hidden className="inline-flex shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span> : null}
      {children}
    </span>
  );
}
