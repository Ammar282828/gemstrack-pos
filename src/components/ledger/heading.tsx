import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Tone } from '@/lib/tones';

export interface LedgerHeadingProps {
  title: string;
  count?: number | string;
  trailing?: React.ReactNode;
  /** `late` turns the title red. */
  tone?: Tone;
  /** Heading level, default h2. */
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
  id?: string;
}

export function LedgerHeading({ title, count, trailing, tone, as: Tag = 'h2', className, id }: LedgerHeadingProps) {
  return (
    <div className={cn('flex items-baseline gap-2 px-1', className)}>
      {/* The title keeps its width and the count gives way: a long count ("267 · bought in the last 12
          months") squeezed the title to "Rec…" and wrapped itself onto two lines. */}
      <Tag id={id} className={cn('min-w-0 max-w-[75%] shrink-0 truncate font-serif text-ios-title3 font-semibold', tone === 'late' ? 'text-tone-late-ink' : 'text-foreground')}>
        {title}
      </Tag>
      {count !== undefined && count !== '' ? <span className="min-w-0 truncate text-ios-sub tabular-nums text-muted-foreground">{count}</span> : null}
      {trailing ? <span className="ml-auto shrink-0 text-ios-sub font-medium tabular-nums text-muted-foreground">{trailing}</span> : null}
    </div>
  );
}
