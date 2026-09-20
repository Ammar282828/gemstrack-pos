'use client';

/**
 * Photo weights — recording the weight of catalogue photographs that do not
 * carry it in their corner.
 *
 * Built for a person at the counter with a scale and a queue of a thousand
 * pieces: one photograph at a time, big, with one number to type. Enter saves
 * it and shows the next one that needs a weight; the arrow keys move without
 * saving; a filmstrip shows what is coming. Nothing else on the screen asks
 * for attention.
 *
 * The site draws a weight recorded here onto the photograph, in the same
 * place and manner as the burned-in ones, and prices from it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Scale, ChevronLeft, ChevronRight, Loader2, Check, Search, X, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Piece {
  key: string; collection: string; file: string; thumb: string;
  weightGrams: number | null; source: 'label' | 'pos' | null; labelWeightGrams: number | null;
  enteredBy: string | null; enteredAt: string | null;
}

async function authed(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

export default function PhotoWeightsPage() {
  const { toast } = useToast();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  // The set of the day: one piece on the home page, and the counter's line.
  const [featured, setFeatured] = useState<{ key: string; note: string; collection: string; file: string; thumb: string } | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [featuring, setFeaturing] = useState(false);
  useEffect(() => { (async () => {
    const res = await fetch('/api/website/featured', { headers: await authed(), cache: 'no-store' });
    const d = res.ok ? await res.json() : { featured: null };
    setFeatured(d.featured); setNote(d.featured?.note || '');
  })(); }, []);
  const feature = async (key: string | null) => {
    setFeaturing(true);
    try {
      const res = key
        ? await fetch('/api/website/featured', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(await authed()) }, body: JSON.stringify({ key, note }) })
        : await fetch('/api/website/featured', { method: 'DELETE', headers: await authed() });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      setFeatured(d.featured);
    } catch (e) { toast({ title: 'Could not change the set of the day', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setFeaturing(false); }
  };
  const [collection, setCollection] = useState<string>('all');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/website/pieces', { headers: await authed(), cache: 'no-store' });
    if (!res.ok) { toast({ title: 'Could not load the catalogue', description: `${res.status}`, variant: 'destructive' }); return; }
    const data = await res.json();
    setPieces(data.pieces);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const collections = useMemo(() => [...new Set((pieces || []).map(p => p.collection))].sort(), [pieces]);

  const queue = useMemo(() => {
    let q = pieces || [];
    if (collection !== 'all') q = q.filter(p => p.collection === collection);
    if (onlyMissing) q = q.filter(p => !p.weightGrams);
    if (search.trim()) { const s = search.trim().toLowerCase(); q = q.filter(p => p.key.toLowerCase().includes(s)); }
    return q;
  }, [pieces, collection, onlyMissing, search]);

  // Keep the cursor inside the queue as filters change, and prefill from the piece.
  useEffect(() => { setIndex(i => Math.min(i, Math.max(0, queue.length - 1))); }, [queue.length]);
  const current = queue[index] || null;
  useEffect(() => {
    setValue(current?.source === 'pos' && current.weightGrams ? String(current.weightGrams) : '');
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const all = pieces || [];
    const scoped = collection === 'all' ? all : all.filter(p => p.collection === collection);
    return { total: scoped.length, withWeight: scoped.filter(p => p.weightGrams).length };
  }, [pieces, collection]);

  const save = useCallback(async (advance: boolean) => {
    if (!current || saving) return;
    const grams = value.trim() === '' ? null : Number(value.replace(',', '.'));
    if (grams !== null && !(grams > 0 && grams < 5000)) { toast({ title: 'Enter a weight in grams', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/website/pieces', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(await authed()) }, body: JSON.stringify({ key: current.key, weightGrams: grams }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
      setPieces(ps => (ps || []).map(p => p.key === current.key
        ? { ...p, weightGrams: grams ?? p.labelWeightGrams, source: grams ? 'pos' : (p.labelWeightGrams ? 'label' : null), enteredBy: grams ? 'you' : null, enteredAt: grams ? new Date().toISOString() : null }
        : p));
      // With "only missing" on, the piece leaves the queue and the next one slides
      // into this index; otherwise step forward.
      if (advance && !onlyMissing) setIndex(i => Math.min(i + 1, queue.length - 1));
    } catch (e) {
      toast({ title: 'Not saved', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setSaving(false); }
  }, [current, value, saving, onlyMissing, queue.length, toast]);

  // Arrow keys move between photos when the field is not focused (the field
  // handles its own keys above, so typing a number is never hijacked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setIndex(i => Math.min(i + 1, queue.length - 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue.length]);

  const pct = counts.total ? Math.round((counts.withWeight / counts.total) * 100) : 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><Scale className="mr-3 h-8 w-8" /> Photo Weights</h1>
          <p className="text-sm text-muted-foreground mt-1">Type the weight of the piece in the photograph. The website shows it in the corner, as on the photos that already carry one, and prices from it.</p>
        </div>
        <div className="text-right tabular-nums">
          <div className="text-2xl font-semibold">{counts.withWeight.toLocaleString()} <span className="text-muted-foreground text-base font-normal">of {counts.total.toLocaleString()}</span></div>
          <div className="text-xs text-muted-foreground">{counts.total - counts.withWeight > 0 ? `${(counts.total - counts.withWeight).toLocaleString()} to go` : 'all weighed'}</div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={collection} onValueChange={v => { setCollection(v); setIndex(0); }}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All collections</SelectItem>
            {collections.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2"><Switch id="missing" checked={onlyMissing} onCheckedChange={v => { setOnlyMissing(v); setIndex(0); }} /><Label htmlFor="missing">Only photos without a weight</Label></div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 w-52" placeholder="Find a photo…" value={search} onChange={e => { setSearch(e.target.value); setIndex(0); }} />
          {search && <button type="button" className="absolute right-2 top-2.5 text-muted-foreground" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      {/* Set of the day — what the home page leads with. Pick any photo below
          and press the star; the line beside it is shown under the headline. */}
      <div className="rounded-lg border bg-amber-500/[0.04] border-amber-500/30 p-3 md:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {featured ? <img src={featured.thumb} alt="" className="h-14 w-14 rounded-md object-cover flex-shrink-0" /> : <div className="h-14 w-14 rounded-md bg-muted flex items-center justify-center flex-shrink-0"><Star className="h-5 w-5 text-muted-foreground" /></div>}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Set of the day · on the home page</p>
            {featured === undefined ? <p className="text-sm text-muted-foreground">…</p>
              : featured ? <p className="text-sm font-medium truncate">{featured.file} <span className="text-muted-foreground font-normal">· {featured.collection}</span></p>
              : <p className="text-sm text-muted-foreground">Nothing yet — open a photo below and press <Star className="inline h-3.5 w-3.5 -mt-0.5" /> Feature today.</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:w-[46%]">
          <Input placeholder="A line about it (optional)" value={note} maxLength={160} onChange={e => setNote(e.target.value)} onBlur={() => { if (featured && note !== featured.note) feature(featured.key); }} className="h-9" />
          {featured && <Button variant="ghost" size="sm" onClick={() => feature(null)} disabled={featuring} title="Take it off the home page"><X className="h-4 w-4" /></Button>}
        </div>
      </div>

      {pieces === null ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading the catalogue…</div>
      ) : !current ? (
        <div className="rounded-lg border border-dashed py-20 text-center">
          <Check className="h-8 w-8 mx-auto text-emerald-600 mb-2" />
          <p className="font-medium">{onlyMissing ? 'Every photo here has a weight.' : 'Nothing matches.'}</p>
          {onlyMissing && <p className="text-sm text-muted-foreground mt-1">Switch off “only photos without a weight” to review or correct any of them.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          <div className="relative rounded-xl overflow-hidden bg-muted aspect-square">
            <img key={current.key} src={current.thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
            {/* Where the site will draw it — so what you type appears where it will land. */}
            {(value || current.weightGrams) && current.source !== 'label' && (
              // The site's own geometry (WeightLabel.jsx): Futura LT Light at
              // 143/3000 of the width, 120 in, baseline at 100 + 143 × 1.1.
              <svg aria-hidden="true" viewBox="0 0 3000 3000" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full pointer-events-none select-none">
                <text x="120" y={100 + 143 * 1.1} fontFamily='"Futura LT", Futura, "Century Gothic", system-ui, sans-serif' fontWeight="300" fontSize="143" letterSpacing="2" fill="#fff">
                  {(value || String(current.weightGrams)).replace(/[^\d.]/g, '')}g
                </text>
              </svg>
            )}
            {current.source === 'label' && <Badge className="absolute top-3 right-3 bg-black/55 text-white border-transparent">weight is on the photo: {current.labelWeightGrams}g</Badge>}
            <button type="button" onClick={() => setIndex(i => Math.max(i - 1, 0))} disabled={index === 0} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/40 text-white flex items-center justify-center disabled:opacity-0"><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" onClick={() => setIndex(i => Math.min(i + 1, queue.length - 1))} disabled={index >= queue.length - 1} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/40 text-white flex items-center justify-center disabled:opacity-0"><ChevronRight className="h-5 w-5" /></button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{current.collection}</p>
              <p className="text-lg font-medium leading-tight">{current.file}</p>
              <p className="text-xs text-muted-foreground tabular-nums mt-1">{index + 1} of {queue.length} in this list</p>
            </div>
            <div>
              <Label htmlFor="grams" className="text-sm">Weight</Label>
              <div className="relative mt-1">
                <Input ref={inputRef} id="grams" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={value} onChange={e => setValue(e.target.value)}
                  // Handled here, on the field, so it runs before the app's own
                  // global key handling (voice, scanning) can see the keystroke.
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(true); }
                    else if (e.key === 'Escape') { e.preventDefault(); setValue(''); }
                    else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length) { e.preventDefault(); setIndex(i => Math.min(i + 1, queue.length - 1)); }
                    else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
                  }}
                  className="h-16 text-4xl font-semibold tabular-nums pr-12" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-2xl text-muted-foreground">g</span>
              </div>
              {current.source === 'label' && <p className="text-xs text-muted-foreground mt-1.5">The photo already shows {current.labelWeightGrams}g. A weight typed here is used for pricing instead; the photo keeps its own label.</p>}
              {current.source === 'pos' && current.enteredAt && <p className="text-xs text-muted-foreground mt-1.5">Recorded {new Date(current.enteredAt).toLocaleString('en-PK')}{current.enteredBy && current.enteredBy !== 'counter' ? ` by ${current.enteredBy}` : ''}. Clear the field and press Enter to remove it.</p>}
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 h-11" onClick={() => save(true)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-2" /> Save &amp; next</>}</Button>
              <Button variant="secondary" className="h-11" onClick={() => setIndex(i => Math.min(i + 1, queue.length - 1))} disabled={index >= queue.length - 1}>Skip</Button>
            </div>
            <p className="text-xs text-muted-foreground"><kbd className="px-1 rounded border">Enter</kbd> saves and moves on · <kbd className="px-1 rounded border">←</kbd> <kbd className="px-1 rounded border">→</kbd> move without saving</p>
            <Button variant={featured?.key === current.key ? 'default' : 'outline'} className="w-full h-10" onClick={() => feature(featured?.key === current.key ? null : current.key)} disabled={featuring}>
              <Star className={cn('h-4 w-4 mr-2', featured?.key === current.key && 'fill-current')} /> {featured?.key === current.key ? 'Set of the day — on the home page' : 'Feature today'}
            </Button>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Coming up</p>
              <div className="grid grid-cols-6 gap-1.5">
                {queue.slice(index + 1, index + 13).map((p, i) => (
                  <button key={p.key} type="button" onClick={() => setIndex(index + 1 + i)} title={p.file} className={cn('relative aspect-square rounded-md overflow-hidden ring-1 ring-border hover:ring-primary')}>
                    <img src={p.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
                    {p.weightGrams && <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] tabular-nums text-center">{p.weightGrams}g</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
