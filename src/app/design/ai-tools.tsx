'use client';

/**
 * Design's AI tools — what Post a piece and the ad maker did with the image AI, in the workspace
 * (docs/features/design.md, "With AI"). Nothing new server-side: every tool calls the route it always called
 * (`/api/website/post/ai` for the photograph, the story and the captions; `/api/ads/studio/auto` for an ad's
 * art direction and painting, owner and marketing only).
 *
 *   photograph   Enhance · Logo and labels off · Extend · Retouch (GPT Image + Precision) · New setting · Ask AI
 *                — each result is compared with the photograph it came from; one that changed the piece waits for
 *                a look (`AiCandidateBanner`) instead of going in unseen
 *   the page     Make it with AI (an ad's art-directed layout and words; a piece's captions, colours, layout and
 *                a new setting) · Paint the whole page · AI lettering — as a change to the page's document
 *                (lib/design/lettered.ts), so it can be undone and is drawn everywhere a page is
 *   words        the caption writer (WhatsApp + Instagram, headline ideas, the stones the AI sees)
 *
 * `useAiActions(design, adsOk)` holds no state of its own: what is running, which dialog is open and what waits
 * for a look live in the design (use-design.ts), so any panel can start a tool and any other can show it.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLingering } from '@/hooks/use-lingering';
import { AlertTriangle, Brush, CheckCircle2, Copy, Loader2, MessageSquareText, Palette as PaletteIcon, ShieldAlert, ShieldCheck, Sparkles, Type, Undo2, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PALETTES } from '@/lib/social/story';
import { frameOf, applyPreset, type Fields, type StoryDoc, type TextLayer, type MarkLayer } from '@/lib/social/editor';
import { SCENES, customPrompt, restagePrompt, type Aspect, type CaptionResult, type CheckResult } from '@/lib/social/prompts';
import { stampPhoto } from '@/lib/social/story';
import { diagnose } from '@/lib/social/diagnose';
import { postAi } from '@/lib/social/ai-client';
import { STORE_AD_STUDIO, STORE_LINKS, STORE_POST_PIECE, STORE_SITE_EDIT, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import { waNumberFromUrl } from '@/lib/social/caption';
import { AD_FORMATS, PHOTO, applyAdTemplate, blankAd, formatInfo, nearestAiRatio, paintedAd, type AdTemplateId } from '@/lib/ads/studio/templates';
import { GOALS } from '@/lib/ads/plan';
import type { CopyResult, Direction } from '@/lib/ads/studio/prompts';
import { applyLettered, letteredOf, removeLettered } from '@/lib/design/lettered';
import { api, authHeaders } from '../ads/ads-kit';
import { b64ToBlob } from './studio-kit';
import { activePage, type WorkPage } from './design-state';
import type { DesignApi } from './use-design';

/** The photograph / story / caption AI (Post a piece's route) is on in this shop. */
export const POST_AI_ON = STORE_POST_PIECE || STORE_SITE_EDIT;
/** The ad AI (art direction and painting) is the Ad studio's: on in this shop. Who may use it is `adsOk`. */
export const AD_AI_ON = STORE_AD_STUDIO;

const NUMBERS = STORE_WHATSAPP_NUMBERS.length ? STORE_WHATSAPP_NUMBERS : [waNumberFromUrl(STORE_LINKS.whatsapp)].filter(Boolean);

