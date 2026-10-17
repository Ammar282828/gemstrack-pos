'use client';

/** The keyboard cheat-sheet: press ? in the designer, or choose it from View. */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: 'Edit', rows: [
    ['⌘Z', 'Undo'], ['⇧⌘Z or ⌘Y', 'Redo'], ['⌘C  ⌘X  ⌘V', 'Copy, cut, paste'], ['⌘D', 'Duplicate'], ['⌘A', 'Select everything'],
    ['⌘⌥C', 'Copy the style'], ['⌘⌥V', 'Paste the style'], ['⌫ or Delete', 'Delete'], ['Enter', 'Type in the selected words'], ['Esc', 'Deselect, or close'],
  ] },
  { title: 'Arrange', rows: [
    ['Tab  ⇧Tab', 'Select the next, or the previous, layer'], ['Arrows', 'Nudge 2 px (⇧ for 20)'], ['⌘]  ⌘[', 'Forward, backward'], ['⌥⌘]  ⌥⌘[', 'To front, to back'],
    ['⌘G  ⇧⌘G', 'Group, ungroup'], ['⌥⇧L', 'Lock or unlock'], ['Shift-click', 'Add to the selection'],
  ] },
  { title: 'View', rows: [
    ['⌘ +', 'Zoom in'], ['⌘ −', 'Zoom out'], ['⌘ 0', 'Fit the page'], ['⌘ scroll or pinch', 'Zoom'], ['?', 'This list'],
  ] },
  { title: 'On the page', rows: [
    ['Double-click words', 'Type'], ['Double-click a photo', 'Move the photo inside its frame'], ['Drag from a ruler', 'Pull out a guide'],
    ['Drag a guide off the page', 'Remove it'], ['Right-click or long-press', 'More'],
  ] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return createPortal(
    <div className="glass-overlay fixed inset-0 z-[65] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Keyboard shortcuts" className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-base font-semibold">Keyboard shortcuts</p>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-5 overflow-y-auto px-4 py-4 sm:grid-cols-2">
          {GROUPS.map(g => (
            <section key={g.title} className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h3>
              <dl className="space-y-1">
                {g.rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
                    <dt className="text-muted-foreground">{v}</dt>
                    <dd><kbd className="whitespace-nowrap rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="text-[11px] text-muted-foreground sm:col-span-2">On Windows and Linux, ⌘ is Ctrl and ⌥ is Alt.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
