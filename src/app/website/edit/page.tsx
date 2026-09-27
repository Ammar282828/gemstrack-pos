'use client';

/**
 * Website → Edit a piece: any piece already on this house's website (taheri.shop,
 * or the House of Mina catalogue), changed from the counter.
 *
 * The photograph: re-made in the same editor Post a Piece uses for its squares —
 * crop and zoom (drag or pinch the photo), a filter, the weight and the house's
 * mark stamped on in the overlay tool's geometry (the square layouts), anything
 * else from the designer; Enhance or Ask AI. It keeps its own shape unless made
 * square. Editing always starts from the photograph as the site built it, and
 * the last design is kept, so a piece re-opens as it was left and a stamp is
 * never put on twice. The original stays on the site, to put back any time.
 *
 * The words: the name, the description, and the house's own facts — taheri.shop's
 * tags (stone, metal, karat, cut, style) or the catalogue's list — the weight, and
 * hiding a piece. The site takes the change at once (api/override.php); the piece
 * keeps its address, so favourites, bags and links still find it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Check, ExternalLink, EyeOff, History, ImageIcon, Loader2, MessageSquareText, PenLine, RotateCcw, Save, Search, Sparkles, Undo2, Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_BRAND, STORE_LINKS, STORE_SITE_EDIT, STORE_SITE_MARK_INK } from '@/lib/store-config';
import { weightLabel } from '@/lib/social/caption';
import { PALETTES, canvasToJpeg, loadImage, stampPhoto } from '@/lib/social/story';
import {
  SQUARE_FRAME, applySquarePreset, emptySquare, placementOf, reflow, renderDocTo,
  type Assets, type Bind, type Fields, type SquarePresetId, type StoryDoc,
} from '@/lib/social/editor';
import { diagnose } from '@/lib/social/diagnose';
import type { CheckResult } from '@/lib/social/prompts';
import { siteLayouts, siteStartLayout } from '@/lib/social/site-design';
import { SoloEditor, useStoryDoc } from '../post/story-editor';
import { FONTS, bodyFace, headlineFace } from '../post/fonts';
import { useSiteAssets } from '../post/site-assets';

// ── What the routes send ───────────────────────────────────────────────────

interface Words { name: string; about: string; facts: string[]; stone?: string; metal?: string; karat?: string; cut?: string; style?: string }
interface Change {
  name?: string; about?: string; facts?: string[]; stone?: string; metal?: string; karat?: string; cut?: string; style?: string;
  weightGrams?: number; weightOnPhoto?: boolean; hidden?: boolean;
  photo?: { image: string; v: string; edited: boolean; w?: number; h?: number }; at?: string;
}
interface Piece {
  id: string; name: string; url: string; image: string; thumb: string; collection: string;
  weightGrams: number | null; weightOnPhoto: boolean; facts: string[]; added: number | null;
  imagePath: string | null; source: 'pieces' | 'attributes'; own: Words; words: Words; change: Change | null; hidden: boolean;
  photoSource: string | null; sourceMarked: boolean;
}
interface Recent { key: string; name: string; what: string[]; by: string; at: string }
interface Saved { design: string; shape: 'own' | 'square'; ai: string[]; at: string; by: string }

const SITE = (STORE_LINKS.website || '').replace(/\/+$/, '');
/** The catalogue marks every photo itself (MINA, top right); taheri.shop's photos come marked or not. */
const MINA = STORE_BRAND === 'mina';
const SITE_NAME = SITE.replace(/^https?:\/\/(www\.)?/, '') || 'the website';
/** taheri.shop's tags, in the order the piece page shows them. */
const TAGS = [['stone', 'Stone'], ['metal', 'Metal'], ['karat', 'Karat'], ['cut', 'Cut'], ['style', 'Style']] as const;
type Tag = typeof TAGS[number][0];
const TEXT_KEYS = ['name', 'about', 'facts', 'stone', 'metal', 'karat', 'cut', 'style'] as const;

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
const validWeight = (w: string) => /^\d+(\.\d+)?$/.test(w.trim()) && Number(w) > 0 && Number(w) < 5000;
const photoEdited = (p: Piece) => !!p.change?.photo?.edited;
const wordsChanged = (p: Piece) => !!p.change && TEXT_KEYS.some(k => k in p.change!);
/** Anything the counter changed that still shows (a photo put back leaves only its version behind). */
const changed = (p: Piece) => photoEdited(p) || wordsChanged(p) || p.hidden || typeof p.change?.weightGrams === 'number';
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// ── The page ───────────────────────────────────────────────────────────────

