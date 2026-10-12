'use client';

/**
 * Smart input (plan §4.2): one box that takes anything — typed words, a paste (a caption, a forwarded WhatsApp
 * message, a link, a SKU), dropped or chosen photos — and shows what it understood before anything is used:
 * each field with a tick to accept it (and editable), the photos with the main one picked, how sure it is and
 * what it left out. `onParsed` gets the accepted fields and chosen photos, one result per piece.
 *
 * The words are read by /api/design/parse (deterministic first; the AI only helps when unsure and is held to
 * "no figure that isn't in the input"); pictures by /api/design/analyze, one at a time.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Check, ImagePlus, Layers, Link2, Loader2, Sparkles, X } from 'lucide-react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Fields } from '@/lib/social/editor';
import { groupByPiece, type ParsedPiece, type ParseResponse, type SnippetPrice, type SnippetSpecs } from '@/lib/design/parse';
import type { Analysis } from '@/lib/design/layers';
import type { DesignKind } from '@/lib/design/model';

export interface SmartPhoto {
  id: string;
  name: string;
  blob: Blob;
  /** An object URL for showing it; the page that takes the photo owns it from here. */
  url: string;
  from: 'file' | 'site' | 'url';
  /** `site:<id>` for a website piece's photo. */
  ref?: string;
  analysis?: Analysis | null;
}

export interface SmartResult {
  name: string;
  /** Only the fields the person kept. */
  fields: Partial<Fields>;
  specs: SnippetSpecs;
  price?: SnippetPrice;
  caption?: string;
  suggestedKind?: DesignKind;
  piece?: ParsedPiece['piece'];
  /** The main photo first. */
  photos: SmartPhoto[];
}

export interface LayersResult {
  width: number; height: number;
  layers: unknown[];
  subject: { x: number; y: number; w: number; h: number } | null;
  plate: 'original';
  cutout: { mimeType: string; data: string } | null;
  notes: string[];
  ai: boolean;
}

interface Props {
  onParsed: (results: SmartResult[]) => void;
  /** Owner and marketing: offer "Split into layers" on a dropped picture. Staff: leave off. */
  layers?: boolean;
  onLayers?: (plan: LayersResult, photo: SmartPhoto) => void;
  /** A Drive folder link was pasted (owner only; the page decides what to do). */
  onDriveFolder?: (folderId: string) => void;
  className?: string;
  placeholder?: string;
}

type FieldKey = keyof Fields;
const FIELD_LABEL: Record<FieldKey, string> = { kicker: 'Small line', headline: 'Headline', weight: 'Specs line', details: 'Details' };
const FIELD_ORDER: FieldKey[] = ['headline', 'weight', 'kicker', 'details'];

