'use client';

/**
 * History (designer v2): every step the undo stack holds, newest first, each named by what it changed. Tap one to go
 * back (or forward) to how the design was then; nothing is lost until something new is done after going back.
 */

import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeChange } from '@/lib/social/guides';
import type { Editor } from '../story-editor';

export function HistoryPanel({ ed }: { ed: Editor }) {
  const { past, future, goto } = ed.api;
  // Every state the design has been in, oldest first: the stack, now, and what a redo would bring back.
  const states = useMemo(() => [...past, ed.doc, ...[...future].reverse()], [past.length, future.length, ed.doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = past.length;
  const steps = useMemo(() => states.slice(1).map((s, i) => ({ label: describeChange(states[i], s), state: i + 1 })), [states]);
  if (!steps.length) return <p className="text-sm text-muted-foreground">Nothing yet. Every change you make is listed here, and you can step back to any of them.</p>;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">Newest at the top. Tap a step to see the design as it was then.</p>
      <ol className="space-y-1">
        {[...steps].reverse().map(s => {
          const here = s.state === now, ahead = s.state > now;
          return (
            <li key={s.state}>
              <button type="button" onClick={() => goto(s.state - now)}
                className={cn('flex min-h-0 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm [@media(pointer:coarse)]:py-3', here ? 'border-primary bg-primary/5' : 'hover:bg-muted', ahead && 'opacity-50')}>
                <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{s.state}</span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {here && <Check className="h-4 w-4 shrink-0 text-primary" />}
                {ahead && <span className="shrink-0 text-[10px] text-muted-foreground">undone</span>}
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={() => goto(-now)} className={cn('flex min-h-0 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm [@media(pointer:coarse)]:py-3', now === 0 ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
            <span className="w-6 shrink-0" /><span className="flex-1">How it started</span>{now === 0 && <Check className="h-4 w-4 text-primary" />}
          </button>
        </li>
      </ol>
    </div>
  );
}