export default function EditPieceRoute() {
  // A wrapper, so the page's own hooks never sit behind an early return.
  if (!STORE_SITE_EDIT || !SITE) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn't edit its website from here.</p>;
  return <EditPiecePage />;
}

type Filter = 'all' | 'changed' | 'hidden';
const PAGE = 60;

function EditPiecePage() {
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [pickId, setPickId] = useState<string | null>(null);
  // Bumped when a piece is put back, so its editor starts again from what the site now has.
  const [round, setRound] = useState(0);
  const listTop = useRef(0);

  const load = useCallback(async (fresh = false) => {
    setError(null);
    try {
      const res = await fetch(`/api/website/edits${fresh ? '?fresh=1' : ''}`, { headers: await authHeaders(), cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      setPieces(d.pieces); setRecent(d.recent ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // A piece opened from a link (?id=): straight into its editor.
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('id'); if (id) setPickId(id); }, []);

  const collections = useMemo(() => [...new Set((pieces ?? []).map(p => p.collection).filter(Boolean))].sort(), [pieces]);
  const counts = useMemo(() => ({
    changed: (pieces ?? []).filter(changed).length,
    hidden: (pieces ?? []).filter(p => p.hidden).length,
  }), [pieces]);
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (pieces ?? []).filter(p => (!collection || p.collection === collection)
      && (filter === 'all' ? true : filter === 'hidden' ? p.hidden : changed(p))
      && words.every(w => `${p.words.name} ${p.collection} ${p.facts.join(' ')} ${p.id}`.toLowerCase().includes(w)));
  }, [pieces, q, collection, filter]);
  useEffect(() => { setShown(PAGE); }, [q, collection, filter]);

  const pick = pieces?.find(p => p.id === pickId) ?? null;
  const open = (p: Piece) => { listTop.current = window.scrollY; setPickId(p.id); window.scrollTo({ top: 0 }); };
  const close = () => { setPickId(null); requestAnimationFrame(() => window.scrollTo({ top: listTop.current })); };
  const onSaved = (p: Piece, restart = false) => {
    setPieces(prev => prev?.map(x => x.id === p.id ? p : x) ?? prev);
    if (restart) setRound(n => n + 1);
    load();
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-5">
      {/* The editor's fonts, loaded for the canvas. */}
      <span aria-hidden className={cn(headlineFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(bodyFace.className, 'sr-only')}>.</span>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><PenLine className="mr-3 h-7 w-7" /> Edit a piece on {SITE_NAME}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Re-make a photo — crop it, put the weight and the logo on, fix the light — or change a piece’s name, description and details. It shows on the website within a minute; the original photo is kept to put back.
        </p>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{error} <button type="button" className="text-primary ml-2" onClick={() => load(true)}>Try again</button></div>}

      {pickId && !pick && pieces && (
        <div className="rounded-lg border p-4 text-sm">That piece isn’t on the website’s list. <button type="button" className="text-primary" onClick={close}>Back to every piece</button></div>
      )}
      {pick ? (
        <PieceEditor key={`${pick.id}:${round}`} piece={pick} onSaved={onSaved} onClose={close} />
      ) : !pickId && (
        <section className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — name, collection, ruby, Ring 12…" className="h-10 pl-9" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {([['all', 'Everything'], ['changed', `Changed here${counts.changed ? ` · ${counts.changed}` : ''}`], ['hidden', `Hidden${counts.hidden ? ` · ${counts.hidden}` : ''}`]] as [Filter, string][]).map(([f, label]) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap', filter === f ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{label}</button>
            ))}
            <span className="mx-1 w-px shrink-0 bg-border" />
            {['', ...collections].map(c => (
              <button key={c || 'every'} type="button" onClick={() => setCollection(c)}
                className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap', collection === c ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground')}>{c || 'Every collection'}</button>
            ))}
          </div>

          {!pieces && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading {SITE_NAME}…</div>}
          {pieces && <p className="text-xs text-muted-foreground">{filtered.length.toLocaleString()} of {pieces.length.toLocaleString()} pieces</p>}
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {filtered.slice(0, shown).map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => open(p)} className="group block w-full text-left rounded-lg border overflow-hidden hover:border-primary/60">
                  <span className="relative block aspect-square bg-muted">
                    <img src={p.thumb} alt="" loading="lazy" className={cn('h-full w-full object-cover', p.hidden && 'opacity-40')} />
                    <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                      {p.hidden && <span className="rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white inline-flex items-center gap-1"><EyeOff className="h-3 w-3" /> Hidden</span>}
                      {photoEdited(p) && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">New photo</span>}
                      {wordsChanged(p) && <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Words changed</span>}
                    </span>
                  </span>
                  <span className="block px-2 py-1.5">
                    <span className="block text-xs font-medium leading-tight line-clamp-2">{p.words.name}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{[p.collection, p.weightGrams ? `${p.weightGrams}g` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > shown && <Button variant="outline" className="w-full" onClick={() => setShown(n => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</Button>}

          {recent.length > 0 && (
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none flex items-center gap-2 font-medium"><History className="h-4 w-4" /> Recent changes</summary>
              <ul className="mt-2 space-y-1.5">
                {recent.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <button type="button" className="font-medium text-primary text-left" onClick={() => { const p = pieces?.find(x => x.id === r.key); if (p) open(p); }}>{r.name}</button>
                    <span className="text-muted-foreground">{r.what.join(', ')} · {r.by} · {when(r.at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

// ── One piece ──────────────────────────────────────────────────────────────

/** A photo the editor can draw: the website's (as it built it) or one AI made from it. */
interface EPhoto { id: string; img: HTMLImageElement; url: string; label: string }
const SITE_PHOTO = 'site';

/** The photo's own shape (1080 wide), or the square. */
function frameFor(shape: 'own' | 'square', img: HTMLImageElement | undefined) {
  if (shape === 'square' || !img?.naturalWidth) return SQUARE_FRAME;
  return { w: 1080, h: Math.round(Math.min(2, Math.max(0.5, img.naturalHeight / img.naturalWidth)) * 1080) };
}
const blankDoc = (shape: 'own' | 'square', img: HTMLImageElement | undefined): StoryDoc => ({
  ...emptySquare(), frame: frameFor(shape, img), bg: { ...emptySquare().bg, photoId: SITE_PHOTO },
});
/** A design to keep: always over the site's photo (an AI one isn't kept), and only its own crop. */
const toKeep = (d: StoryDoc): StoryDoc => ({
  ...d,
  bg: { ...d.bg, photoId: SITE_PHOTO },
  placements: { [SITE_PHOTO]: placementOf(d) },
  layers: d.layers.filter(l => l.kind !== 'image' || !!l.src),
});
const checkOk = (c: CheckResult | null | undefined) => !!c && c.samePiece && c.confidence >= 0.8;

async function fromBase64(data: string, mime: string): Promise<{ url: string; img: HTMLImageElement }> {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  return { url, img: await loadImage(url) };
}

function PieceEditor({ piece, onSaved, onClose }: { piece: Piece; onSaved: (p: Piece, restart?: boolean) => void; onClose: () => void }) {
  const { toast } = useToast();
  const tags = piece.source === 'attributes';

  // ── The words ──
  const [words, setWords] = useState<Words>(piece.words);
  const [factsText, setFactsText] = useState(piece.words.facts.join('\n'));
  const [weight, setWeight] = useState(piece.weightGrams ? String(piece.weightGrams) : '');
  const [hidden, setHidden] = useState(piece.hidden);
  const setWord = (k: keyof Words, v: string) => setWords(w => ({ ...w, [k]: v }));

  // ── The photo ──
  const [photos, setPhotos] = useState<EPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ design: Saved | null; original: string | null } | null>(null);
  const [shape, setShape] = useState<'own' | 'square'>('own');
  // The catalogue's photo comes to the editor before it was marked: the MINA mark goes back on by default.
  const [layout, setLayout] = useState<SquarePresetId>(siteStartLayout(STORE_BRAND, piece));
  const [ai, setAi] = useState<string[]>([]);
  const doc = useStoryDoc(blankDoc('own', undefined));
  const { marks, ready: fontsReady } = useSiteAssets();
  const [ready, setReady] = useState(false);
  const firstSig = useRef('');

  const [busy, setBusy] = useState<null | 'save' | 'photo' | 'all' | 'ai'>(null);
  const [confirm, setConfirm] = useState<null | 'save' | 'photo' | 'all'>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');

  const wLabel = weightLabel({ weight, weightEach: false });
  const details = tags
    ? [[words.karat, words.metal].filter(Boolean).join(' '), words.stone].filter(x => x && !/^none$/i.test(x)).join(' | ')
    : piece.facts.join(' | ');
  const fields: Fields = useMemo(() => ({ kicker: piece.collection, headline: words.name, weight: wLabel, details }), [piece.collection, words.name, wLabel, details]);
  const assets: Assets = useMemo(() => ({ photos: Object.fromEntries(photos.map(p => [p.id, p.img])), marks, fonts: FONTS, ...(STORE_SITE_MARK_INK ? { ink: STORE_SITE_MARK_INK } : {}) }), [photos, marks]);
  const current = photos.find(p => p.id === doc.doc.bg.photoId) ?? photos[0];
  const base = photos.find(p => p.id === SITE_PHOTO);

  // The piece's last design, and its photograph as the site built it (the original, when it was replaced).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const headers = await authHeaders();
        const [ir, pr] = await Promise.all([
          fetch(`/api/website/edits?id=${encodeURIComponent(piece.id)}`, { headers, cache: 'no-store' }),
          fetch(`/api/website/site-pieces/image?id=${encodeURIComponent(piece.id)}&original=1&size=3000&t=${Date.now()}`, { headers, cache: 'no-store' }),
        ]);
        const info = await ir.json().catch(() => ({}));
        if (!pr.ok) throw new Error((await pr.json().catch(() => ({}))).error || `The photograph didn’t come (${pr.status}).`);
        const url = URL.createObjectURL(await pr.blob());
        const img = await loadImage(url);
        if (!alive) { URL.revokeObjectURL(url); return; }
        setSaved({ design: ir.ok ? info.design ?? null : null, original: ir.ok ? info.original ?? null : null });
        setPhotos([{ id: SITE_PHOTO, img, url, label: 'The website’s photo' }]);
      } catch (e) {
        if (alive) setPhotoError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [piece.id]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach(p => URL.revokeObjectURL(p.url)); }, []);

  /** What the photo going up depends on: the design, and the words drawn on it. */
  const bound = doc.doc.layers.some(l => l.kind === 'text' && l.bind && !l.hidden);
  const sig = JSON.stringify([doc.doc, bound ? fields : null]);
  const photoChanged = ready && sig !== firstSig.current;
  const stamped = !!wLabel && doc.doc.layers.some(l => l.kind === 'text' && l.bind === 'weight' && !l.hidden);

  // The design starts as it was last left, or as the photo is (nothing added).
  useEffect(() => {
    if (ready || !fontsReady || !base || !saved) return;
    let d: StoryDoc | null = null;
    let sh: 'own' | 'square' = 'own';
    if (saved.design) {
      try {
        const kept = JSON.parse(saved.design.design) as StoryDoc;
        sh = saved.design.shape;
        d = { ...kept, frame: frameFor(sh, base.img), bg: { ...kept.bg, photoId: SITE_PHOTO } };
      } catch { d = null; }
    }
    d ??= applySquarePreset(blankDoc('own', base.img), layout, fields, assets);
    setShape(sh);
    doc.reset(d);
    firstSig.current = JSON.stringify([d, d.layers.some(l => l.kind === 'text' && l.bind && !l.hidden) ? fields : null]);
    setReady(true);
    if (saved.design?.ai.length) {
      toast({ title: `Last time: ${saved.design.ai.join(', ')}`, description: 'Editing starts from the original photo — run the AI again if you want it on this one.' });
    }
  }, [fontsReady, base, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseLayout = (id: SquarePresetId) => { setLayout(id); doc.change(d => applySquarePreset(d, id, fields, assets)); };
  const chooseShape = (s: 'own' | 'square') => {
    if (s === shape) return;
    setShape(s);
    doc.change(d => applySquarePreset({ ...d, frame: frameFor(s, base?.img) }, layout, fields, assets));
  };
  const LAYOUTS = siteLayouts(STORE_BRAND, !!marks.t);

  // ── AI on the photo ──
  const runAi = async (op: 'enhance' | 'custom', params: Record<string, unknown>, label: string) => {
    if (!current) return;
    setBusy('ai');
    try {
      const form = new FormData();
      form.set('op', op);
      form.set('params', JSON.stringify(params));
      form.append('image', await stampPhoto(current.img, { text: '', colour: 'auto', maxEdge: 2048 }), 'image-0.jpg');
      const res = await fetch('/api/website/post/ai', { method: 'POST', headers: await authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || `AI request failed (${res.status})`), { status: res.status });
      const { url, img } = await fromBase64(d.image.data, d.image.mimeType);
      const id = `ai-${Date.now().toString(36)}`;
      setPhotos(prev => [...prev, { id, img, url, label }]);
      // The new photo takes the old one's crop.
      doc.change(x => ({ ...x, bg: { ...x.bg, photoId: id }, placements: { ...x.placements, [id]: placementOf(x) } }));
      setAi(a => [...a, label]);
      if (!checkOk(d.check)) {
        toast({ title: d.check ? 'Check this one closely' : 'Could not check it', description: d.check?.differences?.[0] ?? 'Compare it with the original before saving.', variant: d.check ? 'destructive' : undefined });
      }
    } catch (e) {
      const dg = diagnose('ai', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // ── Saving ──
  const wordsNow = () => {
    const w: Record<string, unknown> = { name: words.name, about: words.about, hidden };
    if (tags) for (const [k] of TAGS) w[k] = words[k] ?? '';
    else w.facts = factsText.split('\n').map(s => s.trim()).filter(Boolean);
    w.weightGrams = validWeight(weight) ? Number(weight) : null;
    return w;
  };
  const post = async (form: FormData) => {
    const res = await fetch('/api/website/edits', { method: 'POST', headers: await authHeaders(), body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `The website didn’t take it (${res.status}).`);
    return d as { piece: Piece; note?: string };
  };
  const save = async () => {
    setBusy('save');
    try {
      const form = new FormData();
      form.set('id', piece.id);
      form.set('words', JSON.stringify(wordsNow()));
      if (photoChanged && current) {
        // The site's own size: 3000 px on taheri.shop (the catalogue makes its 2000 from it); never enlarged past the photo.
        const px = Math.max(1080, Math.min(3000, current.img.naturalWidth));
        const jpeg = await canvasToJpeg(renderDocTo(reflow(doc.doc, fields, assets), fields, assets, px), 0.92);
        form.set('file', new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }));
        form.set('stamped', stamped ? '1' : '0');
        form.set('design', JSON.stringify(toKeep(doc.doc)));
        form.set('shape', shape);
        form.set('ai', JSON.stringify(ai));
      }
      const d = await post(form);
      firstSig.current = sig;
      onSaved(d.piece);
      toast({
        title: d.note ?? `Saved on ${SITE_NAME}`,
        description: d.note ? undefined : photoChanged ? 'The new photo shows on the website within a minute. The original is kept — put it back any time.' : hidden ? 'The piece leaves the website within a minute.' : 'It shows on the website within a minute.',
      });
    } catch (e) {
      toast({ title: 'Not saved', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };
  const putBack = async (what: 'photo' | 'all') => {
    setBusy(what);
    try {
      const form = new FormData();
      form.set('id', piece.id);
      form.set(what === 'photo' ? 'photo' : 'action', 'revert');
      const d = await post(form);
      onSaved(d.piece, true);
      toast({ title: what === 'photo' ? 'The original photo is back' : 'Everything put back', description: `${SITE_NAME} shows the piece as it was built, within a minute.` });
    } catch (e) {
      toast({ title: 'Not put back', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const wordsDirty = words.name !== piece.words.name || words.about !== piece.words.about
    || (tags ? TAGS.some(([k]) => (words[k] ?? '') !== (piece.words[k] ?? '')) : factsText.trim() !== piece.words.facts.join('\n').trim())
    || hidden !== piece.hidden || (validWeight(weight) ? Number(weight) : null) !== (piece.weightGrams ?? null);
  const dirty = wordsDirty || photoChanged;
  const hasOriginal = !!saved?.original || photoEdited(piece);
  const busyAny = !!busy;

  /** A field the counter changed from what the site says, with a way back. */
  const own = (k: keyof Words) => {
    const was = piece.own[k];
    const now = k === 'facts' ? factsText.split('\n').map(s => s.trim()).filter(Boolean) : words[k];
    if (JSON.stringify(was ?? '') === JSON.stringify(now ?? '')) return null;
    return (
      <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 min-h-0"
        onClick={() => { if (k === 'facts') setFactsText((was as string[]).join('\n')); else setWord(k, String(was ?? '')); }}
        title={Array.isArray(was) ? was.join(' · ') : String(was || '(empty)')}>
        <Undo2 className="h-3 w-3" /> The site’s own
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1.5" /> Every piece</Button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight truncate">{piece.words.name}</p>
          <p className="text-xs text-muted-foreground truncate">{[piece.collection, piece.hidden ? 'hidden from the website' : '', changed(piece) && piece.change?.at ? `changed ${when(piece.change.at)}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        {piece.url && <Button asChild variant="outline" size="sm"><a href={piece.url} target="_blank" rel="noopener"><ExternalLink className="h-4 w-4 mr-1.5" /> On the website</a></Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── The photo ── */}
        <section className="rounded-xl border p-3 sm:p-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold flex items-center gap-2"><ImageIcon className="h-4 w-4" /> The photo</h2>
            <div className="inline-flex rounded-full border p-0.5 text-xs">
              {(['own', 'square'] as const).map(s => (
                <button key={s} type="button" onClick={() => chooseShape(s)} disabled={!ready} className={cn('rounded-full px-3 py-1 min-h-0', shape === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{s === 'own' ? 'Its own shape' : 'Square'}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium mb-1.5">On the photo</p>
            <div className="flex flex-wrap gap-1.5">
              {LAYOUTS.map(x => (
                <button key={x.id} type="button" disabled={!ready} onClick={() => chooseLayout(x.id)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs', layout === x.id ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>{x.label}</button>
              ))}
            </div>
            {MINA && piece.photoSource
              ? <p className="text-[11px] text-muted-foreground mt-1.5">{piece.sourceMarked
                ? 'This photo carries the house’s mark already — add nothing more, or clear it first (AI → “Enhance and clear old labels”).'
                : 'The photo as it was before the catalogue framed it and put the MINA mark on — the mark goes back top right, as on every catalogue photo.'}</p>
              : piece.weightOnPhoto && !piece.change?.weightOnPhoto && <p className="text-[11px] text-muted-foreground mt-1.5">This photo already shows its weight and logo — a stamp would show them twice, unless AI → “Enhance and clear old labels” first.</p>}
            {!['clean', 'mark', 'catalogue-t'].includes(layout) && !wLabel && <p className="text-[11px] text-amber-600 mt-1.5">Type the weight (on the right) to put it on.</p>}
          </div>

          {photoError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{photoError}</p>
          ) : (
            <SoloEditor side={{
              label: 'The photo', sub: `${shape === 'square' ? 'Square' : 'Its own shape'} · ${SITE_NAME}`,
              placeholder: ready ? undefined : (
                <div className="mx-auto flex aspect-square w-[300px] sm:w-[340px] items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching the photo…
                </div>
              ),
              tools: (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={busyAny}>{busy === 'ai' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} AI</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>On this photo (about a minute)</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => runAi('enhance', { tidy: false }, 'Enhanced')}><Wand2 className="h-4 w-4 mr-2" /> Enhance — light, sparkle, dust</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => runAi('enhance', { tidy: true }, 'Enhanced, labels cleared')}><Wand2 className="h-4 w-4 mr-2" /> Enhance and clear old labels</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setAskText(''); setAskOpen(true); }}><MessageSquareText className="h-4 w-4 mr-2" /> Ask AI…</DropdownMenuItem>
                    {photos.length > 1 && <DropdownMenuSeparator />}
                    {photos.length > 1 && photos.map(p => (
                      <DropdownMenuItem key={p.id} onClick={() => doc.change(d => ({ ...d, bg: { ...d.bg, photoId: p.id } }))}>
                        {current?.id === p.id ? <Check className="h-4 w-4 mr-2" /> : <span className="w-4 mr-2" />} Use: {p.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
              bottom: (
                <p className="text-[11px] text-muted-foreground">
                  Drag or pinch the photo to crop it; the corner of anything on it to size it. {current && current.id !== SITE_PHOTO ? `Using: ${current.label}.` : ''}
                </p>
              ),
              props: {
                api: doc, square: true, fields, assets,
                photos: photos.map(p => ({ id: p.id, url: p.url, label: p.label })),
                palette: PALETTES[0], onPalette: () => undefined, lettered: null, weightOwnLine: true, websiteLabel: SITE_NAME,
                onField: (b: Bind, v: string) => { if (b === 'headline') setWord('name', v); else if (b === 'weight') setWeight(v.replace(/[^\d.]/g, '')); },
                presets: LAYOUTS, onPreset: id => chooseLayout(id as SquarePresetId), previewPreset: id => applySquarePreset(doc.doc, id as SquarePresetId, fields, assets),
                fileName: (piece.url.split('/').filter(Boolean).pop() || 'piece'),
                cropLabel: shape === 'square' ? 'Crop to square' : 'Fill the frame',
                photoNote: 'The photo as the website built it, and any AI version of it. Drag or pinch it to choose what shows.',
              },
            }} />
          )}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <p className={cn('text-xs flex-1 min-w-[10rem]', photoChanged ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {photoChanged ? 'The photo will be replaced when you save.' : photoEdited(piece) ? 'The website shows a photo made here.' : 'The website’s photo, unchanged.'}
            </p>
            {hasOriginal && <Button variant="ghost" size="sm" disabled={busyAny} onClick={() => setConfirm('photo')}>{busy === 'photo' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1.5" />} Put the original back</Button>}
          </div>
        </section>

        {/* ── The words ── */}
        <section className="rounded-xl border p-3 sm:p-4 space-y-3 self-start lg:sticky lg:top-4">
          <h2 className="font-semibold">What the website says</h2>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><Label htmlFor="name">Name</Label>{own('name')}</div>
            <Input id="name" value={words.name} onChange={e => setWord('name', e.target.value)} maxLength={160} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><Label htmlFor="about">Description</Label>{own('about')}</div>
            <Textarea id="about" value={words.about} onChange={e => setWord('about', e.target.value)} rows={5} maxLength={4000}
              placeholder={tags ? 'A few lines about the piece, shown on its page.' : 'The piece in the house’s words. A blank line starts a new paragraph.'} />
          </div>
          {tags ? (
            <div className="grid grid-cols-2 gap-2">
              {TAGS.map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <div className="flex items-center justify-between gap-1"><Label htmlFor={k} className="text-xs">{label}</Label>{own(k as Tag)}</div>
                  <Input id={k} value={words[k] ?? ''} onChange={e => setWord(k, e.target.value)} maxLength={k === 'karat' ? 8 : 80} className="h-9" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2"><Label htmlFor="facts">Details <span className="font-normal text-muted-foreground">(one per line)</span></Label>{own('facts')}</div>
              <Textarea id="facts" value={factsText} onChange={e => setFactsText(e.target.value)} rows={4} placeholder={'Stone: Emerald\nSetting: Prong'} />
            </div>
          )}
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="weight">Weight</Label>
              <div className="flex items-center gap-1">
                <Input id="weight" value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.currentTarget.select()} inputMode="decimal" placeholder="0.00" className="h-9 w-24 text-right tabular-nums" />
                <span className="text-sm text-muted-foreground">g</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground pb-1.5 flex-1">
              {tags ? 'Prices follow it; the site shows it on photos without one.' : 'For the photo and captions; the catalogue doesn’t print weights.'}
            </p>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <span><span className="font-medium">Hide from the website</span><span className="block text-[11px] text-muted-foreground">Off every page; its links go to the collection. Show it again any time.</span></span>
            <Switch checked={hidden} onCheckedChange={setHidden} />
          </label>

          <div className="sticky bottom-0 -mx-3 sm:-mx-4 -mb-3 sm:-mb-4 rounded-b-xl border-t bg-background/95 backdrop-blur px-3 sm:px-4 py-3 space-y-2">
            <Button className="h-11 w-full" disabled={!dirty || busyAny || !words.name.trim()} onClick={() => setConfirm('save')}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              {dirty ? `Save to ${SITE_NAME}` : 'Nothing changed yet'}
            </Button>
            {changed(piece) && (
              <button type="button" disabled={busyAny} onClick={() => setConfirm('all')} className="w-full text-center text-xs text-muted-foreground hover:text-destructive min-h-0">
                {busy === 'all' ? 'Putting everything back…' : 'Undo every change to this piece'}
              </button>
            )}
          </div>
        </section>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'save' ? `Change it on ${SITE_NAME}?` : confirm === 'photo' ? 'Put the original photo back?' : 'Undo every change to this piece?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirm === 'save' && (
                  <ul className="list-disc pl-5 space-y-0.5">
                    {photoChanged && <li>The photo is replaced{stamped ? `, with ${wLabel} on it` : ''}{ai.length ? ` (${ai.join(', ').toLowerCase()})` : ''}. The original is kept.</li>}
                    {words.name !== piece.words.name && <li>Name: “{words.name.trim()}”</li>}
                    {words.about !== piece.words.about && <li>A new description</li>}
                    {tags && TAGS.filter(([k]) => (words[k] ?? '') !== (piece.words[k] ?? '')).map(([k, label]) => <li key={k}>{label}: {words[k] || '(none)'}</li>)}
                    {!tags && factsText.trim() !== piece.words.facts.join('\n').trim() && <li>New details</li>}
                    {(validWeight(weight) ? Number(weight) : null) !== (piece.weightGrams ?? null) && <li>Weight: {validWeight(weight) ? `${weight}g` : 'none'}</li>}
                    {hidden !== piece.hidden && <li>{hidden ? 'Hidden from the website' : 'Shown on the website again'}</li>}
                  </ul>
                )}
                {confirm === 'photo' && <p>The website shows the photo as it was built. Your design is forgotten; the words stay as they are.</p>}
                {confirm === 'all' && <p>The photo, the name, the words and hiding all go back to what the website was built with. {tags ? 'A weight typed here stays (it’s the piece’s weight).' : ''}</p>}
                <p className="text-xs">Pages opened from about a minute later show it; the next deploy writes it into the pages search engines read.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm; setConfirm(null); if (c === 'save') save(); else if (c) putBack(c); }}>
              {confirm === 'save' ? 'Save' : 'Put it back'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={askOpen} onOpenChange={setAskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask AI to change the photo</DialogTitle>
            <DialogDescription>Say what to change — the piece itself stays as it is, and the result is checked against it.</DialogDescription>
          </DialogHeader>
          <Textarea value={askText} onChange={e => setAskText(e.target.value)} rows={4} placeholder="Make the background plain white · remove the stand · warmer light" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAskOpen(false)}>Cancel</Button>
            <Button disabled={!askText.trim()} onClick={() => { setAskOpen(false); runAi('custom', { instruction: askText.trim() }, 'Changed with AI'); }}><Sparkles className="h-4 w-4 mr-1.5" /> Make it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

