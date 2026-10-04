"use client";

/**
 * Photos → From the website: any piece already on the house's site, brought into Post a Piece
 * to be fixed up and posted like a photo from the phone (owner, 2026-09-29: "for post a piece let
 * me add any pic from the website and then fix it up there").
 *
 * The same list as the Posts hub (/api/website/site-pieces), opened on New arrivals,
 * newest first; search, collections, several at once. The page fetches each chosen photograph
 * through the ERP (lib/website/site-photo.ts says which).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Loader2, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { byNewest } from '@/lib/website/new-arrivals';
import type { SitePieceLike } from '@/lib/website/site-photo';

export interface SitePick extends SitePieceLike {
  thumb: string;
  collection: string;
  weightGrams: number | null;
  facts: string[];
  added: number | null;
  newArrival: boolean;
  hidden?: boolean;
}

const NEW = '__new__';
const PAGE = 60;
/** Enough for one post; the photo row and the AI both slow down past it. */
const MAX = 10;

export function SitePicker({ open, onOpenChange, siteName, headers, onAdd }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  siteName: string;
  headers: () => Promise<Record<string, string>>;
  onAdd: (pieces: SitePick[]) => void;
}) {
  const [pieces, setPieces] = useState<SitePick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState(NEW);
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<string[]>([]);

  // Read once, the first time it opens; kept while the page is open.
  useEffect(() => {
    if (!open || pieces) return;
    let live = true;
    setError(null);
    (async () => {
      try {
        const res = await fetch('/api/website/site-pieces', { headers: await headers(), cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `The website’s pieces didn’t load (${res.status}).`);
        if (live) setPieces(((d.pieces ?? []) as SitePick[]).filter(p => !p.hidden).sort(byNewest));
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, [open, pieces, headers]);
  useEffect(() => { if (!open) setPicked([]); }, [open]);

  const collections = useMemo(() => [...new Set((pieces ?? []).map(p => p.collection).filter(Boolean))].sort(), [pieces]);
  // A site that gives no dates has no new arrivals: everything instead.
  const hasNew = !!pieces?.some(p => p.newArrival);
  const showing = collection === NEW && pieces && !hasNew ? '' : collection;
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (pieces ?? []).filter(p => (showing === NEW ? p.newArrival : !showing || p.collection === showing)
      && words.every(w => `${p.name} ${p.collection} ${p.facts.join(' ')}`.toLowerCase().includes(w)));
  }, [pieces, q, showing]);
  useEffect(() => { setShown(PAGE); }, [q, collection]);

  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= MAX ? prev : [...prev, id]));
  const add = () => {
    const byId = new Map((pieces ?? []).map(p => [p.id, p]));
    onAdd(picked.map(id => byId.get(id)).filter((p): p is SitePick => !!p));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90dvh] flex flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>From {siteName}</DialogTitle>
          <DialogDescription>Pick pieces already on the website — then enhance, retouch, crop and design them here like any photo.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — ruby, kara, jhumka…" className="h-10 pl-9" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0">
          {[...(hasNew ? [NEW] : []), '', ...collections].map(c => (
            <button key={c || 'all'} type="button" onClick={() => setCollection(c)}
              className={cn('shrink-0 min-h-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap inline-flex items-center gap-1', showing === c ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>
              {c === NEW ? <><Sparkles className="h-3 w-3" /> New arrivals</> : c || 'Everything'}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!pieces && !error && <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading the website…</div>}
          {pieces && <p className="text-xs text-muted-foreground mb-2">{filtered.length.toLocaleString()} of {pieces.length.toLocaleString()} pieces</p>}
          <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {filtered.slice(0, shown).map(p => {
              const on = picked.includes(p.id);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                    className={cn('block w-full min-h-0 text-left rounded-lg border overflow-hidden', on ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/60')}>
                    <span className="relative block aspect-square bg-muted">
                      <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                      {on && <span className="absolute right-1 top-1 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
                      {p.newArrival && showing !== NEW && <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">New</span>}
                    </span>
                    <span className="block px-1.5 py-1">
                      <span className="block text-[11px] font-medium leading-tight line-clamp-2">{p.name}</span>
                      <span className="block text-[10px] text-muted-foreground truncate">{p.weightGrams ? `${p.weightGrams} g · ` : ''}{p.collection}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {filtered.length > shown && <Button variant="outline" className="w-full mt-2" onClick={() => setShown(n => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</Button>}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">{picked.length ? `${picked.length} chosen${picked.length >= MAX ? ' (the most at once)' : ''}` : 'Tap to choose — several at once is fine.'}</p>
          <Button disabled={!picked.length} onClick={add}>Add {picked.length > 1 ? `${picked.length} photos` : 'photo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
