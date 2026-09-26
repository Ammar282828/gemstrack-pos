'use client';

/**
 * Add Photos — putting pieces on the website from the counter.
 *
 * The shape of the job: somebody has just photographed a tray of bangles and
 * wants them on the site. So: choose the collection once, then throw the whole
 * tray in at once — drag them, pick them, or take them with the phone camera —
 * and watch them land. Each photograph uploads on its own, so one bad file
 * never stops the rest, and a failure can be retried without redoing the batch.
 *
 * A photograph is on the website as soon as it arrives: the site reads the
 * drop folder at load time, so there is no build and no deploy between the
 * counter and the customer.
 *
 * The Maisons (the great houses' own pieces, taheri.shop): each photograph
 * asks for its house and official name, and goes up named "<House> — <Model>",
 * which is how the site shows it under its house straight away
 * (src/lib/website/maisons.ts).
 *
 * No sign-in of its own: the page runs on whatever the POS runs on. Under
 * open access that is nobody, and the counter can still add photographs —
 * decided by Ammar on 2026-09-20. The route behind it says the same.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ImagePlus, Upload, Check, X, Loader2, Camera, RotateCw, Scale, ExternalLink, AlertTriangle, Star, Wand2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS, STORE_WEBSITE_FEATURED } from '@/lib/store-config';
import { MAISON_HOUSES, isMaisonFolder, maisonFileName, maisonFullName } from '@/lib/website/maisons';

/** This house's website: taheri.shop for Taheri, the catalogue for House of Mina. */
const SITE = (STORE_LINKS.website || 'https://taheri.shop').replace(/\/+$/, '');
const SITE_NAME = SITE.replace(/^https?:\/\//, '');

/** `path` is where the collection's page is, when the site says (its own catalog-tree.json). */
interface Collection { collection: string; category: string; count: number; folder: string; sample: string; path?: string }
type Status = 'queued' | 'uploading' | 'done' | 'failed';
interface Item {
  id: string; file: File; preview: string; name: string; status: Status; error?: string; rel?: string; progress: number; house?: string; model?: string;
  /** Retouch (OpenAI + Magnific, lib/social/retouch.ts): running, the photo as it came (for Undo), and the "same piece?" check. */
  retouching?: boolean; original?: { file: File; preview: string; name: string };
  check?: { samePiece: boolean; confidence: number; differences: string[] } | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

const prettyBytes = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

export default function AddPhotosPage() {
  const { toast } = useToast();
  const [denied, setDenied] = useState(false);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/website/photos', { headers: await authHeaders(), cache: 'no-store' });
      // Only reachable with open access off and an account that is neither
      // owner nor staff — the app's own gate normally stops that earlier.
      if (res.status === 401 || res.status === 403) { setDenied(true); return; }
      if (!res.ok) { toast({ title: 'Could not load collections', description: `${res.status}`, variant: 'destructive' }); return; }
      const d = await res.json();
      setCollections(d.collections);
      setConfigured(d.configured);
      // Remember the last collection: a counter session is usually one tray.
      try { const last = localStorage.getItem('taheri_photo_folder'); if (last && d.collections.some((c: Collection) => c.folder === last)) setFolder(last); } catch { /* fine */ }
    })();
  }, [toast]);

  useEffect(() => { if (folder) try { localStorage.setItem('taheri_photo_folder', folder); } catch { /* fine */ } }, [folder]);
  // Object URLs are a real allocation; let them go when the page does.
  useEffect(() => () => { items.forEach(i => URL.revokeObjectURL(i.preview)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = collections?.find(c => c.folder === folder);
  // The Maisons: every photograph needs its house and the model's official name.
  const maison = isMaisonFolder(folder);
  const [lastHouse, setLastHouse] = useState('');
  const patchItem = (id: string, f: (i: Item) => Item) => setItems(prev => prev.map(i => (i.id === id ? f(i) : i)));
  /** Retouch one photo before it goes up; the original is kept for Undo. */
  const retouch = async (item: Item) => {
    patchItem(item.id, i => ({ ...i, retouching: true }));
    try {
      const headers = await authHeaders();
      let src: Blob = item.file;
      // The server's image library can't read HEIC; the converter Post a Piece uses can.
      if (/\.(heic|heif)$/i.test(item.name) || /heic|heif/i.test(item.file.type)) {
        const cf = new FormData(); cf.set('file', item.file);
        const cr = await fetch('/api/website/post/convert', { method: 'POST', headers, body: cf });
        if (!cr.ok) throw new Error('This HEIC photo couldn’t be read.');
        src = await cr.blob();
      }
      const form = new FormData();
      form.set('op', 'retouch'); form.set('params', '{}'); form.append('image', src, 'photo.jpg');
      const res = await fetch('/api/website/post/ai', { method: 'POST', headers, body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Retouch failed (${res.status})`);
      const bytes = Uint8Array.from(atob(d.image.data), c => c.charCodeAt(0));
      const name = item.name.replace(/\.[^.]+$/, '') + '.jpg';
      const file = new File([bytes], name, { type: 'image/jpeg' });
      patchItem(item.id, i => ({ ...i, retouching: false, original: i.original ?? { file: i.file, preview: i.preview, name: i.name }, file, name, preview: URL.createObjectURL(file), check: d.check ?? null }));
      const ok = d.check?.samePiece && d.check.confidence >= 0.8;
      toast({ title: ok ? 'Retouched' : d.check ? 'Retouched — check it closely' : 'Retouched (not checked)', description: ok ? (d.steps ?? []).join(' → ') : d.check?.differences?.[0] ?? 'Compare it with the original before sending.', variant: d.check && !ok ? 'destructive' : undefined });
    } catch (e) {
      patchItem(item.id, i => ({ ...i, retouching: false }));
      toast({ title: 'Couldn’t retouch it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };
  const undoRetouch = (item: Item) => patchItem(item.id, i => {
    if (!i.original) return i;
    URL.revokeObjectURL(i.preview);
    return { ...i, file: i.original.file, preview: i.original.preview, name: i.original.name, original: undefined, check: undefined };
  });

  const setPiece = (id: string, patch: Partial<Pick<Item, 'house' | 'model'>>) => {
    if (patch.house) setLastHouse(patch.house);
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };
  /** A Maisons photograph's file name: the house, the name, and " 2" for a second photo of the same piece. */
  const fileNameFor = (item: Item, all: Item[]) => {
    if (!maison) return item.name;
    const same = all.filter(i => (i.house || '') === (item.house || '') && (i.model || '').trim().toLowerCase() === (item.model || '').trim().toLowerCase());
    const ext = item.name.split('.').pop() || 'jpg';
    return maisonFileName(item.house || '', item.model || '', Math.max(0, same.findIndex(i => i.id === item.id)), ext);
  };
  const unnamed = maison ? items.filter(i => (i.status === 'queued' || i.status === 'failed') && (!i.house || !(i.model || '').trim())).length : 0;
  const grouped = useMemo(() => {
    const g = new Map<string, Collection[]>();
    for (const c of collections || []) { const a = g.get(c.category) || []; a.push(c); g.set(c.category, a); }
    return [...g.entries()];
  }, [collections]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: Item[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(files)) {
      // HEIC often arrives with an empty MIME type (Windows, some Androids),
      // so the extension counts too. The server turns it into a JPEG.
      const ok = /^image\/(jpeg|png|webp|heic|heif)/i.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
      if (!ok) { rejected.push(f.name); continue; }
      accepted.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, file: f, preview: URL.createObjectURL(f), name: f.name, status: 'queued', progress: 0, house: lastHouse || undefined });
    }
    if (accepted.length) setItems(prev => [...prev, ...accepted]);
    if (rejected.length) toast({ title: `Skipped ${rejected.length} file${rejected.length === 1 ? '' : 's'}`, description: 'Only JPEG, PNG, WebP and HEIC photographs can go on the website.', variant: 'destructive' });
  }, [toast, lastHouse]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // One at a time, with progress. XMLHttpRequest rather than fetch because it
  // is the only way to see bytes move — and on a phone at the counter, a
  // 6 MB photo with no feedback looks like a hung page.
  const uploadOne = (item: Item, headers: Record<string, string>, name: string) => new Promise<void>((resolve) => {
    const form = new FormData();
    form.set('folder', folder);
    form.set('name', name);
    form.set('file', item.file, item.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/website/photos');
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, progress: pct } : i));
    };
    xhr.onload = () => {
      let data: { rel?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      setItems(prev => prev.map(i => i.id === item.id
        ? (xhr.status >= 200 && xhr.status < 300
          ? { ...i, status: 'done', progress: 100, rel: data.rel }
          : { ...i, status: 'failed', error: data.error || `Failed (${xhr.status})` })
        : i));
      resolve();
    };
    xhr.onerror = () => {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'failed', error: 'Network error' } : i));
      resolve();
    };
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'uploading', progress: 0 } : i));
    xhr.send(form);
  });

  const uploadAll = useCallback(async () => {
    if (!folder || busy) return;
    if (unnamed) { toast({ title: 'Name every piece first', description: 'In The Maisons each photograph needs its house and the model’s official name.', variant: 'destructive' }); return; }
    setBusy(true);
    const headers = await authHeaders();
    // Sequential on purpose: shop wifi, big files. Five parallel uploads on a
    // slow line finish later than five in a row, and look worse doing it.
    const pending = items.filter(i => i.status === 'queued' || i.status === 'failed');
    for (const item of pending) await uploadOne(item, headers, fileNameFor(item, items));
    setBusy(false);
    const done = pending.length;
    if (done) toast({ title: `${done} photograph${done === 1 ? '' : 's'} sent`, description: `They are on ${SITE_NAME} in ${chosen?.collection} now.` });
  }, [folder, busy, items, chosen, toast, unnamed, maison]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    queued: items.filter(i => i.status === 'queued').length,
    done: items.filter(i => i.status === 'done').length,
    failed: items.filter(i => i.status === 'failed').length,
  }), [items]);

  // Put a photograph that just went up on the home page as the set of the day.
  const [featuredRel, setFeaturedRel] = useState<string | null>(null);
  const featureItem = async (rel: string) => {
    const res = await fetch('/api/website/featured', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ key: rel }) });
    const d = await res.json();
    if (!res.ok) { toast({ title: 'Could not feature it', description: d.error || `${res.status}`, variant: 'destructive' }); return; }
    setFeaturedRel(rel);
    toast({ title: 'Set of the day', description: 'It leads the home page now. Add a line to it under Photo Weights if you like.' });
  };

  const clearDone = () => setItems(prev => { prev.filter(i => i.status === 'done').forEach(i => URL.revokeObjectURL(i.preview)); return prev.filter(i => i.status !== 'done'); });
  const remove = (id: string) => setItems(prev => { const it = prev.find(i => i.id === id); if (it) URL.revokeObjectURL(it.preview); return prev.filter(i => i.id !== id); });

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><ImagePlus className="mr-3 h-8 w-8" /> Add Photos</h1>
          <p className="text-sm text-muted-foreground mt-1">Pick a collection, then add the photographs. They appear on {SITE_NAME} straight away — no rebuild.</p>
        </div>
        {counts.done > 0 && (
          <Link href="/website/weights" className="text-sm text-primary underline underline-offset-4 flex items-center gap-1.5 whitespace-nowrap">
            <Scale className="h-4 w-4" /> Record their weights
          </Link>
        )}
      </div>

      {denied && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm flex gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <div>
            <p className="font-medium">This account is not allowed to add photographs.</p>
            <p className="text-muted-foreground">Only owner and staff accounts can write to the website. Staff addresses are listed in <code>NEXT_PUBLIC_STORE_STAFF_EMAILS</code>.</p>
          </div>
        </div>
      )}

      {!denied && !configured && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="font-medium">Uploads are not switched on yet.</p>
            <p className="text-muted-foreground">Set <code>WEBSITE_UPLOAD_SECRET</code> to the same value on this app and on {SITE_NAME}, then reload. Until then the photographs below cannot be sent.</p>
          </div>
        </div>
      )}

      {!denied && (<>
      <div className="space-y-2">
        <Label>Collection</Label>
        <Select value={folder} onValueChange={setFolder} recentsKey="website-collection">
          <SelectTrigger className="w-full sm:w-96 h-12 text-base"><SelectValue placeholder={collections ? 'Choose where these photographs go…' : 'Loading collections…'} /></SelectTrigger>
          <SelectContent>
            {grouped.map(([category, list]) => (
              <SelectGroup key={category}>
                <SelectLabel>{category}</SelectLabel>
                {list.map(c => <SelectItem key={c.folder} value={c.folder}>{c.collection}{c.count > 0 && <span className="text-muted-foreground tabular-nums"> · {c.count}</span>}</SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {chosen && (
          <p className="text-xs text-muted-foreground">
            Going into <span className="font-medium text-foreground">{chosen.category} → {chosen.collection}</span>
            {chosen.count > 0 ? `, which has ${chosen.count} pieces today.` : '.'}
          </p>
        )}
        {maison && (
          <p className="text-xs text-muted-foreground max-w-2xl">
            The houses’ own pieces. Give each photograph its house and the model’s official name, exactly as the house names it
            (“LOVE Bracelet, Classic”, “Vintage Alhambra Bracelet, 5 Motifs, Onyx”). The site shows it under its house, in 18k, with no gold-rate price.
            Several photographs of one piece: give them the same name.
          </p>
        )}
      </div>

      {/* The drop target. Big, because it is the whole point of the screen. */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('rounded-xl border-2 border-dashed p-8 md:p-12 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
          !folder && 'opacity-60 pointer-events-none')}
      >
        <Upload className={cn('h-10 w-10 mx-auto mb-3', dragging ? 'text-primary' : 'text-muted-foreground/50')} />
        <p className="font-medium">{dragging ? 'Let go to add them' : 'Drag photographs here'}</p>
        <p className="text-sm text-muted-foreground mt-1">or</p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>Choose photographs</Button>
          <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()} className="sm:hidden"><Camera className="h-4 w-4 mr-2" /> Take a photo</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">JPEG, PNG, WebP or HEIC · up to 25 MB each · add as many as you like</p>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {!folder && <p className="text-sm text-muted-foreground text-center -mt-2">Choose a collection first.</p>}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={uploadAll} disabled={busy || !folder || !configured || counts.queued + counts.failed === 0 || unnamed > 0 || items.some(i => i.retouching)} className="h-11">
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</> : <><Upload className="h-4 w-4 mr-2" /> Send {counts.queued + counts.failed} to the website</>}
            </Button>
            {counts.done > 0 && <Button variant="ghost" onClick={clearDone} disabled={busy}>Clear {counts.done} sent</Button>}
            {unnamed > 0 && <span className="text-sm text-amber-700 dark:text-amber-400">{unnamed} still need{unnamed === 1 ? 's' : ''} a house and a name</span>}
            <div className="ml-auto flex items-center gap-2 text-sm tabular-nums">
              {counts.done > 0 && <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">{counts.done} sent</Badge>}
              {counts.failed > 0 && <Badge variant="outline" className="border-destructive/40 text-destructive">{counts.failed} failed</Badge>}
            </div>
          </div>

          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map(item => (
              <li key={item.id} className="relative rounded-lg overflow-hidden border bg-muted/30">
                <div className="relative aspect-square">
                  <img src={item.preview} alt="" className={cn('w-full h-full object-cover transition-opacity', item.status === 'done' && 'opacity-60')}
                    onError={e => { const el = e.currentTarget; el.style.display = 'none'; el.nextElementSibling?.classList.remove('hidden'); }} />
                  <div className="hidden absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-muted">
                    <ImagePlus className="h-7 w-7 mb-1" />
                    <span className="text-[11px] uppercase tracking-wide">{item.name.split('.').pop()?.toUpperCase()}</span>
                  </div>
                  {item.retouching && (
                    <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center text-white text-center px-2">
                      <Loader2 className="h-5 w-5 animate-spin mb-1.5" />
                      <span className="text-xs">Retouching… about a minute</span>
                    </div>
                  )}
                  {item.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center text-white">
                      <Loader2 className="h-5 w-5 animate-spin mb-1.5" />
                      <span className="text-xs tabular-nums">{item.progress}%</span>
                    </div>
                  )}
                  {item.status === 'done' && <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-emerald-600 text-white flex items-center justify-center"><Check className="h-4 w-4" /></span>}
                  {item.status === 'failed' && <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center"><X className="h-4 w-4" /></span>}
                  {item.status === 'queued' && !busy && !item.retouching && (
                    <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.name}`} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"><X className="h-3.5 w-3.5" /></button>
                  )}
                </div>
                <div className="p-2">
                  {maison && (item.status === 'queued' || item.status === 'failed') && (
                    <div className="space-y-1.5 mb-1.5">
                      <Select value={item.house || ''} onValueChange={v => setPiece(item.id, { house: v })} recentsKey="maison-house">
                        <SelectTrigger className="h-8 text-xs" aria-label="House"><SelectValue placeholder="House…" /></SelectTrigger>
                        <SelectContent>{MAISON_HOUSES.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input value={item.model || ''} onChange={e => setPiece(item.id, { model: e.target.value })} placeholder="Official name, e.g. LOVE Bracelet, Classic" className="h-8 text-xs" aria-label="Official name" />
                    </div>
                  )}
                  {maison && item.house && item.model?.trim()
                    ? <p className="text-xs truncate font-medium" title={maisonFullName(item.house, item.model)}>{maisonFullName(item.house, item.model)}</p>
                    : <p className="text-xs truncate" title={item.name}>{item.name}</p>}
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {item.status === 'failed' ? <span className="text-destructive">{item.error}</span> : prettyBytes(item.file.size)}
                  </p>
                  {item.original && item.check !== undefined && !(item.check?.samePiece && item.check.confidence >= 0.8) && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 flex gap-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> {item.check?.differences?.[0] ?? 'Not checked — compare with the original.'}</p>
                  )}
                  {(item.status === 'queued' || item.status === 'failed') && !busy && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button type="button" disabled={item.retouching} onClick={() => retouch(item)}
                        className="inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50 min-h-0">
                        <Wand2 className="h-3 w-3" /> {item.original ? 'Retouch again' : 'Retouch'}
                      </button>
                      {item.original && !item.retouching && (
                        <button type="button" onClick={() => undoRetouch(item)}
                          className="inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 min-h-0">
                          <Undo2 className="h-3 w-3" /> Original
                        </button>
                      )}
                    </div>
                  )}
                  {item.status === 'done' && item.rel && STORE_WEBSITE_FEATURED && (
                    <button type="button" onClick={() => featureItem(item.rel!)} className={cn('mt-1.5 inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 transition-colors', featuredRel === item.rel ? 'bg-amber-500 text-black border-amber-500' : 'text-muted-foreground hover:text-foreground hover:border-foreground/40')}>
                      <Star className={cn('h-3 w-3', featuredRel === item.rel && 'fill-current')} /> {featuredRel === item.rel ? 'Set of the day' : 'Feature today'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {counts.failed > 0 && !busy && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><RotateCw className="h-3.5 w-3.5" /> Press send again to retry the ones that failed.</p>
          )}
          {counts.done > 0 && chosen && (
            <p className="text-sm text-muted-foreground">
              <a href={`${SITE}${chosen.path ?? `/${chosen.collection.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}`} target="_blank" rel="noopener" className="text-primary underline underline-offset-2 inline-flex items-center gap-1">
                See {chosen.collection} on the website <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
        </>
      )}
      </>)}
    </div>
  );
}
