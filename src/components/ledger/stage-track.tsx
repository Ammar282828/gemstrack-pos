import * as React from 'react';
import { cn } from '@/lib/utils';
import { STAGES, stageIndex, type Stage } from './helpers';

export interface StageTrackProps {
  /** Current step: 0-3 or its name (Booked, Making, Ready, Invoiced). */
  stage: Stage | number | string;
  labels?: readonly string[];
  className?: string;
}

/** Four capsule bars, filled up to and including the current step; labels beneath. Order detail only. */
export function StageTrack({ stage, labels = STAGES, className }: StageTrackProps) {
  const current = stageIndex(stage, labels);
  return (
    <div
      role="img"
      aria-label={`Stage ${current + 1} of ${labels.length}: ${labels[current]}`}
      className={cn('w-full', className)}
    >
      <div className="flex gap-1.5">
        {labels.map((l, i) => (
          <div key={l} className={cn('h-[5px] flex-1 rounded-full', i <= current ? 'bg-primary' : 'bg-muted-foreground/[.18]')} />
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {labels.map((l, i) => (
          <div key={l} aria-hidden className={cn('flex-1 truncate text-2xs', i === current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
