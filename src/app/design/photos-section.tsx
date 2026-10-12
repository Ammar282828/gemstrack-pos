'use client';

/**
 * Photos (plan §5.2): where a design's photograph comes from.
 *
 *   The website     the house's own pieces (new arrivals first, search, collections) — for everyone who may design
 *   Best for ads    the library's picks for a placement, scored — owner and marketing
 *   Every photo     the whole library with Drive, fixes and assessments — owner and marketing
 *
 * Choosing a photograph hands it to the start screen (`onMake`); nothing is made here. The library is the Ad
 * studio's, mounted in place (library.tsx), and the API keeps it to those who may use it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { ChipRow, EmptyState, FilterChip, SearchField } from '@/components/ledger';
import { Button } from '@/components/ui/button';
import { byNewest } from '@/lib/website/new-arrivals';
import { authHeaders } from '../ads/ads-kit';
import { AssetSheet, LibrarySection, PicksSection, usePlacement } from './library';
import { fetchAsset, type WorkPhoto } from './studio-kit';
import type { SitePick } from '../website/post/site-picker';
import { photoPartsFor, type PhotoPart } from './design-state';
import { startPhotoFromSite } from './start';
import type { StartPhoto } from './use-design';
import type { LibraryItem } from './studio-kit';

const NEW = '__new__';
const PAGE = 60;

/** A library photograph (or one opened in the asset sheet, maybe fixed) as a photograph to start from. */
export function startPhotoFromWork(w: WorkPhoto): StartPhoto {
  const a = w.asset;
  const orig = !w.blob ? a?.original ?? null : null;
  return {
    label: a?.name ?? w.note ?? 'Photo',
    load: async () => {
      if (w.blob) return w.blob;
      if (orig) { const b = await fetchAsset(orig.id, 2048).catch(() => null); if (b) return b; }
      if (a) return fetchAsset(a.id, 2048);
      throw new Error('No photograph.');
    },
    // A fixed copy that took the labels off, or a clean Drive original, carries no mark; the site's own photo does.
    marked: !w.clean && !!a && !orig && (a.source === 'site' || !!a.assessment?.burnedText),
    source: a ? { assetId: a.id } : undefined,
    fields: a ? {
      headline: a.assessment?.headline || a.name,
      kicker: a.source === 'site' && a.collection !== 'Website' ? a.collection : '',
      weight: a.specs,
    } : undefined,
  };
}

export function PhotosSection({ adsOk, part, onPart, onMake }: {
  adsOk: boolean;
  part: PhotoPart;
  onPart: (p: PhotoPart) => void;
  onMake: (p: StartPhoto) => void;
}) {
  const parts = photoPartsFor(adsOk);
  const [placement, setPlacement] = usePlacement();
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="space-y-3">
      {parts.length > 1 && (
        <ChipRow label="Photos from">
          {parts.map(p => <FilterChip key={p.key} title={p.label} chosen={part === p.key} onClick={() => onPart(p.key)} />)}
        </ChipRow>
      )}
      {part === 'site' && <SitePieces onMake={onMake} />}
      {adsOk && part === 'picks' && <PicksSection placement={placement} onPlacement={setPlacement} onOpen={setOpen} reloadKey={reloadKey} />}
      {adsOk && part === 'library' && <LibrarySection placement={placement} onPlacement={setPlacement} onOpen={setOpen} reloadKey={reloadKey} />}
      {adsOk && <AssetSheet item={open} placement={placement} onClose={() => setOpen(null)} onMake={w => { setOpen(null); onMake(startPhotoFromWork(w)); }} onChanged={() => setReloadKey(n => n + 1)} />}
    </div>
  );
}

// ── The website's pieces ───────────────────────────────────────────────────

function SitePieces({ onMake }: { onMake: (p: StartPhoto) => void }) {
  const [pieces, setPieces] = useState<SitePick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState(NEW);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/website/site-pieces', { headers: await authHeaders(), cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `The website’s pieces didn’t load (${res.status}).`);
        if (live) setPieces(((d.pieces ?? []) as SitePick[]).filter(p => !p.hidden).sort(byNewest));
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, []);

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

  return (
    <div className="space-y-3">
      <SearchField value={q} onChange={setQ} placeholder="Search — ruby, kara, jhumka…" />
      <ChipRow label="Collections">
        {hasNew && <FilterChip title="New arrivals" chosen={showing === NEW} onClick={() => setCollection(NEW)} />}
        <FilterChip title="Everything" chosen={showing === ''} onClick={() => setCollection('')} />
        {collections.map(c => <FilterChip key={c} title={c} chosen={showing === c} onClick={() => setCollection(c)} />)}
      </ChipRow>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!pieces && !error && <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading the website…</p>}
      {pieces && !filtered.length && <EmptyState title="No pieces" description="Nothing on the website matches." />}
      {pieces && filtered.length > 0 && <p className="px-1 text-ios-foot text-muted-foreground">{filtered.length.toLocaleString()} of {pieces.length.toLocaleString()} pieces — tap one to design it</p>}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {filtered.slice(0, shown).map(p => (
          <li key={p.id}>
            <button type="button" onClick={() => onMake(startPhotoFromSite(p))} className="block min-h-0 w-full overflow-hidden rounded-card bg-card text-left hover:ring-2 hover:ring-primary/60">
              <span className="relative block aspect-square bg-muted">
                <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                {p.newArrival && showing !== NEW && <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white"><Sparkles className="h-2.5 w-2.5" /> New</span>}
              </span>
              <span className="block px-2 py-1.5">
                <span className="line-clamp-2 block text-[11px] font-medium leading-tight">{p.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{p.weightGrams ? `${p.weightGrams} g · ` : ''}{p.collection}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {filtered.length > shown && <Button variant="outline" className="w-full" onClick={() => setShown(n => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</Button>}
    </div>
  );
}
