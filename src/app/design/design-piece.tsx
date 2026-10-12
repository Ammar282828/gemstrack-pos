'use client';

/**
 * The piece card (plan §5.2): everything about the design that isn't on the canvas — its words, its photograph
 * and the AI that works on it, and the checks before it goes. The same three panels sit in the designer's rail
 * (DesignerExtras) and in the column beside the editor, so they are written once.
 *
 *   Words      kicker / headline / specs / call to action (the fields every page shares), and — for those who
 *              may use the ad studio — the model writing them in the house's voice (/api/ads/studio/copy)
 *   Pictures   the photograph: another one, one from this device, and the image AI (logo and labels off,
 *              extend to the page's shape, retouch), each checked as the same piece before it is used
 *   Check      the house's rules on the words here and now; for owner and marketing the full pre-flight
 *              (/api/ads/studio/check) on the master page
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, MessageSquareText, Palette as PaletteIcon, Scissors, ShieldAlert, ShieldCheck, Sparkles, Undo2, Upload, Wand2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { newImageLayer, type Bind } from '@/lib/social/editor';
import { blobToDataUrl } from '@/lib/design/publish';
import { authHeaders } from '../ads/ads-kit';
import { AD_FORMATS, safeZone } from '@/lib/ads/studio/templates';
import { VOICE } from '@/lib/ads/studio/brand';
import { inventedFigures, type CheckVerdict, type CopyResult } from '@/lib/ads/studio/prompts';
import { kindLabel } from './design-state';
import { api } from '../ads/ads-kit';
import { scoreTone } from './studio-kit';
import { AiPanel, CaptionSection, POST_AI_ON, TidyToggle, useAiActions } from './ai-tools';
import { readImageFile } from './image-file';
import type { DesignApi } from './use-design';

const FIELD_ROWS: [Bind, string, string, number][] = [
  ['kicker', 'Kicker', 'The Emerald Edit', 60],
  ['headline', 'Headline', '', 140],
  ['weight', 'Specs', '21K Yellow Gold · Ruby · 45.35g', 120],
  ['details', 'Button line', '', 80],
];

const input = 'h-9 text-base sm:text-sm';

// ── Words ──────────────────────────────────────────────────────────────────

export function WordsPanel({ design, adsOk }: { design: DesignApi; adsOk: boolean }) {
  const { toast } = useToast();
  const actions = useAiActions(design, adsOk);
  const w = design.work!;
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<CopyResult | null>(null);
  const write = async () => {
    setBusy(true);
    try {
      const r = await api<CopyResult>('/api/ads/studio/copy', { body: {
        name: w.name || w.fields.headline, subject: '', category: '', collection: '', brief, goal: 'WhatsApp conversations', specs: w.fields.weight, price: w.copy.price ?? '',
      } });
      setCopy(r);
    } catch (e) {
      toast({ title: 'Couldn’t write the words', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {FIELD_ROWS.map(([b, name, hint, max]) => (
        <label key={b} className="block space-y-0.5">
          <span className="text-[11px] text-muted-foreground">{name}</span>
          <Input value={w.fields[b]} maxLength={max} placeholder={hint} onChange={e => design.patchFields({ [b]: e.target.value })} className={input} />
        </label>
      ))}
      <div className="flex flex-wrap gap-1">
        {VOICE.ctas.map(c => (
          <button key={c} type="button" onClick={() => design.patchFields({ details: c.replace(/\.$/, '') })} className="min-h-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{c.replace(/\.$/, '')}</button>
        ))}
      </div>
      <label className="block space-y-0.5">
        <span className="text-[11px] text-muted-foreground">Price (optional)</span>
        <Input value={w.copy.price ?? ''} maxLength={40} onChange={e => design.actions.setCopy({ price: e.target.value })} className={input} />
      </label>
      {w.copy.price?.trim() && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">A rupee price goes stale as the gold rate moves.</p>
      )}

      {adsOk && (
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
          <p className="flex items-center gap-1 text-xs font-medium"><Sparkles className="h-3.5 w-3.5" /> Write with AI</p>
          <Input value={brief} onChange={e => setBrief(e.target.value)} placeholder="Aim (optional) — e.g. Eid gifting" className="h-8 text-base sm:text-xs" />
          <Button size="sm" variant="outline" className="w-full" disabled={busy || !w.fields.headline.trim()} onClick={write}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />} {copy ? 'Write again' : 'Write the words'}
          </Button>
          {copy && (
            <div className="space-y-1.5 text-xs">
              {(copy.onImage.kicker || copy.onImage.headline || copy.onImage.details) && (
                <button type="button" className="min-h-0 w-full rounded-md border bg-background p-2 text-left hover:border-primary"
                  onClick={() => design.patchFields({ kicker: copy.onImage.kicker || w.fields.kicker, headline: copy.onImage.headline || w.fields.headline, details: copy.onImage.details || w.fields.details })}>
                  {copy.onImage.kicker && <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{copy.onImage.kicker}</span>}
                  <span className="block font-semibold">{copy.onImage.headline}</span>
                  {copy.onImage.details && <span className="block text-muted-foreground">{copy.onImage.details}</span>}
                  <span className="mt-1 block text-[10px] text-primary">Use all three</span>
                </button>
              )}
              <div className="flex flex-wrap gap-1">
                {copy.headlines.slice(0, 6).map(h => <button key={h} type="button" onClick={() => design.patchFields({ headline: h.slice(0, 140) })} className="min-h-0 rounded-full border px-2 py-0.5 text-[11px] hover:border-primary">{h}</button>)}
              </div>
              {copy.primaryText[0] && (
                <button type="button" className="min-h-0 block w-full rounded-md border bg-background p-2 text-left text-[11px] text-muted-foreground hover:border-primary" onClick={() => design.actions.setCopy({ adText: copy.primaryText[0], adHeadline: copy.headlines[0] ?? w.copy.adHeadline })}>
                  {copy.primaryText[0]} <span className="text-primary">— use as the ad’s text</span>
                </button>
              )}
              {copy.why && <p className="text-[10px] italic text-muted-foreground">{copy.why}</p>}
            </div>
          )}
        </div>
      )}

      {w.kind !== 'ad' && (
        <div className="space-y-1.5 border-t pt-3">
          <CaptionSection design={design} actions={actions} />
        </div>
      )}

      {(w.kind === 'ad' || !!w.copy.adText) && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">The ad’s own words</p>
          <Textarea value={w.copy.adText ?? ''} rows={3} maxLength={2000} placeholder="Primary text" onChange={e => design.actions.setCopy({ adText: e.target.value })} className="text-base sm:text-sm" />
          <Input value={w.copy.adHeadline ?? ''} maxLength={60} placeholder="Headline" onChange={e => design.actions.setCopy({ adHeadline: e.target.value })} className={input} />
        </div>
      )}
    </div>
  );
}

// ── Pictures ───────────────────────────────────────────────────────────────

export function PicturesPanel({ design, adsOk, onAnother }: { design: DesignApi; adsOk: boolean; onAnother: () => void }) {
  const { toast } = useToast();
  const actions = useAiActions(design, adsOk);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLInputElement>(null);
  const page = design.activePage;
  const photo = design.photo;
  const lock = !photo || !!busy || !!design.aiBusy;
  const aiNote = photo?.ai;
  const doubtful = aiNote?.check && !(aiNote.check.samePiece && aiNote.check.confidence >= 0.8);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    try { const r = await readImageFile(f); await design.replacePhoto(r.blob, r.name); }
    catch (err) { toast({ title: 'Couldn’t read that photo', description: err instanceof Error ? err.message : String(err), variant: 'destructive' }); }
  };

  /**
   * Remove background: the piece cut out of the photograph (Magnific, a PNG with alpha) and laid on this page as a
   * picture layer, over the house's ground, where the photograph was. Nothing is drawn by the AI, so no same-piece
   * check; the photograph itself is kept (Layers → hide the piece to see it again, or lay the page out again).
   */
  const cutOut = async () => {
    if (!photo || !page || busy) return;
    setBusy('cutout');
    try {
      const form = new FormData();
      form.append('file', photo.blob, 'photo.jpg');
      const res = await fetch('/api/design/remove-background', { method: 'POST', headers: await authHeaders(), body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `The cut-out didn’t come (${res.status}).`);
      const src = await blobToDataUrl(await res.blob());
      const f = page.frame, pl = page.doc.bg.placement;
      const ar = photo.img.naturalWidth / photo.img.naturalHeight;
      const cover = Math.max(f.w, f.h * ar) * (pl.mode === 'fit' ? 1 : Math.max(1, pl.zoom || 1));
      const dw = cover, dh = cover / ar;
      const layer = { ...newImageLayer('cutout'), src, x: Math.round((f.w - dw) * (pl.focusX ?? 0.5)), y: Math.round((f.h - dh) * (pl.focusY ?? 0.5)), w: Math.round(dw), h: Math.round(dh), radius: 0, border: null, shadow: false, cutout: true, name: 'Piece' };
      design.actions.setDoc(page.id, { ...page.doc, bg: { ...page.doc.bg, photoId: null }, layers: [layer, ...page.doc.layers], meta: { ...page.doc.meta } });
      toast({ title: 'Background removed', description: 'The piece is a layer on the house’s ground. No part of it was redrawn.' });
    } catch (e) {
      toast({ title: 'The background wasn’t removed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const ai = (label: string, run: () => void, icon: React.ReactNode, title?: string) => (
    <Button size="sm" variant="outline" className="h-auto min-h-8 justify-start whitespace-normal py-1 text-left text-xs" disabled={lock || !POST_AI_ON} onClick={run} title={title}>
      {icon}{label}
    </Button>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {photo ? <img src={photo.url} alt={photo.label} className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-medium">{photo?.label ?? 'No photograph'}</p>
          {aiNote && (
            <p title={aiNote.check?.differences.join('\n') || ''} className={cn('flex items-start gap-1 text-[11px]', doubtful ? 'text-amber-600' : 'text-emerald-600')}>
              {aiNote.check ? (doubtful ? <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {aiNote.check.differences[0] ?? 'Look closely'}</> : <><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Same piece</>)
                : <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not checked</>}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={onAnother}><ImagePlus className="mr-1 h-4 w-4" /> Another</Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" /> From this device</Button>
            <Button size="sm" variant="outline" className="sm:hidden" onClick={() => cameraRef.current?.click()} aria-label="Take a photo">Camera</Button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; await choose(f); }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; await choose(f); }} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium">More photos of this piece</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => moreRef.current?.click()}><ImagePlus className="mr-1 h-3.5 w-3.5" /> Add</Button>
        </div>
        {design.moreIds.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {design.moreIds.map(id => (
              <li key={id} className="relative">
                <img src={design.extra[id]?.url} alt={design.extra[id]?.label ?? ''} className="h-12 w-12 rounded-md border object-cover" />
                <button type="button" aria-label="Take this photo out" onClick={() => design.removeMore(id)} className="absolute -right-1 -top-1 flex h-4 min-h-0 w-4 items-center justify-center rounded-full bg-foreground text-[10px] text-background">×</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground">{design.moreIds.length ? 'Publish sends each to the website and WhatsApp as a square of its own, on the same page design.' : 'Other angles of the same piece go out with it as squares of their own.'}</p>
        <input ref={moreRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={async e => {
          const list = Array.from(e.target.files ?? []); e.target.value = '';
          try { await design.addMore(list); } catch (err) { toast({ title: 'Couldn’t read a photo', description: err instanceof Error ? err.message : String(err), variant: 'destructive' }); }
        }} />
      </div>
      <div className="space-y-1.5 rounded-lg bg-muted/40 p-2">
        <p className="flex items-center gap-1 text-[11px] font-medium"><Wand2 className="h-3.5 w-3.5" /> With AI — the piece stays as it is</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ai('Enhance — clean, colour, sparkle', () => void actions.photo({ op: 'enhance' }), <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0" />, 'About a minute')}
          {ai('Logo and labels off', () => void actions.photo({ op: 'clean' }), <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0" />, 'About a minute')}
          {ai('Extend to this shape', () => void actions.photo({ op: 'extend' }), <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0" />, 'About a minute')}
          {ai('Retouch — piece, background, light', () => void actions.photo({ op: 'retouch' }), <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0" />, 'GPT Image + Magnific Precision, about two minutes')}
          {ai('New setting…', () => design.setAiDialog('setting'), <PaletteIcon className="mr-1 h-3.5 w-3.5 shrink-0" />, 'Photograph it again in one of the shop’s settings')}
          {ai('Ask AI… (anything, in your words)', () => design.setAiDialog('ask'), <MessageSquareText className="mr-1 h-3.5 w-3.5 shrink-0" />)}
          <Button size="sm" variant="outline" className="h-auto min-h-8 justify-start whitespace-normal py-1 text-left text-xs" disabled={lock} onClick={cutOut} title="Cuts the piece out of its background; nothing is redrawn">
            {busy === 'cutout' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Scissors className="mr-1 h-3.5 w-3.5" />}Remove background
          </Button>
          {design.canUndoPhoto && (
            <Button size="sm" variant="ghost" className="h-auto min-h-8 justify-start whitespace-normal py-1 text-left text-xs" disabled={lock} onClick={() => void design.undoPhoto()}>
              <Undo2 className="mr-1 h-3.5 w-3.5 shrink-0" /> Back to the photo before
            </Button>
          )}
        </div>
        <TidyToggle design={design} />
        {design.aiBusy && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {design.aiBusy}…</p>}
        {busy === 'cutout' && <p className="text-[11px] text-muted-foreground">Cutting the piece out — this takes about ten seconds…</p>}
        {!POST_AI_ON && <p className="text-[11px] text-muted-foreground">The photograph AI isn’t part of this shop.</p>}
        <p className="text-[10px] text-muted-foreground">Every result is compared with your photo; one that changed the piece waits for your say.</p>
      </div>
    </div>
  );
}

// ── Check ──────────────────────────────────────────────────────────────────

interface FullCheck { verdict: CheckVerdict; words: { text: boolean; headline: boolean }; invented: string[]; calendar: { blocked: boolean } }

export function CheckPanel({ design, adsOk, autoRun = false }: { design: DesignApi; adsOk: boolean; autoRun?: boolean }) {
  const { toast } = useToast();
  const w = design.work!;
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState<{ at: number; r: FullCheck } | null>(null);
  const spoken = `${w.fields.kicker} ${w.fields.headline} ${w.fields.details}`;
  const invented = inventedFigures(spoken, `${w.fields.weight} ${w.copy.price ?? ''} ${w.fields.kicker}`);
  const tall = w.pages.filter(p => safeZone(p.frame).top > 0);
  const rows: { ok: boolean; text: string }[] = [
    { ok: !!w.fields.headline.trim(), text: w.fields.headline.trim() ? 'There is a headline.' : 'No headline yet.' },
    { ok: invented.length === 0, text: invented.length ? `Figures the specs don’t give: ${invented.join(', ')} — check them or take them out.` : 'Every figure on the picture is in the specs.' },
    { ok: !!design.photo, text: design.photo ? 'The photograph is in.' : 'No photograph.' },
    ...(tall.length ? [{ ok: true, text: `${tall.map(p => p.label).join(', ')}: Instagram covers the top and bottom bands — keep the words in the middle.` }] : []),
    ...(w.stale.length ? [{ ok: false, text: `${w.stale.length} size${w.stale.length === 1 ? '' : 's'} behind the master — re-do ${w.stale.length === 1 ? 'it' : 'them'} before sending.` }] : []),
  ];
  const run = async () => {
    setBusy(true);
    try {
      const blob = await design.render(w.master, 1080, 0.88);
      const page = w.pages.find(p => p.id === w.master)!;
      const form = new FormData();
      form.append('image', blob, 'ad.jpg');
      form.append('format', `${AD_FORMATS[page.format === 'custom' ? 'square' : page.format].label}`);
      form.append('text', w.copy.adText ?? ''); form.append('headline', w.copy.adHeadline ?? w.fields.headline);
      form.append('specs', w.fields.weight); form.append('price', w.copy.price ?? '');
      form.append('start', new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)); form.append('days', '7');
      setFull({ at: page.rev, r: await api<FullCheck>('/api/ads/studio/check', { form }) });
    } catch (e) {
      toast({ title: 'Couldn’t check it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  // "Make it with AI" and "Use this ad" check what they made, once the new layout is on screen.
  const lastTick = useRef(design.checkTick);
  useEffect(() => {
    if (!autoRun || !adsOk || design.checkTick === lastTick.current) return;
    lastTick.current = design.checkTick;
    const t = setTimeout(() => { void run(); }, 600);
    return () => clearTimeout(t);
  }, [design.checkTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = full?.r.verdict;
  const stale = full && full.at !== w.pages.find(p => p.id === w.master)?.rev;
  const Icon = v?.verdict === 'run' ? CheckCircle2 : v?.verdict === 'fix' ? AlertTriangle : XCircle;
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs">
            {r.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />}
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      {adsOk && (
        <div className="space-y-2 border-t pt-3">
          <Button size="sm" className="w-full" disabled={busy || w.fresh} onClick={run}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />} {full ? 'Check again' : 'Full ad check'}
          </Button>
          {busy && <p className="text-[11px] text-muted-foreground">Checking… (~30 s)</p>}
          {v && (
            <div className={cn('space-y-1.5 rounded-lg border p-2.5 text-xs', stale && 'opacity-60', v.verdict === 'run' ? 'border-emerald-500/50 bg-emerald-500/5' : v.verdict === 'fix' ? 'border-amber-500/50 bg-amber-500/5' : 'border-rose-500/50 bg-rose-500/5')}>
              {stale && <p className="font-medium">The design changed since this check — check again.</p>}
              <p className="flex items-center gap-1.5 font-semibold"><Icon className="h-4 w-4" /> {v.verdict === 'run' ? 'Ready to run' : v.verdict === 'fix' ? 'Worth running after a few changes' : 'Don’t run this'}
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] tabular-nums', scoreTone(v.score))}>{v.score}</span></p>
              <p className="text-muted-foreground">{v.summary}</p>
              {full!.r.calendar.blocked && <p className="text-rose-700 dark:text-rose-300">It would run through sacred days — see Ads → New ad for the dates.</p>}
              {v.fixes.length > 0 && <ol className="list-decimal pl-4">{v.fixes.map((f, i) => <li key={i}>{f}</li>)}</ol>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── The card ───────────────────────────────────────────────────────────────

/** The AI panel with its own actions (hooks live in a component, not in the render of a section). */
export function AiPanelHost({ design, adsOk }: { design: DesignApi; adsOk: boolean }) {
  const actions = useAiActions(design, adsOk);
  return <AiPanel design={design} adsOk={adsOk} actions={actions} />;
}

/** The column beside the editor: the design's name, then its words, pictures and checks. */
export function DesignPiece({ design, adsOk, onAnother }: { design: DesignApi; adsOk: boolean; onAnother: () => void }) {
  const w = design.work!;
  const section = (title: string, body: React.ReactNode, open = false) => (
    <details open={open} className="group rounded-xl border bg-card">
      <summary className="flex min-h-0 cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {title}<span className="text-xs text-muted-foreground group-open:hidden">Open</span>
      </summary>
      <div className="px-3 pb-3">{body}</div>
    </details>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{kindLabel(w.kind)}</span>
          {w.scope === 'ads' && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Ads</span>}
        </div>
        <Input value={w.name} placeholder={w.fields.headline || 'Name this design'} maxLength={120} onChange={e => design.actions.rename(e.target.value)} aria-label="Design name" className="mt-2 h-9 text-base font-medium sm:text-sm" />
      </div>
      {section('Words', <WordsPanel design={design} adsOk={adsOk} />, true)}
      {section('Pictures', <PicturesPanel design={design} adsOk={adsOk} onAnother={onAnother} />)}
      {section('With AI', <AiPanelHost design={design} adsOk={adsOk} />)}
      {section('Check', <CheckPanel design={design} adsOk={adsOk} autoRun />)}
    </div>
  );
}
