"use client";

/**
 * The set of the day — the one piece the house website's home page leads with
 * (`app_settings/website_featured`, `/api/website/featured`) — as one control for the three screens
 * that set it: Photo weights, Add photos and Post a piece.
 *
 * They were three copies (the audit of 2026-10-01): Photo weights had the card, the line and the
 * toggle; Add photos could feature a photo it had just sent but never showed what was featured or took
 * it down; Post a piece replaced it at publish without saying what it replaced. Now one state per page,
 * shared by every copy of the control on it, read once and updated by each change.
 * Nothing here renders where the house's website has no set of the day (STORE_WEBSITE_FEATURED).
 */

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Star, X, Loader2 } from 'lucide-react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { STORE_WEBSITE_FEATURED } from '@/lib/store-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface Featured { key: string; note: string; collection: string; file: string; thumb: string; at?: string; by?: string }

let current: Featured | null | undefined;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (f: Featured | null) => { current = f; listeners.forEach(l => l()); };

async function authed(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

/** A refusal carries its HTTP status, for Post a piece's diagnosis. */
export class FeaturedError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function call(method: 'GET' | 'PUT' | 'DELETE', body?: object): Promise<Featured | null> {
  const res = await fetch('/api/website/featured', {
    method, cache: 'no-store',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authed()) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new FeaturedError(d.error || `${res.status}`, res.status);
  return d.featured ?? null;
}

export async function refreshFeatured(): Promise<void> {
  reading ??= call('GET').then(publish, () => publish(null)).finally(() => { reading = null; });
  return reading;
}
/** Feature a piece (Category/Collection/file, any extension); `note` is the line under it. */
export async function putFeatured(key: string, note?: string): Promise<Featured | null> {
  const f = await call('PUT', { key, ...(note !== undefined ? { note } : {}) });
  publish(f);
  return f;
}
export async function clearFeatured(): Promise<void> { await call('DELETE'); publish(null); }

/** The same piece whatever its file ending (the site keeps a .webp of every upload). */
export const sameFeaturedKey = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.replace(/\.[^./]+$/, '') === b.replace(/\.[^./]+$/, '');

/** What is featured now: undefined while it is read, null when nothing is. */
export function useFeatured(): Featured | null | undefined {
  const f = useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
    () => undefined,
  );
  useEffect(() => { if (STORE_WEBSITE_FEATURED && current === undefined) void refreshFeatured(); }, []);
  return f;
}

/**
 * What the home page leads with now. `full` (Photo weights) carries the line under it; `compact` is one
 * row for beside a switch that would replace it (Post a piece).
 */
export function SetOfTheDayCard({ variant = 'full', emptyHint }: { variant?: 'full' | 'compact'; emptyHint?: React.ReactNode }) {
  const featured = useFeatured();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNote(featured?.note || ''); }, [featured?.key, featured?.note]);
  if (!STORE_WEBSITE_FEATURED) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast({ title: 'Could not change the set of the day', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const remove = featured && (
    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 min-h-0 flex-shrink-0" onClick={() => run(clearFeatured)} disabled={busy} title="Take it off the home page" aria-label="Take it off the home page">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
    </Button>
  );

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
        {featured ? <img src={featured.thumb} alt="" className="h-7 w-7 rounded object-cover flex-shrink-0" /> : <Star className="h-3.5 w-3.5 flex-shrink-0" />}
        <span className="truncate">
          {featured === undefined ? '…' : featured ? <>Now: <span className="text-foreground">{featured.file}</span> · {featured.collection}</> : 'Nothing is the set of the day'}
        </span>
        {remove}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-amber-500/[0.04] border-amber-500/30 p-3 md:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {featured ? <img src={featured.thumb} alt="" className="h-14 w-14 rounded-md object-cover flex-shrink-0" /> : <div className="h-14 w-14 rounded-md bg-muted flex items-center justify-center flex-shrink-0"><Star className="h-5 w-5 text-muted-foreground" /></div>}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Set of the day · on the home page</p>
          {featured === undefined ? <p className="text-sm text-muted-foreground">…</p>
            : featured ? <p className="text-sm font-medium truncate">{featured.file} <span className="text-muted-foreground font-normal">· {featured.collection}</span></p>
            : <p className="text-sm text-muted-foreground">{emptyHint ?? <>Nothing yet — press <Star className="inline h-3.5 w-3.5 -mt-0.5" /> Feature today on a photo.</>}</p>}
        </div>
      </div>
      {featured && (
        <div className="flex items-center gap-2 sm:w-[46%]">
          <Input placeholder="A line about it (optional)" value={note} maxLength={160} onChange={e => setNote(e.target.value)}
            onBlur={() => { if (note !== featured.note) void run(() => putFeatured(featured.key, note)); }} className="h-9" aria-label="A line about the set of the day" />
          {remove}
        </div>
      )}
    </div>
  );
}

/** Feature this piece today, or take it down if it already is. */
export function FeatureToggle({ pieceKey, variant = 'button', className }: { pieceKey: string; variant?: 'button' | 'chip'; className?: string }) {
  const featured = useFeatured();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!STORE_WEBSITE_FEATURED) return null;
  const on = sameFeaturedKey(featured?.key, pieceKey);
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) await clearFeatured();
      else { await putFeatured(pieceKey); toast({ title: 'Set of the day', description: 'It leads the home page now.' }); }
    } catch (e) {
      toast({ title: 'Could not change the set of the day', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  if (variant === 'chip') {
    return (
      <button type="button" onClick={toggle} disabled={busy} title={on ? 'Take it off the home page' : 'Lead the home page with it today'}
        className={cn('inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 transition-colors min-h-0',
          on ? 'bg-amber-500 text-black border-amber-500' : 'text-muted-foreground hover:text-foreground hover:border-foreground/40', className)}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className={cn('h-3 w-3', on && 'fill-current')} />} {on ? 'Set of the day' : 'Feature today'}
      </button>
    );
  }
  return (
    <Button variant={on ? 'default' : 'outline'} className={cn('w-full h-10', className)} onClick={toggle} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Star className={cn('h-4 w-4 mr-2', on && 'fill-current')} />} {on ? 'Set of the day — on the home page' : 'Feature today'}
    </Button>
  );
}
