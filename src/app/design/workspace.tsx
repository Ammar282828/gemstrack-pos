'use client';

/**
 * The workspace (plan §5.2): the one editor shell for everything made in Design.
 *
 *   top      the kind, the page strip (the master and its resized copies as live thumbnails; “+ size” opens the
 *            resize sheet), Safe zones, Save, Publish
 *   centre   the designer — Post a piece's `SoloEditor` and its full-screen designer — on the page chosen in the
 *            strip, with the host's own rail panels (DesignerExtras): Pictures, Words, Resize, Check, Publish
 *   beside   the piece card (design-piece.tsx): the same words, pictures and checks, on the page
 *
 * One editor is mounted at a time, keyed by the page and its `ver`; its edits come up through `onDoc`
 * (design-state.ts says what an edit does to the other pages). The resize and publish pieces are slots
 * (slots.tsx) until their packages land.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ArrowLeft, ImagePlus, Loader2, Maximize2, Plus, RefreshCw, Rocket, Save, ShieldCheck, Star, Trash2, Type } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PALETTES } from '@/lib/social/story';
import { reflow, renderDocTo, type Assets, type Bind, type Fields, type StoryDoc } from '@/lib/social/editor';
import { AD_TEMPLATES, PHOTO, applyAdTemplate, safeZone, type AdTemplateId } from '@/lib/ads/studio/templates';
import { sizePreset } from '@/lib/design/sizes';
import { SoloEditor, useStoryDoc, type DesignerExtras } from '../website/post/story-editor';
import { headlineFace, bodyFace, serifFace } from '../website/post/fonts';
import { SITE_LABEL, safeName } from '../ads/studio/studio-kit';
import { CheckPanel, DesignPiece, PicturesPanel, WordsPanel } from './design-piece';
import { activePage, displayName, kindLabel, pageOf, toPage, toRecordLike, type DesignWork, type WorkPage } from './design-state';
import { PublishSheet, ResizeSheet, resizeFallback, type ResizedPage } from './slots';
import type { DesignApi } from './use-design';

interface Props {
  design: DesignApi;
  adsOk: boolean;
  /** Choose another photograph (the Photos section). */
  onAnother: () => void;
  /** Back to the start screen. */
  onClose: () => void;
}

