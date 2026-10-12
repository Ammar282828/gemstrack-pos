'use client';

/**
 * Resize (docs/features/design-studio-plan.md §3.3): pick sizes, see every result drawn by the engine, keep the ones
 * you want. The deterministic re-layout (lib/design/resize.ts) answers at once and needs no AI; "Smart" asks the
 * route once for all sizes and uses a plan only when it scores at least as well. The photograph is only re-framed here:
 * a shape the piece can't fill says so, and "Extend the photo" is the existing reframe op, run only when pressed and
 * kept only if the same-piece check agrees.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Maximize2, Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { customFormat, nearestAiRatio, type RateBoard } from '@/lib/ads/studio/templates';
import { frameOf, reflow, renderDoc, type Assets, type Box01, type Fields, type StoryDoc } from '@/lib/social/editor';
import { loadImage, type Frame } from '@/lib/social/story';
import { SIZE_GROUPS, presetsIn, sizePreset, type SizeGroup, type SizePreset } from '@/lib/design/sizes';
import { mergePlan, planOf, summariseLayers, type ResizeAiResponse } from '@/lib/design/resize-ai';
import { pageOf, resizeOne, swapPhoto, type ResizedPage, type ResizeResult } from '@/lib/design/resize';
import { makeMeasure } from '@/lib/design/score';
import { overlayRects, safeKindsFor } from '@/lib/design/safe';
import { authHeaders } from '../ads/ads-kit';
import { runImageOp } from '../ads/studio/studio-kit';

export interface ResizeSheetProps {
  doc: StoryDoc;
  fields: Fields;
  assets: Assets;
  /** Where the piece is in the photograph, 0…1. */
  subject?: Box01;
  /** Called with the pages the person kept: origin 'resized', each tied to `master`. */
  onCreate: (pages: ResizedPage[]) => void;
  /** The page these are made from (their `syncedFrom`). */
  master?: string;
  rates?: RateBoard | null;
  photoMarked?: boolean;
  /** The photograph as a file, for "Extend the photo" (the button shows only with this and `onPhoto`). */
  photoBlob?: () => Promise<Blob>;
  /** A photograph the AI extended and the person kept, to be put in the design's library under this id. */
  onPhoto?: (id: string, blob: Blob) => void;
  onClose?: () => void;
  className?: string;
}

const GROUP_LABEL: Record<SizeGroup, string> = { ads: 'Ads', whatsapp: 'WhatsApp', website: 'Website', story: 'Story', more: 'More shapes' };

interface Entry { id: string; label: string; ratio: string; frame: Frame; format?: string }
interface Extra { assets: Assets; doc: StoryDoc; photoId: string; blob: Blob }

const entryOfPreset = (p: SizePreset): Entry => ({ id: p.id, label: p.label, ratio: p.ratio, frame: p.frame, format: p.format });
const sameFrame = (a: Frame, b: Frame) => a.w === b.w && a.h === b.h;

