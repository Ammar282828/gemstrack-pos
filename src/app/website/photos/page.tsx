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
import { ImagePlus, Upload, Check, X, Loader2, Camera, RotateCw, Scale, ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Collection { collection: string; category: string; count: number; folder: string; sample: string }
type Status = 'queued' | 'uploading' | 'done' | 'failed';
interface Item { id: string; file: File; preview: string; name: string; status: Status; error?: string; rel?: string; progress: number }

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
      accepted.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, file: f, preview: URL.createObjectURL(f), name: f.name, status: 'queued', progress: 0 });
    }
    if (accepted.length) setItems(prev => [...prev, ...accepted]);
    if (rejected.length) toast({ title: `Skipped ${rejected.length} file${rejected.length === 1 ? '' : 's'}`, description: 'Only JPEG, PNG, WebP and HEIC photographs can go on the website.', variant: 'destructive' });
  }, [toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // One at a time, with progress. XMLHttpRequest rather than fetch because it
  // is the only way to see bytes move — and on a phone at the counter, a
  // 6 MB photo with no feedback looks like a hung page.
  const uploadOne = (item: Item, headers: Record<string, string>) => new Promise<void>((resolve) => {
    const form = new FormData();
    form.set('folder', folder);
    form.set('name', item.name);
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
    setBusy(true);
    const headers = await authHeaders();
    // Sequential on purpose: shop wifi, big files. Five parallel uploads on a
    // slow line finish later than five in a row, and look worse doing it.
    const pending = items.filter(i => i.status === 'queued' || i.status === 'failed');
    for (const item of pending) await uploadOne(item, headers);
    setBusy(false);
    const done = pending.length;
    if (done) toast({ title: `${done} photograph${done === 1 ? '' : 's'} sent`, description: `They are on taheri.shop in ${chosen?.collection} now.` });
  }, [folder, busy, items, chosen, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    queued: items.filter(i => i.status === 'queued').length,
    done: items.filter(i => i.status === 'done').length,
    failed: items.filter(i => i.status === 'failed').length,
  }), [items]);

  const clearDone = () => setItems(prev => { prev.filter(i => i.status === 'done').forEach(i => URL.revokeObjectURL(i.preview)); return prev.filter(i => i.status !== 'done'); });
  const remove = (id: string) => setItems(prev => { const it = prev.find(i => i.id === id); if (it) URL.revokeObjectURL(it.preview); return prev.filter(i => i.id !== id); });

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><ImagePlus className="mr-3 h-8 w-8" /> Add Photos</h1>
          <p className="text-sm text-muted-foreground mt-1">Pick a collection, then add the photographs. They appear on taheri.shop straight away — no rebuild.</p>
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
            <p className="text-muted-foreground">Set <code>WEBSITE_UPLOAD_SECRET</code> to the same value on this app and on taheri.shop, then reload. Until then the photographs below cannot be sent.</p>
          </div>
        </div>
      )}

      {!denied && (<>
      <div className="space-y-2">
        <Label>Collection</Label>
        <Select value={folder} onValueChange={setFolder}>
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
            <Button onClick={uploadAll} disabled={busy || !folder || !configured || counts.queued + counts.failed === 0} className="h-11">
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</> : <><Upload className="h-4 w-4 mr-2" /> Send {counts.queued + counts.failed} to the website</>}
            </Button>
            {counts.done > 0 && <Button variant="ghost" onClick={clearDone} disabled={busy}>Clear {counts.done} sent</Button>}
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
                  {item.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center text-white">
                      <Loader2 className="h-5 w-5 animate-spin mb-1.5" />
                      <span className="text-xs tabular-nums">{item.progress}%</span>
                    </div>
                  )}
                  {item.status === 'done' && <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-emerald-600 text-white flex items-center justify-center"><Check className="h-4 w-4" /></span>}
                  {item.status === 'failed' && <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center"><X className="h-4 w-4" /></span>}
                  {item.status === 'queued' && !busy && (
                    <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.name}`} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"><X className="h-3.5 w-3.5" /></button>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs truncate" title={item.name}>{item.name}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {item.status === 'failed' ? <span className="text-destructive">{item.error}</span> : prettyBytes(item.file.size)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {counts.failed > 0 && !busy && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><RotateCw className="h-3.5 w-3.5" /> Press send again to retry the ones that failed.</p>
          )}
          {counts.done > 0 && chosen && (
            <p className="text-sm text-muted-foreground">
              <a href={`https://taheri.shop/${chosen.collection.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} target="_blank" rel="noopener" className="text-primary underline underline-offset-2 inline-flex items-center gap-1">
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