export function DesignWorkspace({ design, adsOk, onAnother, onClose }: Props) {
  const w = design.work!;
  const page = activePage(w);
  const master = pageOf(w, w.master)!;
  const [resizeOpen, setResizeOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [safe, setSafe] = useState(true);
  const zone = safeZone(page.frame);

  const create = (pages: ResizedPage[]) => { design.actions.addPages(pages); setResizeOpen(false); };
  /** A page for a destination that wants a shape the design hasn't got. */
  const needSize = (presetId: string) => {
    const p = sizePreset(presetId);
    if (!p || w.pages.some(x => x.frame.w === p.frame.w && x.frame.h === p.frame.h && x.format === p.format)) return;
    design.actions.addPages([{ label: p.label, format: p.format, frame: p.frame, doc: resizeFallback(master.doc, p, w.fields, design.assets), origin: 'resized' }]);
  };
  const redo = (p: WorkPage) => design.actions.redoFromMaster(p.id, resizeFallback(master.doc, p, w.fields, design.assets));

  const resizeNode = <ResizeSheet doc={master.doc} fields={w.fields} assets={design.assets} onCreate={create} />;
  const publishNode = (
    <PublishSheet design={toRecordLike(w, design.email)} pages={w.pages.map(toPage)} render={design.render} onNeedSize={needSize}
      onDone={() => { setPublishOpen(false); if (w.id) design.finish(); }} />
  );

  const save = () => { void design.saveToShop(); };
  const publishDisabled = w.fresh;

  const extras: DesignerExtras = {
    panels: [
      { id: 'x:pictures', label: 'Pictures', title: 'Pictures', icon: <ImagePlus className="h-5 w-5" />, render: () => <PicturesPanel design={design} onAnother={onAnother} /> },
      { id: 'x:words', label: 'Words', title: 'Words', icon: <Type className="h-5 w-5" />, render: () => <WordsPanel design={design} adsOk={adsOk} /> },
      { id: 'x:resize', label: 'Resize', title: 'Resize', icon: <Maximize2 className="h-5 w-5" />, render: () => resizeNode },
      { id: 'x:check', label: 'Check', title: 'Check', icon: <ShieldCheck className="h-5 w-5" />, render: () => <CheckPanel design={design} adsOk={adsOk} /> },
      { id: 'x:publish', label: 'Publish', title: 'Publish', icon: <Rocket className="h-5 w-5" />, render: () => publishNode },
    ],
    startPanel: 'templates',
    closeLabel: 'Done',
    title: <span className="max-w-[40vw] truncate text-sm font-medium sm:max-w-[260px]">{displayName(w)}</span>,
    status: <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex"><span className={cn('h-1.5 w-1.5 rounded-full', w.dirty ? 'bg-amber-500' : 'bg-emerald-500')} />{page.label}</span>,
    actions: <Button size="sm" className="ml-1" disabled={design.saving || w.fresh} onClick={save}>{design.saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button>,
  };

  return (
    <div className="space-y-3">
      <span aria-hidden className={cn(headlineFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(bodyFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(serifFace.className, 'sr-only')}>.</span>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onClose}><ArrowLeft className="mr-1 h-4 w-4" /> Designs</Button>
        <span className="text-sm font-semibold">{kindLabel(w.kind)}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{displayName(w)}</span>
        {zone.top > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={safe} onChange={e => setSafe(e.target.checked)} /> Safe zones
          </label>
        )}
        <span className="hidden text-[11px] text-muted-foreground sm:inline">{design.draftSaved ? `Draft kept on this device ${design.draftSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        <Button variant="outline" size="sm" disabled={design.saving || w.fresh} onClick={save}>
          {design.saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save
        </Button>
        <Button size="sm" disabled={publishDisabled} onClick={() => setPublishOpen(true)}><Rocket className="mr-1 h-4 w-4" /> Publish</Button>
      </div>

      <PageStrip design={design} onAdd={() => setResizeOpen(true)} onRedo={redo} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0">
          {w.fresh || !design.marksReady ? (
            <div className="mx-auto flex aspect-[4/5] w-[300px] max-w-full items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laying it out…
            </div>
          ) : (
            <PageEditor key={`${page.id}:${page.ver}`} design={design} work={w} page={page} assets={design.assets} extras={extras}
              overlay={safe && zone.top > 0 ? (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-sky-500/60 bg-sky-500/15" style={{ height: `${(zone.top / page.frame.h) * 100}%` }} />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-sky-500/60 bg-sky-500/15" style={{ height: `${(zone.bottom / page.frame.h) * 100}%` }} />
                </>
              ) : undefined} />
          )}
        </div>
        <DesignPiece design={design} adsOk={adsOk} onAnother={onAnother} />
      </div>

      <Dialog open={resizeOpen} onOpenChange={setResizeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>More sizes</DialogTitle>
            <DialogDescription>Each size is made from the master{master.label ? ` (${master.label})` : ''}; your words follow.</DialogDescription>
          </DialogHeader>
          {resizeOpen && resizeNode}
        </DialogContent>
      </Dialog>

      <Sheet open={publishOpen} onOpenChange={setPublishOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Publish</SheetTitle>
            <SheetDescription>{displayName(w)} · {w.pages.length} size{w.pages.length === 1 ? '' : 's'}</SheetDescription>
          </SheetHeader>
          {publishOpen && publishNode}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── The editor for one page ────────────────────────────────────────────────

/**
 * Post a piece's editor on one page. It owns the document while it is mounted (its undo with it) and reports every
 * change up; a document set from outside (a layout, a re-do) remounts it through the key.
 */
function PageEditor({ design, work, page, assets, extras, overlay }: {
  design: DesignApi; work: DesignWork; page: WorkPage; assets: Assets; extras: DesignerExtras; overlay?: React.ReactNode;
}) {
  const doc = useStoryDoc(page.doc);
  const reported = useRef<StoryDoc>(page.doc);
  const { onDoc } = design;
  useEffect(() => {
    if (doc.doc !== reported.current) { reported.current = doc.doc; onDoc(page.id, doc.doc); }
  }, [doc.doc, onDoc, page.id]);

  const fields: Fields = work.fields;
  const info = sizeLine(page);
  const choose = (id: AdTemplateId) => doc.change(d => design.layOut(d, id, fields), { key: `layout:${id}` });
  const marked = design.marked;

  return (
    <SoloEditor side={{
      label: page.label, sub: info,
      props: {
        api: doc, square: true, fields, assets, extras,
        photos: design.photo ? [{ id: PHOTO, url: design.photo.url, label: design.photo.label || 'The photo' }] : [],
        palette: PALETTES[0], onPalette: () => undefined, lettered: null, weightOwnLine: true, websiteLabel: SITE_LABEL,
        onField: (b: Bind, v: string) => design.patchFields({ [b]: v }),
        presets: AD_TEMPLATES.map(t => ({ id: t.id, label: t.label })), onPreset: id => choose(id as AdTemplateId),
        previewPreset: id => applyAdTemplate(doc.doc, id as AdTemplateId, fields, assets, { photoMarked: marked }),
        fileName: safeName(displayName(work)),
        cropLabel: 'The photo', photoNote: 'Drag or pinch it to choose what shows; the piece should fill the frame on a phone.',
        overlay,
      },
    }} />
  );
}

const sizeLine = (p: WorkPage) => `${p.frame.w}×${p.frame.h}`;

// ── The page strip ─────────────────────────────────────────────────────────

function PageStrip({ design, onAdd, onRedo }: { design: DesignApi; onAdd: () => void; onRedo: (p: WorkPage) => void }) {
  const w = design.work!;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Sizes of this design">
      {w.pages.map(p => {
        const on = p.id === w.active;
        const isMaster = p.id === w.master;
        const behind = w.stale.includes(p.id);
        return (
          <div key={p.id} className={cn('relative flex shrink-0 flex-col items-center gap-1 rounded-xl border p-1.5', on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card')}>
            <button type="button" role="tab" aria-selected={on} onClick={() => design.actions.setActive(p.id)} className="min-h-0 rounded-md">
              <PageThumb design={design} page={p} />
            </button>
            <span className="max-w-[96px] truncate text-[11px] leading-tight">{p.label}</span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {isMaster ? <><Star className="h-3 w-3" /> Master</> : p.origin === 'manual' ? 'Edited' : behind ? <span className="text-amber-600 dark:text-amber-400">Behind the master</span> : 'From the master'}
            </span>
            {on && (
              <span className="flex items-center gap-0.5">
                {behind && <button type="button" onClick={() => onRedo(p)} className="min-h-0 rounded p-1 text-primary hover:bg-muted" title="Re-do from the master" aria-label="Re-do from the master"><RefreshCw className="h-3.5 w-3.5" /></button>}
                {!isMaster && <button type="button" onClick={() => design.actions.setMaster(p.id)} className="min-h-0 rounded p-1 text-muted-foreground hover:bg-muted" title="Make this the master" aria-label="Make this the master"><Star className="h-3.5 w-3.5" /></button>}
                {w.pages.length > 1 && <button type="button" onClick={() => { if (confirm(`Take “${p.label}” out of this design?`)) design.actions.removePage(p.id); }} className="min-h-0 rounded p-1 text-muted-foreground hover:bg-muted" title="Take this size out" aria-label="Take this size out"><Trash2 className="h-3.5 w-3.5" /></button>}
              </span>
            )}
          </div>
        );
      })}
      <button type="button" onClick={onAdd} className="flex min-h-0 w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs text-muted-foreground hover:border-primary hover:text-foreground">
        <Plus className="h-5 w-5" /> Size
      </button>
    </div>
  );
}

/** A page drawn small — a moment after it stops changing, so a drag on the big one stays smooth. */
function PageThumb({ design, page }: { design: DesignApi; page: WorkPage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { fields } = design.work!;
  const h = 76;
  const w = Math.max(24, Math.min(110, Math.round((h * page.frame.w) / page.frame.h)));
  const { assets } = design;
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      try {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        const src = renderDocTo(reflow(page.doc, fields, assets), fields, assets, c.width);
        c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      } catch { /* a font or image still loading: the next change draws it */ }
    }, 500);
    return () => clearTimeout(t);
  }, [page.doc, page.ver, fields, assets, w]);
  return <canvas ref={ref} style={{ width: w, height: h }} className="rounded-md bg-muted" aria-hidden />;
}