interface Item {
  key: string;
  parsed: ParsedPiece;
  fields: Partial<Fields>;
  accept: Record<string, boolean>;
  photos: SmartPhoto[];
  main: number;
  analysis?: Analysis | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

const uid = () => Math.random().toString(36).slice(2, 9);

async function photoFromRef(ref: string, name: string): Promise<SmartPhoto | null> {
  const headers = await authHeaders();
  let endpoint = '';
  let from: SmartPhoto['from'] = 'url';
  if (ref.startsWith('site:')) { endpoint = `/api/website/site-pieces/image?${new URLSearchParams({ id: ref.slice(5), size: '3000', original: '1' })}`; from = 'site'; }
  else if (ref.startsWith('url:')) endpoint = `/api/design/fetch?${new URLSearchParams({ url: ref.slice(4) })}`;
  else return null;
  const res = await fetch(endpoint, { headers }).catch(() => null);
  if (!res?.ok) return null;
  const blob = await res.blob();
  return { id: uid(), name, blob, url: URL.createObjectURL(blob), from, ref };
}

export function SmartInput({ onParsed, layers, onLayers, onDriveFolder, className, placeholder }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addItem = (parsed: ParsedPiece, photos: SmartPhoto[], analysis?: Analysis | null): Item => {
    const fields: Partial<Fields> = { ...parsed.fields };
    if (!fields.headline && analysis?.headline) fields.headline = analysis.headline;
    const accept: Record<string, boolean> = {};
    for (const k of FIELD_ORDER) accept[k] = !!fields[k];
    accept.price = !!parsed.price;
    return { key: uid(), parsed, fields, accept, photos, main: 0, analysis };
  };

  const readText = useCallback(async (input: string, files: File[] = []) => {
    setError(''); setNotes([]);
    const t = input.trim();
    const out: Item[] = [];
    try {
      if (t) {
        setBusy('Reading…');
        const res = await fetch('/api/design/parse', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ input: t }) });
        const data = await res.json().catch(() => ({})) as ParseResponse & { error?: string };
        if (!res.ok) throw new Error(data.error || `Couldn't read that (${res.status}).`);
        if (data.drive) { onDriveFolder?.(data.drive.folderId); setNotes(['That is a Drive folder; it goes to the library.']); }
        for (const p of data.pieces) {
          setBusy('Getting the photo…');
          const photos: SmartPhoto[] = [];
          for (const ph of p.photos.slice(0, 3)) {
            const got = await photoFromRef(ph.ref, p.name || 'photo');
            if (got) photos.push(got);
          }
          out.push(addItem(p, photos));
        }
        if (!data.pieces.length && data.warnings.length) setNotes(data.warnings);
        else setNotes(data.pieces.flatMap(p => p.warnings));
      }
      if (files.length) {
        const imgs = files.filter(f => f.type.startsWith('image/'));
        const groups = groupByPiece(imgs.map(f => ({ name: f.name, lastModified: f.lastModified })));
        for (const g of groups) {
          setBusy(`Looking at ${imgs[g[0]].name}…`);
          const photos: SmartPhoto[] = g.map(i => ({ id: uid(), name: imgs[i].name, blob: imgs[i], url: URL.createObjectURL(imgs[i]), from: 'file' as const }));
          let analysis: Analysis | null = null;
          // One picture at a time, and only the main one: the server holds one image in memory per request.
          const form = new FormData();
          form.append('file', photos[0].blob, photos[0].name);
          const res = await fetch('/api/design/analyze', { method: 'POST', headers: await authHeaders(), body: form }).catch(() => null);
          if (res?.ok) { const d = await res.json().catch(() => null) as { analysis?: Analysis | null } | null; analysis = d?.analysis ?? null; photos[0].analysis = analysis; }
          // Words typed with one group of photos describe that piece: the photos join it.
          if (t && out.length === 1 && groups.length === 1) { out[0] = { ...out[0], photos: [...photos, ...out[0].photos], analysis }; continue; }
          out.push(addItem({ name: analysis?.headline || '', fields: {}, specs: {}, photos: [], confidence: analysis ? 0.6 : 0.3, warnings: analysis ? (analysis.burnedText ? ['There is lettering on this photo.'] : []) : ['The picture was not read (no AI just now); add the words yourself.'] }, photos, analysis));
        }
      }
      if (!out.length && !t && !files.length) setError('Type, paste or drop something first.');
      setItems(prev => [...out, ...prev].slice(0, 12));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDriveFolder, items.length]);

  const takeFiles = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    void readText(text, files);
    setText('');
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); takeFiles(files); return; }
    const pasted = e.clipboardData.getData('text');
    // A lone link or a long paste is read at once; a few typed words wait for the button.
    if (/^\s*(https?:\/\/|www\.)\S+\s*$/i.test(pasted) || pasted.length > 40) { e.preventDefault(); setText(pasted); void readText(pasted); }
  };

  const set = (key: string, f: (i: Item) => Item) => setItems(prev => prev.map(i => (i.key === key ? f(i) : i)));
  const drop = (key: string) => setItems(prev => prev.filter(i => i.key !== key));

  const resultOf = (i: Item): SmartResult => {
    const fields: Partial<Fields> = {};
    for (const k of FIELD_ORDER) if (i.accept[k] && i.fields[k]?.trim()) fields[k] = i.fields[k]!.trim();
    const photos = i.photos.length ? [i.photos[i.main], ...i.photos.filter((_, n) => n !== i.main)].filter(Boolean) : [];
    return {
      name: i.fields.headline || i.parsed.name, fields, specs: i.parsed.specs,
      ...(i.accept.price && i.parsed.price ? { price: i.parsed.price } : {}),
      ...(i.parsed.caption ? { caption: i.parsed.caption } : {}),
      ...(i.parsed.suggestedKind ? { suggestedKind: i.parsed.suggestedKind } : {}),
      ...(i.parsed.piece ? { piece: i.parsed.piece } : {}),
      photos,
    };
  };

  const split = async (photo: SmartPhoto) => {
    setError(''); setBusy('Splitting into layers…');
    try {
      const form = new FormData();
      form.append('file', photo.blob, photo.name);
      const res = await fetch('/api/design/layers', { method: 'POST', headers: await authHeaders(), body: form });
      const data = await res.json().catch(() => ({})) as LayersResult & { error?: string };
      if (!res.ok) throw new Error(data.error || `Couldn't split it (${res.status}).`);
      setNotes(data.notes);
      onLayers?.(data, photo);
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div
        className={cn('rounded-xl border bg-card p-3 transition-colors', over && 'border-primary bg-primary/5')}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); takeFiles(e.dataTransfer.files); const dropped = e.dataTransfer.getData('text'); if (dropped && !e.dataTransfer.files.length) { setText(dropped); void readText(dropped); } }}
      >
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void readText(text); } }}
          rows={3}
          disabled={!!busy}
          placeholder={placeholder ?? 'Paste a caption, a WhatsApp message, a link or a SKU, or drop photos here. Type it too: “ruby ring 21k 12.35g”.'}
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!!busy || !text.trim()} onClick={() => void readText(text)}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {busy ?? 'Read it'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <ImagePlus className="mr-1 h-4 w-4" /> Photos
          </Button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { takeFiles(e.target.files); e.target.value = ''; }} />
          <span className="text-xs text-muted-foreground">Paste, drop or type. Nothing is used until you tick it.</span>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notes.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}

      {items.map(i => (
        <div key={i.key} className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', i.parsed.confidence >= 0.6 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}>
              {i.parsed.confidence >= 0.6 ? 'Sure' : 'Check this'} · {Math.round(i.parsed.confidence * 100)}%
            </span>
            {i.parsed.piece?.url && <a href={i.parsed.piece.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"><Link2 className="h-3 w-3" /> source</a>}
            {i.parsed.suggestedKind && <span className="text-xs text-muted-foreground">suggests: {i.parsed.suggestedKind}</span>}
            <button type="button" aria-label="Remove" className="ml-auto text-muted-foreground hover:text-foreground min-h-0" onClick={() => drop(i.key)}><X className="h-4 w-4" /></button>
          </div>

          {i.photos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {i.photos.map((p, n) => (
                <div key={p.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.name} className={cn('h-20 w-20 cursor-pointer rounded-lg object-cover ring-2', n === i.main ? 'ring-primary' : 'ring-transparent')} onClick={() => set(i.key, x => ({ ...x, main: n }))} />
                  {n === i.main && <span className="absolute left-1 top-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">main</span>}
                  {layers && onLayers && n === i.main && (
                    <button type="button" disabled={!!busy} title="Split into layers" aria-label="Split into layers" onClick={() => void split(p)} className="absolute bottom-1 right-1 min-h-0 rounded bg-background/90 p-1 shadow"><Layers className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            {FIELD_ORDER.map(k => (i.fields[k] !== undefined || i.accept[k]) && (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={!!i.accept[k]} onChange={e => set(i.key, x => ({ ...x, accept: { ...x.accept, [k]: e.target.checked } }))} />
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{FIELD_LABEL[k]}</span>
                <input
                  value={i.fields[k] ?? ''}
                  onChange={e => set(i.key, x => ({ ...x, fields: { ...x.fields, [k]: e.target.value }, accept: { ...x.accept, [k]: true } }))}
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                />
              </label>
            ))}
            {i.parsed.price && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={!!i.accept.price} onChange={e => set(i.key, x => ({ ...x, accept: { ...x.accept, price: e.target.checked } }))} />
                <span className="w-20 shrink-0 text-xs text-muted-foreground">Price</span>
                <span className="text-sm">{i.parsed.price.text || `PKR ${i.parsed.price.amount.toLocaleString('en-PK')}`}</span>
              </label>
            )}
            {i.parsed.specs.weightG !== undefined && !i.fields.weight && <p className="pl-6 text-xs text-muted-foreground">Weight {i.parsed.specs.weightG} g was read but left off the design: check it, then type the specs line.</p>}
          </div>

          {i.parsed.warnings.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">{i.parsed.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>}

          <div className="mt-3 flex justify-end">
            <Button type="button" size="sm" onClick={() => { onParsed([resultOf(i)]); drop(i.key); }}><Check className="mr-1 h-4 w-4" /> Use this</Button>
          </div>
        </div>
      ))}

      {items.length > 1 && (
        <Button type="button" className="w-full" onClick={() => { onParsed(items.map(resultOf)); setItems([]); }}>
          <Check className="mr-1 h-4 w-4" /> Use all {items.length} pieces
        </Button>
      )}
    </div>
  );
}