const FILL = { mode: 'fill' as const, zoom: 1, focusX: 0.5, focusY: 0.5 };
const checkOk = (c: { samePiece: boolean; confidence?: number } | null | undefined) => !!c && c.samePiece && (c.confidence ?? 1) >= 0.8;
const uid = (s: string) => `${s}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
/** A page tall enough to be a story (9:16 and its near neighbours): the shape AI lettering is made for. */
export const isStoryShaped = (p: Pick<WorkPage, 'frame'>) => p.frame.w / p.frame.h < 0.62;
const ratioOf = (p: Pick<WorkPage, 'frame'>) => nearestAiRatio(p.frame.w, p.frame.h) as Aspect;

interface AiImageResponse { image: { mimeType: string; data: string }; check?: CheckResult | null; aspect?: Aspect }
type PaintResponse = AiImageResponse & { lettering: { verified: boolean; missing: string[] } };

/** An op on `/api/website/post/ai`: the images (at most 2048 px on the long side) and its params. */
async function postOp<T>(op: string, images: Blob[], params: Record<string, unknown> = {}): Promise<T> {
  const form = new FormData();
  form.set('op', op);
  form.set('params', JSON.stringify(params));
  images.forEach((b, i) => form.append('image', b, `image-${i}.jpg`));
  return postAi<T>(form, await authHeaders());
}

/** A photograph as the AI is sent it: at most 2048 px on the long side. */
async function forAi(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await stampPhoto(img, { text: '', colour: 'auto', maxEdge: 2048 });
  } finally { URL.revokeObjectURL(url); }
}

/** Where the shop's mark sits on a page, so a painting leaves that place empty for it. */
function markSpot(doc: StoryDoc): string {
  const m = doc.layers.find(l => l.kind === 'wordmark' && !l.hidden) as MarkLayer | undefined;
  if (!m) return 'top-right';
  const f = frameOf(doc), cx = m.x + m.width / 2;
  return `${m.y < f.h / 2 ? 'top' : 'bottom'}-${Math.abs(cx - f.w / 2) < f.w * 0.12 ? 'centre' : cx > f.w / 2 ? 'right' : 'left'}`;
}

// ── The actions ────────────────────────────────────────────────────────────

export type PhotoOp =
  | { op: 'enhance' }
  | { op: 'clean' }
  | { op: 'extend' }
  | { op: 'retouch' }
  | { op: 'setting'; sceneId?: string; scene?: string; aspect: Aspect; rawPrompt?: string }
  | { op: 'ask'; instruction: string; aspect: Aspect | null; rawPrompt?: string };

export function useAiActions(design: DesignApi, adsOk: boolean) {
  const { toast } = useToast();
  const w = design.work;
  const busy = design.aiBusy;

  const explain = (where: 'ai' | 'caption', e: unknown) => {
    const d = diagnose(where, { status: typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined, message: e instanceof Error ? e.message : String(e) });
    toast({ title: d.title, description: d.fix, variant: 'destructive' });
  };
  /** Runs one tool at a time: the Vertex quota is tiny and two at once would race for the photograph. */
  const guarded = async <T,>(what: string, fn: () => Promise<T>): Promise<T | null> => {
    if (design.aiBusy) return null;
    design.setAiBusy(what);
    try { return await fn(); } finally { design.setAiBusy(null); }
  };

  /** A new photograph for the design from an AI op — or, if the check doubts it, held for a look. */
  const takePhoto = async (blob: Blob, label: string, clean: boolean, check: CheckResult | null) => {
    if (check && !checkOk(check)) {
      design.setCandidate({ kind: 'photo', url: URL.createObjectURL(blob), blob, label, clean, check, why: 'doubt' });
      toast({ title: 'Check this one before it goes in', description: check.differences[0] ?? 'The AI may have changed the piece.', variant: 'destructive' });
      return false;
    }
    await design.replacePhoto(blob, label, clean, { check });
    return true;
  };

  /** One of the photograph's tools. */
  const photo = async (o: PhotoOp) => {
    const src = design.photo, page = design.activePage;
    if (!src || !page) return null;
    const tidy = design.tidy;
    const aspect = ratioOf(page);
    const meta: Record<PhotoOp['op'], { label: string; wait: string; clean: boolean }> = {
      enhance: { label: 'Enhanced', wait: 'Enhancing the photograph — about a minute', clean: tidy },
      clean: { label: 'Logo and labels off', wait: 'Taking the logo and labels off — about a minute', clean: true },
      extend: { label: `Extended ${aspect}`, wait: 'Extending the photograph — about a minute', clean: true },
      retouch: { label: 'Retouched', wait: 'Retouching — piece, background and light, about two minutes', clean: tidy },
      setting: { label: o.op === 'setting' && o.scene ? 'New setting' : SCENES.find(s => o.op === 'setting' && s.id === o.sceneId)?.label ?? 'New setting', wait: 'Photographing it in the new setting — about a minute', clean: true },
      ask: { label: o.op === 'ask' ? o.instruction.slice(0, 28) || 'Your edit' : 'Your edit', wait: 'Doing what you asked — about a minute', clean: false },
    };
    const m = meta[o.op];
    return guarded(m.wait, async () => {
      try {
        const img = await forAi(src.blob);
        let r: AiImageResponse;
        if (o.op === 'enhance') r = await postOp('enhance', [img], { tidy });
        else if (o.op === 'clean') r = await postOp('enhance', [img], { tidy: true });
        else if (o.op === 'extend') r = await postOp('reframe', [img], { aspect, tidy: design.marked || tidy });
        else if (o.op === 'retouch') r = await postOp('retouch', [img], { tidy });
        else if (o.op === 'setting') r = await postOp('restage', [img], { aspect: o.aspect, ...(o.scene ? { scene: o.scene } : { sceneId: o.sceneId }), ...(o.rawPrompt?.trim() ? { rawPrompt: o.rawPrompt.trim() } : {}) });
        else r = await postOp('custom', [img], { instruction: o.instruction.trim(), ...(o.aspect ? { aspect: o.aspect } : {}), ...(o.rawPrompt?.trim() ? { rawPrompt: o.rawPrompt.trim() } : {}) });
        const out = b64ToBlob(r.image.data, r.image.mimeType);
        if (await takePhoto(out, m.label, m.clean, r.check ?? null)) {
          toast({ title: `${m.label} — done`, description: r.check ? 'The check: the same piece as before.' : 'Not checked — compare it with the original.' });
        }
        return true;
      } catch (e) { explain('ai', e); return null; }
    });
  };

  /** Use the picture waiting for a look. An ad's painting also becomes the ad. */
  const useCandidate = async () => {
    const c = design.candidate, page = design.activePage;
    if (!c) return;
    design.setCandidate(null);
    if (c.kind === 'ad' && page) {
      await design.replacePhoto(c.blob, 'Painted ad', false, { check: c.check ? { samePiece: c.check.samePiece, confidence: c.check.confidence ?? 1, differences: c.check.differences } : null });
      design.setMarked(false);
      design.actions.setDoc(page.id, paintedAd(page.format, design.assets, page.frame));
      design.requestCheck();
    } else {
      await design.replacePhoto(c.blob, c.label, c.clean, { check: c.check ? { samePiece: c.check.samePiece, confidence: c.check.confidence ?? 1, differences: c.check.differences } : null });
    }
  };

  // ── Words ──
  /** The caption writer: both captions, headline ideas, the stones the AI sees and a plan for the piece. */
  const writeCaption = async (o: { brief?: string; stones?: string; quiet?: boolean } = {}): Promise<CaptionResult | null> => {
    const src = design.photo;
    if (!src || !w) return null;
    return guarded('Writing the captions — about 30 seconds', async () => {
      try {
        const d = await postOp<{ caption: CaptionResult }>('caption', [await forAi(src.blob)], {
          headline: w.fields.headline, weight: w.fields.weight, metal: '', stones: o.stones ?? '', collection: '', numbers: NUMBERS,
          link: STORE_LINKS.website || '', brief: o.brief ?? '',
        });
        const c = d.caption;
        design.actions.setCopy({ wa: c.whatsappCaption.slice(0, 2000), ig: c.instagramCaption.slice(0, 2200) });
        if (!w.fields.headline.trim() && c.headlines[0]) design.patchFields({ headline: c.headlines[0] });
        if (!o.quiet) toast({ title: 'Captions written', description: c.stonesSeen && !o.stones ? `Stones look like: ${c.stonesSeen}. Say so in the specs if that is right.` : 'Read them over before sending.' });
        return c;
      } catch (e) { explain('caption', e); return null; }
    });
  };

  // ── Make it with AI ──
  const adAi = adsOk && AD_AI_ON && w?.kind === 'ad';

  const aiParams = (brief: string, page: WorkPage) => {
    const F = page.format === 'custom' ? formatInfo('custom', undefined) : formatInfo(page.format);
    return {
      name: w!.name || w!.fields.headline, collection: '', specs: w!.fields.weight, price: w!.copy.price ?? '', brief, format: page.format, aspect: nearestAiRatio(page.frame.w, page.frame.h),
      shape: F.label, trimTo: F.short, destination: GOALS.find(g => g.key === (w!.copy.goal ?? 'whatsapp'))?.hint ?? 'a WhatsApp chat with the shop',
      kicker: w!.fields.kicker, headline: w!.fields.headline, cta: w!.fields.details,
    };
  };

  /** The Ad studio's "Make it with AI": an art director's layout and words, the logo off, the photo extended if the shape needs it — then looked at. */
  const makeAd = async (brief: string) => {
    const src = design.photo, page = design.activePage;
    if (!src || !page || !w) return;
    await guarded('Designing the ad from the photo and its details — about a minute', async () => {
      try {
        const ratio = (src.img.naturalWidth / src.img.naturalHeight) / (page.frame.w / page.frame.h);
        const extend = ratio > 1.3 || ratio < 0.77;
        const photoOp = extend ? postOp<AiImageResponse>('reframe', [await forAi(src.blob)], { aspect: nearestAiRatio(page.frame.w, page.frame.h), tidy: design.marked })
          : design.marked ? postOp<AiImageResponse>('enhance', [await forAi(src.blob)], { tidy: true }) : null;
        const form = new FormData();
        form.append('op', 'direct');
        form.append('params', JSON.stringify(aiParams(brief, page)));
        form.append('image', src.blob, 'photo.jpg');
        const [dir, fixed] = await Promise.all([
          api<{ direction: Direction }>('/api/ads/studio/auto', { form }),
          photoOp ? photoOp.catch(e => { toast({ title: 'The photo couldn’t be prepared', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); return null; }) : Promise.resolve(null),
        ]);
        const d = dir.direction;
        const next: Fields = { ...w.fields, kicker: d.kicker || w.fields.kicker, headline: d.headline || w.fields.headline, details: d.cta || w.fields.details };
        design.patchFields(next);
        design.actions.setCopy({ ...(d.primaryText[0] ? { adText: d.primaryText[0] } : {}), ...(d.adHeadlines[0] ? { adHeadline: d.adHeadlines[0] } : {}) });
        // The photograph's "same piece?" check decides: a result that changed the piece never goes into an ad unseen.
        const changed = !!fixed?.check && !fixed.check.samePiece;
        if (changed) toast({ title: 'Kept your photo', description: `The AI changed the piece: ${fixed!.check!.differences.slice(0, 2).join('; ') || 'the check says it is not the same'}. The words and layout are in.`, variant: 'destructive' });
        let isMarked = design.marked;
        if (fixed && !changed) {
          await design.replacePhoto(b64ToBlob(fixed.image.data, fixed.image.mimeType), 'AI-prepared photo', false, { check: fixed.check ?? null });
          design.setMarked(false); isMarked = false;
          await new Promise(r => setTimeout(r, 60)); // the new photograph is in the assets before the layout measures it
        }
        // The same layout on every size of the design.
        for (const p of design.work!.pages) {
          design.actions.setDoc(p.id, design.layOut({ ...blankAd(p.format, p.frame), bg: { ...blankAd(p.format, p.frame).bg, placement: p.doc.bg.placement } }, d.layout as AdTemplateId, next, isMarked));
        }
        design.requestCheck();
        const scene = d.scene ? SCENES.find(x => x.id === d.scene) : null;
        toast({ title: 'The ad is made', description: [d.why, scene ? `A new setting would suit it: ${scene.label} (Pictures → New setting).` : ''].filter(Boolean).join(' ') });
      } catch (e) {
        toast({ title: 'Couldn’t make it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      }
    });
  };

  /** Post a piece's "Make the whole story": the words, colours and layout for it, and a setting for the photograph, in one press. */
  const makeStory = async (brief: string) => {
    const src = design.photo, page = design.work && (design.work.pages.find(isStoryShaped) ?? design.activePage);
    if (!src || !page || !w) return;
    const c = await writeCaption({ quiet: true, brief });
    if (!c) return;
    await guarded('Choosing a setting and photographing it — about a minute', async () => {
      try {
        const cur = design.work!;
        const kicker = cur.fields.kicker || c.kicker;
        const headline = cur.fields.headline.trim() || c.headlines[0] || '';
        design.patchFields({ headline, kicker });
        const f2: Fields = { ...cur.fields, headline, kicker };
        const p = PALETTES.find(x => x.id === c.paletteId) ?? design.palette;
        if (isStoryShaped(page)) {
          const p0 = design.work!.pages.find(x => x.id === page.id)!;
          design.actions.setDoc(page.id, applyPreset(removeLettered(p0.doc), c.align === 'center' ? 'center' : 'stack-left', p, f2, design.assets, { weightOwnLine: c.weightOwnLine, wordmark: true }));
        }
        const scene = SCENES.find(s => s.id === c.sceneId) ?? SCENES[0];
        const custom = !!(brief.trim() && c.sceneBrief?.trim());
        const aspect = ratioOf(page);
        const r = await postOp<AiImageResponse>('restage', [await forAi(src.blob)], custom ? { scene: c.sceneBrief, aspect } : { sceneId: scene.id, aspect });
        const out = b64ToBlob(r.image.data, r.image.mimeType);
        const label = custom ? 'Your story' : scene.label;
        if (r.check && !checkOk(r.check)) {
          design.setCandidate({ kind: 'photo', url: URL.createObjectURL(out), blob: out, label, clean: true, check: r.check, why: 'doubt' });
          toast({ title: 'The words and layout are in', description: `The new setting waits for a look: ${r.check.differences[0] ?? 'the piece may have changed'}.`, variant: 'destructive' });
        } else {
          // The setting is this page's own photograph (a story-shaped one): the other sizes keep the real photograph.
          const id = uid('ai-scene');
          await design.addPhoto(id, out, label);
          const now = design.work!.pages.find(x => x.id === page.id)!;
          design.actions.setDoc(page.id, { ...now.doc, bg: { ...now.doc.bg, photoId: id, placement: FILL } });
          toast({ title: 'Story made', description: `${label} — lettered in the shop’s fonts. Move or change anything.` });
        }
      } catch (e) { explain('ai', e); }
    });
  };

  // ── Paint the whole page ──
  const paintPage = async (brief: string) => {
    const src = design.photo, page = design.activePage;
    if (!src || !page || !w) return;
    if (!w.fields.headline.trim()) { toast({ title: 'Give it a headline first' }); return; }
    if (adAi) {
      await guarded('Painting the whole ad — about a minute and a half', async () => {
        try {
          const form = new FormData();
          form.append('op', 'paint');
          form.append('params', JSON.stringify(aiParams(brief, page)));
          form.append('image', src.blob, 'photo.jpg');
          const r = await api<{ image: { data: string; mimeType: string }; lettering: { ok: boolean; missing: string[]; read: string }; check: { samePiece: boolean; differences: string[] } | null }>('/api/ads/studio/auto', { form });
          const blob = b64ToBlob(r.image.data, r.image.mimeType);
          design.setCandidate({ kind: 'ad', url: URL.createObjectURL(blob), blob, label: 'Painted ad', clean: false, check: r.check, lettering: r.lettering, why: 'paint' });
        } catch (e) { toast({ title: 'Couldn’t paint it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
      });
      return;
    }
    await guarded(isStoryShaped(page) ? 'Painting the story, reading it back and checking the piece — about a minute' : 'Painting the page, reading it back and checking the piece — about a minute', async () => {
      try {
        const specs = [w.fields.details, w.fields.weight].filter(Boolean).join(' | ');
        const imgs = [await forAi(src.blob), ...(design.original && design.original !== src.blob ? [await forAi(design.original)] : [])];
        const d = await postOp<PaintResponse>('paint', imgs, { aspect: ratioOf(page), kicker: w.fields.kicker, headline: w.fields.headline, specs, brief: brief.trim(), markCorner: markSpot(page.doc) });
        const blob = b64ToBlob(d.image.data, d.image.mimeType);
        const id = uid('ai-paint');
        await design.addPhoto(id, blob, 'Painted');
        const now = design.work!.pages.find(x => x.id === page.id)!;
        design.actions.setDoc(page.id, applyLettered(now.doc, id, { kind: 'paint', verified: d.lettering.verified, missing: d.lettering.missing, check: d.check ?? null }));
        if (d.check && !checkOk(d.check)) toast({ title: 'Check the piece closely', description: d.check.differences[0] ?? 'Compare it with the photo before posting.', variant: 'destructive' });
        else if (!d.lettering.verified) toast({ title: 'The AI got some words wrong', description: `Could not find: ${d.lettering.missing.join(', ') || 'the text'}. Paint again, or go back to our design.`, variant: 'destructive' });
        else toast({ title: 'Painted', description: 'Every word read back, and the piece is the same.' });
      } catch (e) { explain('ai', e); }
    });
  };

  // ── AI lettering (stories) ──
  const letter = async (style: string) => {
    const src = design.photo, page = design.activePage;
    if (!src || !page || !w) return;
    if (!w.fields.headline.trim()) { toast({ title: 'Give it a headline first' }); return; }
    await guarded('Lettering the story and reading it back — about a minute', async () => {
      try {
        const base = removeLettered(page.doc);
        const head = base.layers.find(l => l.kind === 'text' && l.bind === 'headline') as TextLayer | undefined;
        const weightShown = base.layers.some(l => l.kind === 'text' && l.bind === 'weight' && !l.hidden);
        const d = await postOp<PaintResponse>('letter', [await forAi(src.blob)], {
          kicker: w.fields.kicker, headline: w.fields.headline, weight: weightShown ? w.fields.weight : '', details: w.fields.details,
          headlineColour: head?.color ?? design.palette.headline, bodyColour: design.palette.body, align: head?.align === 'center' ? 'center' : 'left', style: style.trim(),
        });
        const blob = b64ToBlob(d.image.data, d.image.mimeType);
        const id = uid('ai-letter');
        await design.addPhoto(id, blob, 'Lettered');
        const now = design.work!.pages.find(x => x.id === page.id)!;
        design.actions.setDoc(page.id, applyLettered(now.doc, id, { kind: 'letter', verified: d.lettering.verified, missing: d.lettering.missing }));
        if (!d.lettering.verified) toast({ title: 'The AI got some words wrong', description: `Could not find: ${d.lettering.missing.join(', ') || 'the text'}. Try again, or use our fonts.`, variant: 'destructive' });
      } catch (e) { explain('ai', e); }
    });
  };
  /** Back to our fonts / our design on the active page. */
  const unletter = () => {
    const page = design.activePage;
    if (page && letteredOf(page.doc)) design.actions.setDoc(page.id, removeLettered(page.doc));
  };

  return { busy, photo, useCandidate, writeCaption, makeAd, makeStory, paintPage, letter, unletter, adAi };
}

export type AiActions = ReturnType<typeof useAiActions>;

// ── Pieces ─────────────────────────────────────────────────────────────────

/** A two- or three-way switch as a row of pills. */
function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={cn('min-h-0 rounded-full px-3 py-1 text-xs', value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{label}</button>
      ))}
    </div>
  );
}

/** The full prompt, shown and editable: closed, the page sends what it built from the choices; opened and edited, exactly this text. */
function PromptEditor({ value, generated, onChange }: { value: string | null; generated: string; onChange: (v: string | null) => void }) {
  const open = value !== null;
  return (
    <div className="space-y-1.5">
      <button type="button" className="min-h-0 text-xs text-primary" onClick={() => onChange(open ? null : generated)}>
        {open ? 'Use the built prompt instead' : 'Edit the full prompt (advanced)'}
      </button>
      {open && <Textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={8} className="font-mono text-[11px] leading-snug" />}
    </div>
  );
}

/** "Also remove tags and strings": whether Enhance and Retouch take the website's marks off too. */
export function TidyToggle({ design }: { design: DesignApi }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <input type="checkbox" checked={design.tidy} onChange={e => design.setTidy(e.target.checked)} /> Also remove tags and strings
    </label>
  );
}

/**
 * An AI picture waiting for a look, between the page strip and the editor: a photograph the check doubts, or the
 * ad AI's painting. "Use it" puts it in; nothing the check doubted goes in on its own.
 */
export function AiCandidateBanner({ design, actions }: { design: DesignApi; actions: AiActions }) {
  const c = design.candidate;
  if (!c) return null;
  const same = c.check ? checkOk(c.check) : null;
  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3" role="region" aria-label="An AI picture to look at">
      <div className="flex flex-wrap items-start gap-3">
        <img src={c.url} alt={c.label} className="h-40 w-auto max-w-[45%] rounded-md border object-contain sm:h-48" />
        <div className="min-w-[10rem] flex-1 space-y-1.5 text-xs">
          <p className="text-sm font-semibold">{c.why === 'paint' ? 'The painted ad' : `${c.label} — to look at`}</p>
          {c.lettering && (
            <p className={cn('flex items-start gap-1', c.lettering.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300')}>
              {c.lettering.ok ? <><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Every line reads back exactly.</> : <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Lettering to check: {c.lettering.missing.map(m => `“${m}”`).join(', ') || 'it could not be read back'}.</>}
            </p>
          )}
          <p className={cn('flex items-start gap-1', same ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300')}>
            {same ? <><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The same piece as the photograph.</>
              : c.check ? <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The piece may have changed: {c.check.differences.slice(0, 3).join('; ') || 'compare it with your photograph'}.</>
                : <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not checked — compare the piece with your photograph.</>}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant={same === false ? 'outline' : 'default'} onClick={() => void actions.useCandidate()}>{same === false ? 'Use it anyway' : c.kind === 'ad' ? 'Use this ad' : 'Use it'}</Button>
            <Button size="sm" variant="ghost" onClick={() => design.setCandidate(null)}>Discard</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The dialogs ────────────────────────────────────────────────────────────

const ASK_IDEAS = ['Remove the hand and props', 'Warmer, golden-hour light', 'Deep green velvet background', 'Soft bokeh lights behind', 'Clean white studio background', 'Add a subtle reflection below'];
const STORY_IDEAS = ['Eid collection, festive green and gold', 'Wedding season, rich and regal', 'Everyday wear, light and minimal', 'For her birthday, soft and romantic', 'Heritage piece, old-world and warm'];

/** The four dialogs, mounted once by the workspace; any panel opens one with `design.setAiDialog`. */
export function AiDialogs({ design, actions }: { design: DesignApi; actions: AiActions }) {
  const which = design.aiDialog;
  const shown = useLingering(which);
  const close = () => design.setAiDialog(null);
  const page = design.activePage;
  const w = design.work;
  const own = page ? ratioOf(page) : '1:1';

  const [sceneId, setSceneId] = useState(SCENES[0].id);
  const [customScene, setCustomScene] = useState('');
  const [aspect, setAspect] = useState<Aspect | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [askText, setAskText] = useState('');
  const [brief, setBrief] = useState('');
  const [paintBrief, setPaintBrief] = useState('');

  const shape = aspect ?? (shown === 'ask' ? null : (own as Aspect));
  const shapeOpts: [string, string][] = [...(shown === 'ask' ? [['same', 'Same shape'] as [string, string]] : []), ['9:16', 'Story 9:16'], ['4:5', 'Portrait 4:5'], ['1:1', 'Square']];
  const shapeValue = shape ?? 'same';
  const pickShape = (v: string) => setAspect(v === 'same' ? null : (v as Aspect));
  const scene = SCENES.find(s => s.id === sceneId);
  const closeAnd = (fn: () => void) => { close(); setRaw(null); fn(); };
  const adMake = actions.adAi;
  const specs = w ? [w.fields.details, w.fields.weight].filter(Boolean).join(' | ') : '';

  return (
    <>
      {/* A new setting for the photograph. */}
      <Dialog open={which === 'setting'} onOpenChange={o => { if (!o) { close(); setRaw(null); } }}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Put it somewhere new</DialogTitle>
            <DialogDescription>The piece stays exactly as photographed; AI photographs it again in the setting you choose, then checks it is still the same piece.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {SCENES.map(s => (
              <button key={s.id} type="button" onClick={() => { setSceneId(s.id); setCustomScene(''); }}
                className={cn('min-h-0 rounded-lg border p-2.5 text-left text-sm', sceneId === s.id && !customScene.trim() ? 'border-primary bg-primary/5' : 'hover:border-foreground/30')}>
                <span className="block font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">For {s.suits}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="custom-scene" className="text-xs font-medium">Or describe one</label>
            <Input id="custom-scene" value={customScene} onChange={e => setCustomScene(e.target.value)} placeholder="on a marble tray beside white roses, morning light" className="text-base sm:text-sm" />
          </div>
          {shown === 'setting' && <Seg value={shapeValue} options={shapeOpts} onChange={pickShape} />}
          {shown === 'setting' && <PromptEditor value={raw} generated={restagePrompt(customScene.trim() || scene?.brief || '', (shape ?? own) as Aspect)} onChange={setRaw} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => closeAnd(() => undefined)}>Cancel</Button>
            <Button onClick={() => closeAnd(() => { void actions.photo({ op: 'setting', aspect: (shape ?? own) as Aspect, ...(customScene.trim() ? { scene: customScene.trim() } : { sceneId }), ...(raw ? { rawPrompt: raw } : {}) }); })}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Photograph it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ask AI: anything, in the person's words. */}
      <Dialog open={which === 'ask'} onOpenChange={o => { if (!o) { close(); setRaw(null); } }}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ask AI to change this photo</DialogTitle>
            <DialogDescription>Say it the way you’d tell a photographer. The piece itself is protected, and the result is checked against the original.</DialogDescription>
          </DialogHeader>
          {design.photo && <img src={design.photo.url} alt="" className="mx-auto h-28 w-28 rounded-md object-cover" />}
          <Textarea value={askText} onChange={e => setAskText(e.target.value)} rows={3} autoFocus className="text-base sm:text-sm"
            placeholder="e.g. put it on white marble with a few rose petals · remove the hand · warmer evening light · make the background deep green velvet" />
          <div className="flex flex-wrap gap-1.5">
            {ASK_IDEAS.map(t => <button key={t} type="button" onClick={() => setAskText(t)} className="min-h-0 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">{t}</button>)}
          </div>
          {shown === 'ask' && <Seg value={shapeValue} options={shapeOpts} onChange={pickShape} />}
          {shown === 'ask' && <PromptEditor value={raw} generated={customPrompt(askText || '…', shape)} onChange={setRaw} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => closeAnd(() => undefined)}>Cancel</Button>
            <Button disabled={!askText.trim() && !raw?.trim()} onClick={() => closeAnd(() => { void actions.photo({ op: 'ask', instruction: askText, aspect: shape, ...(raw ? { rawPrompt: raw } : {}) }); })}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Do it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Make it with AI. */}
      <Dialog open={which === 'make'} onOpenChange={o => { if (!o) close(); }}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{adMake ? 'Make the ad with AI' : 'Make it with AI'}</DialogTitle>
            <DialogDescription>
              {adMake
                ? 'An art director lays the ad out from the photograph and its details: the layout, the words on the picture, the ad’s own text and headline — and extends the photo to the shape if it needs it. Then you look at it.'
                : 'AI writes the headline and captions, picks the colours and layout, and photographs the piece in a setting for the story. Tell it what you have in mind, or leave it to choose.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={brief} onChange={e => setBrief(e.target.value)} rows={adMake ? 2 : 4} className="text-base sm:text-sm"
            placeholder={adMake ? 'Aim (optional) — e.g. Eid gifting' : 'Optional — e.g. Eid collection, festive green and gold, on a carved wooden jewellery box with marigolds · or: minimal, for everyday wear, soft morning light'} />
          {!adMake && (
            <div className="flex flex-wrap gap-1.5">
              {STORY_IDEAS.map(t => <button key={t} type="button" onClick={() => setBrief(t)} className="min-h-0 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">{t}</button>)}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={() => closeAnd(() => { void (adMake ? actions.makeAd(brief) : actions.makeStory(brief)); })}><Wand2 className="mr-1.5 h-4 w-4" /> Make it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paint the whole page. */}
      <Dialog open={which === 'paint'} onOpenChange={o => { if (!o) close(); }}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Paint the whole {page && isStoryShaped(page) ? 'story' : adMake ? 'ad' : 'page'}</DialogTitle>
            <DialogDescription>
              The AI paints a finished picture around the piece — the ground, the light, a fine frame and the lettering, all in one picture.
              It writes exactly these words, then reads them back and checks the piece against your photo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-0.5 rounded-lg bg-muted/40 p-3 text-sm">
            {w?.fields.kicker.trim() && <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{w.fields.kicker}</p>}
            <p className="font-serif text-base italic">{w?.fields.headline || 'No headline yet'}</p>
            {specs && <p className="text-xs text-muted-foreground">{specs}</p>}
          </div>
          <Textarea value={paintBrief} onChange={e => setPaintBrief(e.target.value)} rows={3} className="text-base sm:text-sm"
            placeholder="Optional — your direction, e.g. warm candlelight, deep green ground · or: minimal, lots of empty space" />
          <p className="text-xs text-muted-foreground">
            {adMake ? 'You will look at the painting first; “Use this ad” makes it the ad, with the mark on top.'
              : 'The painting becomes this page. Our words make way for the painting’s; the mark stays where the page has it. “Back to our design” undoes it.'}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button disabled={!w?.fields.headline.trim()} onClick={() => closeAnd(() => { void actions.paintPage(paintBrief); })}><Brush className="mr-1.5 h-4 w-4" /> Paint it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── The panel ──────────────────────────────────────────────────────────────

/** "With AI": the tools that work on the active page as a whole. (The photograph's own tools are in Pictures.) */
export function AiPanel({ design, adsOk, actions }: { design: DesignApi; adsOk: boolean; actions: AiActions }) {
  const [style, setStyle] = useState('');
  const w = design.work!;
  const page = design.activePage;
  const lettered = page ? letteredOf(page.doc) : null;
  const photo = design.photo;
  const lock = !!design.aiBusy || !photo;
  const postOn = POST_AI_ON;
  const adOn = actions.adAi;
  const canMake = adOn || postOn;
  if (!canMake) return <p className="text-xs text-muted-foreground">The AI tools aren’t part of this shop.</p>;
  const noHead = !w.fields.headline.trim();
  const same = lettered?.check ? checkOk(lettered.check) : null;
  const storyShaped = !!page && isStoryShaped(page);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2">
        <p className="flex items-center gap-1 text-xs font-medium"><Sparkles className="h-3.5 w-3.5" /> {adOn ? 'Make the ad with AI' : 'Make it with AI'}</p>
        <p className="text-[11px] text-muted-foreground">{adOn ? 'The layout, the words on the picture and the ad’s own text, from the photograph.' : 'Captions, colours, layout and a setting for the story, in one press.'}</p>
        <Button size="sm" className="w-full" disabled={lock} onClick={() => design.setAiDialog('make')}>
          {design.aiBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />} Make it with AI…
        </Button>
      </div>

      <div className="space-y-1.5 rounded-lg bg-muted/40 p-2">
        <p className="flex items-center gap-1 text-[11px] font-medium"><Brush className="h-3.5 w-3.5" /> Paint the whole {adOn ? 'ad' : 'page'}</p>
        <Button size="sm" variant="outline" className="w-full" disabled={lock || noHead || (!postOn && !adOn)} onClick={() => design.setAiDialog('paint')}
          title="The image model draws the whole page, lettering included — then it is read back and compared with the photograph">
          <Brush className="mr-1 h-4 w-4" /> {lettered?.kind === 'paint' ? 'Paint it again…' : 'Paint it…'}
        </Button>
        {noHead && <p className="text-[11px] text-muted-foreground">Give it a headline first.</p>}
      </div>

      {postOn && storyShaped && (
        <div className="space-y-1.5 rounded-lg bg-muted/40 p-2">
          <p className="flex items-center gap-1 text-[11px] font-medium"><Type className="h-3.5 w-3.5" /> AI lettering</p>
          <Input value={style} onChange={e => setStyle(e.target.value)} placeholder="Style, in your words (optional) — e.g. gold foil serif" className="h-8 text-base sm:text-xs" />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={lock || noHead} onClick={() => void actions.letter(style)}>
              <Type className="mr-1 h-4 w-4" /> {lettered?.kind === 'letter' ? 'Letter again' : 'Letter it'}
            </Button>
          </div>
        </div>
      )}

      {lettered && (
        <div className="space-y-1.5 rounded-lg border p-2 text-xs">
          <p className="font-medium">{lettered.kind === 'paint' ? 'This page is painted by AI' : 'This page is lettered by AI'}</p>
          <p className={cn('flex items-start gap-1', lettered.verified ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
            {lettered.verified ? <><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Read back: every word and the weight are right.</> : <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Could not read: {lettered.missing.join(', ') || 'the words'}. Check it, or try again.</>}
          </p>
          {lettered.kind === 'paint' && (
            <p className={cn('flex items-start gap-1', same ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
              {same ? <><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The same piece as your photograph.</> : same === false ? <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The piece may have changed: {lettered.check?.differences[0] ?? 'compare it with your photograph'}.</> : <><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not checked — compare the piece with your photograph.</>}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={actions.unletter}><Undo2 className="mr-1 h-4 w-4" /> {lettered.kind === 'paint' ? 'Back to our design' : 'Back to our fonts'}</Button>
        </div>
      )}
      {design.aiBusy && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {design.aiBusy}…</p>}
      <p className="text-[10px] text-muted-foreground">Every AI picture is compared with your photograph; one that changed the piece waits for your say.</p>
    </div>
  );
}

// ── Captions ───────────────────────────────────────────────────────────────

/** The caption writer, in the Words panel: WhatsApp and Instagram captions the Publish sheet starts from. */
export function CaptionSection({ design, actions }: { design: DesignApi; actions: AiActions }) {
  const { toast } = useToast();
  const w = design.work!;
  const [brief, setBrief] = useState('');
  const [stones, setStones] = useState('');
  const [result, setResult] = useState<CaptionResult | null>(null);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); }
    catch { toast({ title: 'Could not copy', description: 'Select it and copy it by hand.', variant: 'destructive' }); }
  };
  const write = async () => { const c = await actions.writeCaption({ brief, stones }); if (c) setResult(c); };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">Captions</span>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!design.photo || !!design.aiBusy || !POST_AI_ON} onClick={() => void write()}>
          {design.aiBusy?.startsWith('Writing') ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />} Write with AI
        </Button>
      </div>
      <Input value={stones} onChange={e => setStones(e.target.value)} placeholder="Stones (optional) — e.g. Simulated Sapphires" className="h-8 text-base sm:text-xs" />
      <Input value={brief} onChange={e => setBrief(e.target.value)} placeholder="A line about it (optional) — steers the AI" className="h-8 text-base sm:text-xs" />
      {result && (
        <>
          {result.stonesSeen && !stones && <p className="text-[11px] text-muted-foreground">AI sees: {result.stonesSeen}. Name them in the specs if you know.</p>}
          <div className="flex flex-wrap gap-1">
            {result.headlines.slice(0, 5).filter(h => h !== w.fields.headline).map(h => (
              <button key={h} type="button" onClick={() => design.patchFields({ headline: h.slice(0, 140) })} className="min-h-0 rounded-full border px-2 py-0.5 text-[11px] hover:border-primary">{h}</button>
            ))}
          </div>
        </>
      )}
      <label className="block space-y-0.5">
        <span className="flex items-center justify-between text-[11px] text-muted-foreground">WhatsApp caption
          {w.copy.wa ? <button type="button" className="min-h-0 text-primary" onClick={() => void copy(w.copy.wa!, 'Caption')}><Copy className="mr-0.5 inline h-3 w-3" />Copy</button> : null}</span>
        <Textarea value={w.copy.wa ?? ''} rows={4} maxLength={2000} onChange={e => design.actions.setCopy({ wa: e.target.value })} className="font-mono text-base sm:text-xs" placeholder="Written by the AI, or type it. The Publish sheet starts from this." />
      </label>
      <label className="block space-y-0.5">
        <span className="flex items-center justify-between text-[11px] text-muted-foreground">Instagram caption
          {w.copy.ig ? <button type="button" className="min-h-0 text-primary" onClick={() => void copy(w.copy.ig!, 'Instagram caption')}><Copy className="mr-0.5 inline h-3 w-3" />Copy</button> : null}</span>
        <Textarea value={w.copy.ig ?? ''} rows={3} maxLength={2200} onChange={e => design.actions.setCopy({ ig: e.target.value })} className="text-base sm:text-xs" placeholder="For the feed post" />
      </label>
    </div>
  );
}
