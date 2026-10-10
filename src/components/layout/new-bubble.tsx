"use client";

/**
 * Home's New: a floating "New" beside the microphone that opens onto the two things a sale starts as,
 * an invoice (selling a piece now) or an order (making or ordering one). The owner, 2026-10-10: "there
 * should be a new order/invoice button bubble on the home screen". The sidebar's New sale still leads
 * to /new and its other ways in (scan a tag, read a bill, a repair).
 *
 * Beside the microphone rather than under it: the microphone sits clear of the bottom of a phone's
 * screen (voice-bubble.tsx), and a second disc below it would have met the home indicator.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Receipt, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

const CHOICES = [
  { href: '/invoices/new', label: 'New invoice', hint: 'Selling a piece now', icon: Receipt },
  { href: '/orders/add', label: 'New order', hint: 'Making or ordering a piece', icon: ClipboardList },
] as const;

export function NewBubble() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-background/50 backdrop-blur-[2px] animate-in fade-in-0 duration-200"
        />
      )}
      <div className="fixed bottom-20 right-[5.25rem] z-50 flex flex-col items-end gap-2 md:bottom-6">
        {open && (
          <div
            role="menu"
            aria-label="Start"
            className="glass w-64 origin-bottom-right overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 ease-enter"
          >
            {CHOICES.map(c => (
              <Link
                key={c.href}
                href={c.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <c.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="glass-prominent flex h-14 items-center gap-2 rounded-full bg-primary pl-4 pr-5 font-medium text-primary-foreground shadow-lg transition-transform duration-200 ease-enter active:scale-95"
        >
          <Plus className={cn('h-5 w-5 transition-transform duration-200 ease-enter', open && 'rotate-45')} />
          New
        </button>
      </div>
    </>
  );
}
