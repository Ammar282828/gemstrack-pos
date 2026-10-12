'use client';

/**
 * The three pieces other work packages build, as typed slots (docs/features/design-studio-plan.md WP3/WP4/WP5).
 * They do not exist in this branch, so each slot here is a small working stand-in with exactly the props the
 * real one takes. THE INTEGRATION CHANGES THIS FILE ONLY: replace each stand-in with
 *
 *   export { ResizeSheet } from './resize-sheet';        // WP3
 *   export { SmartInput } from './smart-input';          // WP4
 *   export { PublishSheet } from './publish-sheet';      // WP5
 *
 * (keeping the exported prop types if the real ones differ in name only) and deleting `resizeFallback` once
 * the resize engine (`resize()` in lib/design) can answer `onNeedSize`.
 *
 * The shell mounts each slot only when it is wanted — ResizeSheet and PublishSheet inside its own dialog,
 * SmartInput always on the start screen — so a real one may be heavy.
 */

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { carryLayers, frameOf, type Assets, type Fields, type StoryDoc } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';
import { applyAdTemplate, blankAd, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import type { DesignPage, DesignRecord, PageOrigin } from '@/lib/design/model';
import { SIZE_GROUPS, sizePreset, type SizePreset } from '@/lib/design/sizes';
import { downloadBlob, safeName } from '../ads/studio/studio-kit';

// ── WP3: the resize sheet ──────────────────────────────────────────────────

/** A page the resize sheet makes: its shape, its document, and (when it says) where it came from. */
export interface ResizedPage {
  id?: string;
  label: string;
  format: AdFormat;
  frame: Frame;
  doc: StoryDoc;
  origin?: PageOrigin;
  syncedFrom?: string;
}

export interface ResizeSheetProps {
  /** The master page's document. */
  doc: StoryDoc;
  fields: Fields;
  assets: Assets;
  /** Where the piece sits in the photo (0..1), when known. */
  subject?: { x: number; y: number; w: number; h: number };
  onCreate: (pages: ResizedPage[]) => void;
}

/**
 * The stand-in: size chips, and each chosen size laid out again from the master — by its template when it has
 * one, else the master's layers carried across. No scoring, no AI.
 */
export function ResizeSheet({ doc, fields, assets, onCreate }: ResizeSheetProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const groups = useMemo(() => (['ads', 'whatsapp', 'website', 'story', 'more'] as const).map(g => ({ g, items: SIZE_GROUPS[g].map(id => sizePreset(id)).filter((p): p is SizePreset => !!p) })), []);
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Pick the sizes to make from this design.</p>
      {groups.map(({ g, items }) => (
        <div key={g} className="space-y-1">
          <p className="text-[11px] font-medium capitalize text-muted-foreground">{g}</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map(p => (
              <button key={p.id} type="button" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}
                className={cn('min-h-0 rounded-full border px-3 py-1.5 text-xs', picked.includes(p.id) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Button className="w-full" disabled={!picked.length}
        onClick={() => onCreate(picked.map(id => sizePreset(id)!).map(p => ({ label: p.label, format: p.format, frame: p.frame, doc: resizeFallback(doc, p, fields, assets), origin: 'resized' as const })))}>
        Make {picked.length || ''} size{picked.length === 1 ? '' : 's'}
      </Button>
    </div>
  );
}

/** The master's design on another shape: re-laid by its template, else its layers carried across. Pure. */
export function resizeFallback(doc: StoryDoc, to: { format: AdFormat; frame: Frame }, fields: Fields, assets: Assets): StoryDoc {
  const blank = blankAd(to.format, to.frame);
  const base: StoryDoc = { ...blank, bg: { ...blank.bg, ...doc.bg, placement: doc.bg.placement } };
  const template = doc.meta?.template as AdTemplateId | undefined;
  if (template) return applyAdTemplate(base, template, fields, assets, { photoMarked: false });
  return { ...base, layers: carryLayers(doc.layers, frameOf(doc), base, fields, assets) };
}

// ── WP4: the smart input ───────────────────────────────────────────────────

/** A photograph the input found: by reference (`site:<id>`, `lib:<assetId>`, an https address), or the file itself. */
export interface ParsedPhoto { ref: string; role: 'main' | 'alt'; blob?: Blob }

export interface SmartInputProps {
  /** What the input understood: the words it could fill, and the photographs it found. */
  onParsed: (fields: Partial<Fields>, photos: ParsedPhoto[]) => void;
  className?: string;
}

/** The stand-in: one box; the first line is the headline, the rest the specs line. */
export function SmartInput({ onParsed, className }: SmartInputProps) {
  const [text, setText] = useState('');
  return (
    <div className={cn('space-y-2', className)}>
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Paste anything — a caption, a message, a link…" className="text-base sm:text-sm" />
      <Button variant="outline" size="sm" disabled={!text.trim()} onClick={() => {
        const [head, ...rest] = text.trim().split('\n').map(s => s.trim()).filter(Boolean);
        onParsed({ headline: head ?? '', weight: rest.join(' · ') }, []);
        setText('');
      }}>Use this</Button>
    </div>
  );
}

// ── WP5: the publish sheet ─────────────────────────────────────────────────

export interface PublishSheetProps {
  design: DesignRecord;
  pages: DesignPage[];
  /** A page drawn at this width, as a JPEG. */
  render: (pageId: string, px: number) => Promise<Blob>;
  /** A destination wants a size the design has no page for: the shell makes one (a SIZE_PRESETS id). */
  onNeedSize: (presetId: string) => void;
  onDone: () => void;
}

/** The stand-in: every page as a download. */
export function PublishSheet({ design, pages, render, onDone }: PublishSheetProps) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Sending to the website, WhatsApp, Instagram and Meta arrives with the publish sheet. For now, download each size.</p>
      <ul className="space-y-1.5">
        {pages.map(p => (
          <li key={p.id} className="flex items-center gap-2 rounded-lg border p-2">
            <span className="min-w-0 flex-1 truncate text-sm">{p.label}</span>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={async () => {
              setBusy(p.id);
              try { downloadBlob(await render(p.id, 1080), `${safeName(design.name)}-${p.label.replace(/[^\w]+/g, '-')}.jpg`); } finally { setBusy(null); }
            }}>
              {busy === p.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} Download
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
    </div>
  );
}