/** The result drawn by the engine, small. */
function Thumb({ doc, fields, assets, safe }: { doc: StoryDoc; fields: Fields; assets: Assets; safe: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const f = frameOf(doc);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    try {
      const px = 360;
      c.width = px; c.height = Math.max(1, Math.round(px * (f.h / f.w)));
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.setTransform(px / f.w, 0, 0, px / f.w, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      renderDoc(ctx, reflow(doc, fields, assets), fields, assets);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [doc, fields, assets, f.w, f.h]);
  return (
    <div className="relative w-full overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: `${f.w} / ${f.h}` }}>
      <canvas ref={ref} className="h-full w-full" aria-label={`Preview, ${f.w} by ${f.h}`} />
      {failed && <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">Can’t preview this one</div>}
      {safe && overlayRects(f).map((b, i) => (
        <div key={i} className="pointer-events-none absolute bg-black/35" style={{ left: `${(b.x / f.w) * 100}%`, top: `${(b.y / f.h) * 100}%`, width: `${(b.w / f.w) * 100}%`, height: `${(b.h / f.h) * 100}%` }} />
      ))}
    </div>
  );
}

const scoreTone = (n: number) => (n >= 85 ? 'text-emerald-600' : n >= 70 ? 'text-amber-600' : 'text-rose-600');

export function ResizeSheet({ doc, fields, assets, subject, onCreate, master, rates, photoMarked, photoBlob, onPhoto, onClose, className }: ResizeSheetProps) {
  const { toast } = useToast();
  const own = useMemo(() => frameOf(doc), [doc]);
  const [picked, setPicked] = useState<string[]>([]);
  const [customs, setCustoms] = useState<Entry[]>([]);
  const [cw, setCw] = useState('');
  const [ch, setCh] = useState('');
  const [smart, setSmart] = useState(false);
  const [busy, setBusy] = useState<'laying' | 'asking' | null>(null);
  const [results, setResults] = useState<Record<string, ResizeResult>>({});
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  const [extending, setExtending] = useState<string | null>(null);
  const [safe, setSafe] = useState(false);
  const [note, setNote] = useState('');
  const run = useRef(0);

  const entries = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const g of Object.keys(SIZE_GROUPS) as SizeGroup[]) for (const p of presetsIn(g)) m.set(p.id, entryOfPreset(p));
    for (const c of customs) m.set(c.id, c);
    return m;
  }, [customs]);

  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const addCustom = () => {
    const w = Number(cw), h = Number(ch);
    if (!(w > 0 && h > 0) || w > 10_000 || h > 10_000) { toast({ title: 'Give a width and a height', description: 'For example 7 and 3, or 1200 and 628.', variant: 'destructive' }); return; }
    const f = customFormat(w, h);
    const id = `custom-${f.short}`;
    if (!customs.some(c => c.id === id)) setCustoms(c => [...c, { id, label: f.label, ratio: f.short, frame: f.frame, format: 'custom' }]);
    setPicked(p => (p.includes(id) ? p : [...p, id]));
    setCw(''); setCh('');
  };

  const jpegOf = useCallback((d: StoryDoc, px = 256): string | undefined => {
    try {
      const f = frameOf(d);
      const c = document.createElement('canvas');
      c.width = px; c.height = Math.round(px * (f.h / f.w));
      const ctx = c.getContext('2d');
      if (!ctx) return undefined;
      ctx.setTransform(px / f.w, 0, 0, px / f.w, 0, 0);
      renderDoc(ctx, reflow(d, fields, assets), fields, assets);
      return c.toDataURL('image/jpeg', 0.6).split(',')[1];
    } catch { return undefined; }
  }, [fields, assets]);

  /** The plain layouts: at once, no AI. Then, if asked, the smart pass over all of them. */
  const resizeAll = async () => {
    const chosen = picked.map(id => entries.get(id)).filter((e): e is Entry => !!e);
    if (!chosen.length) { toast({ title: 'Pick a size first' }); return; }
    const mine = ++run.current;
    setBusy('laying'); setNote(''); setExtras({});
    await new Promise(r => setTimeout(r, 0));
    let next: Record<string, ResizeResult> = {};
    try {
      const m = makeMeasure(fields, assets);
      for (const e of chosen) next[e.id] = resizeOne(doc, fields, assets, e.frame, { subject, rates, photoMarked, measure: m });
    } catch (err) {
      setBusy(null);
      toast({ title: 'That didn’t resize', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      return;
    }
    setResults(next); setKept(Object.fromEntries(chosen.map(e => [e.id, true])));
    if (!smart) { setBusy(null); return; }

    setBusy('asking');
    try {
      const m = makeMeasure(fields, assets);
      const res = await fetch('/api/design/resize', {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { frame: own, layers: summariseLayers(doc, fields, m), thumb: jpegOf(doc) },
          targets: chosen.map(e => {
            const r = next[e.id];
            return { frame: r.frame, score: r.score, problems: r.penalties.map(p => p.why), layers: summariseLayers(r.doc, fields, m), plan: planOf(r, fields, m), thumb: jpegOf(r.doc) };
          }),
        }),
      });
      const d = (await res.json().catch(() => null)) as ResizeAiResponse | null;
      if (mine !== run.current) return;
      if (!res.ok || !d || !Array.isArray(d.plans)) throw new Error('no answer');
      const merged: Record<string, ResizeResult> = {};
      chosen.forEach((e, i) => { merged[e.id] = mergePlan(next[e.id], d.plans[i] ?? null, fields, assets, { subject, measure: m }); });
      setResults(merged);
      const used = chosen.filter(e => merged[e.id].strategy === 'ai').length;
      setNote(d.ai ? (used ? `The AI refined ${used} of ${chosen.length}; the rest keep the plain layout.` : 'The AI had nothing better, so the plain layouts stay.') : 'Smart layouts weren’t available just now; these are the plain ones.');
    } catch {
      if (mine === run.current) setNote('Smart layouts weren’t available just now; these are the plain ones.');
    } finally {
      if (mine === run.current) setBusy(null);
    }
  };

  const photoIdOf = (): string => doc.bg.photoId ?? (doc.layers.find(l => l.kind === 'image' && !l.src) as { photoId?: string } | undefined)?.photoId ?? 'photo';

  /** The existing reframe op, on the photograph, for one shape — only when pressed, and kept only if it is the same piece. */
  const extend = async (id: string) => {
    const e = entries.get(id);
    if (!e || !photoBlob || !onPhoto) return;
    setExtending(id);
    try {
      const blob = await photoBlob();
      const r = await runImageOp(blob, 'reframe', { aspect: nearestAiRatio(e.frame.w, e.frame.h), tidy: false });
      if (r.check && !r.check.samePiece) {
        toast({ title: 'Kept your photo', description: `The AI changed the piece: ${r.check.differences.slice(0, 2).join('; ') || 'the check says it is not the same'}.`, variant: 'destructive' });
        return;
      }
      const img = await loadImage(r.blob);
      const from = photoIdOf();
      const photoId = `${from}-x${Date.now().toString(36)}`;
      const a2: Assets = { ...assets, photos: { ...assets.photos, [photoId]: img } };
      const d2 = swapPhoto(doc, from, photoId);
      const again = resizeOne(d2, fields, a2, e.frame, { subject, rates, photoMarked });
      setExtras(x => ({ ...x, [id]: { assets: a2, doc: d2, photoId, blob: r.blob } }));
      setResults(x => ({ ...x, [id]: { ...again, notes: ['The photo extended to fill this shape, and checked as the same piece.', ...again.notes] } }));
    } catch (err) {
      toast({ title: 'The photo couldn’t be extended', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setExtending(null);
    }
  };

  const ids = picked.filter(id => results[id]);
  const accepted = ids.filter(id => kept[id]);

  const accept = () => {
    if (!accepted.length) return;
    const pages = accepted.map(id => {
      const e = entries.get(id)!;
      const ex = extras[id];
      if (ex) onPhoto?.(ex.photoId, ex.blob);
      return pageOf(results[id], { format: e.format, label: e.label, master });
    });
    onCreate(pages);
  };

  const showSafe = ids.some(id => safeKindsFor(results[id].frame).length > 0);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Resize</h3>
          <p className="text-xs text-muted-foreground">Make this design in other sizes. The words and the photo stay; the layout follows the new shape.</p>
        </div>
        {onClose && <Button type="button" variant="ghost" size="icon" className="h-8 w-8 min-h-0 rounded-full" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>}
      </div>

      {(Object.keys(SIZE_GROUPS) as SizeGroup[]).map(g => (
        <div key={g} className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{GROUP_LABEL[g]}</div>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_GROUPS[g].map(pid => {
              const p = sizePreset(pid);
              if (!p) return null;
              const on = picked.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                  className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {p.label}{sameFrame(p.frame, own) ? ' (this)' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your own shape</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input inputMode="decimal" value={cw} onChange={e => setCw(e.target.value)} placeholder="W" aria-label="Width" className="h-9 w-20" />
          <span className="text-muted-foreground">:</span>
          <Input inputMode="decimal" value={ch} onChange={e => setCh(e.target.value)} placeholder="H" aria-label="Height" className="h-9 w-20"
            onKeyDown={e => { if (e.key === 'Enter') addCustom(); }} />
          <Button type="button" size="sm" variant="outline" className="h-9 gap-1 min-h-0" onClick={addCustom}><Plus className="h-3.5 w-3.5" />Add</Button>
          {customs.map(c => {
            const on = picked.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={on}
                className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{c.label}</button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={smart} onCheckedChange={setSmart} aria-label="Smart" />
          <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />Smart</span>
        </label>
        <span className="text-xs text-muted-foreground">{smart ? 'Asks the AI once for all sizes; used only where it does better.' : 'Instant, no AI.'}</span>
        <Button type="button" className="ml-auto gap-1.5" disabled={!picked.length || !!busy} onClick={resizeAll}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}
          {busy === 'asking' ? 'Asking the AI…' : busy === 'laying' ? 'Laying out…' : `Resize${picked.length ? ` (${picked.length})` : ''}`}
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      {ids.length > 0 && (
        <div className="space-y-3">
          {showSafe && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={safe} onCheckedChange={setSafe} aria-label="Show safe zones" />Show safe zones
            </label>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {ids.map(id => {
              const r = results[id], e = entries.get(id)!, ex = extras[id];
              const on = !!kept[id];
              return (
                <div key={id} className={cn('space-y-1.5 rounded-lg border p-2', on ? 'border-primary' : 'opacity-70')}>
                  <button type="button" className="block w-full min-h-0" onClick={() => setKept(k => ({ ...k, [id]: !k[id] }))} aria-pressed={on} aria-label={`${on ? 'Skip' : 'Keep'} ${e.label}`}>
                    <Thumb doc={r.doc} fields={fields} assets={ex?.assets ?? assets} safe={safe} />
                  </button>
                  <div className="flex items-center justify-between gap-1 text-xs">
                    <span className="truncate font-medium" title={e.label}>{e.label}</span>
                    <span className={cn('tabular-nums', scoreTone(r.score))} title={r.penalties.map(p => p.why).join('; ') || 'Nothing wrong found'}>{Math.round(r.score)}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">{r.notes[0]}</p>
                  {r.needsExtend && !ex && (
                    <div className="space-y-1">
                      <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">The piece doesn’t fill this shape; the photo is shown whole.</p>
                      {photoBlob && onPhoto && (
                        <Button type="button" size="sm" variant="outline" className="h-7 w-full gap-1 text-[11px] min-h-0" disabled={extending === id} onClick={() => extend(id)}>
                          {extending === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Extend the photo
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">{accepted.length} of {ids.length} kept</span>
            <Button type="button" className="gap-1.5" disabled={!accepted.length || !!busy} onClick={accept}><Check className="h-4 w-4" />Add {accepted.length} size{accepted.length === 1 ? '' : 's'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ResizeSheet;
