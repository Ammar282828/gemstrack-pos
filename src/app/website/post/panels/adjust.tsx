'use client';

/**
 * Photo adjustments (designer v2): the filter strip, three quick fixes for jewellery shots (glare on gold, dull
 * stones), every slider the engine has grouped by what it does, and a button that shows the photo as it was while
 * it is held down.
 */

import React, { useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FILTERS, NO_ADJUST, applyAdjust, isPlain, type Adjust } from '@/lib/social/design';
import type { StoryDoc } from '@/lib/social/editor';
import { Num, Row, Section } from './kit';

type Key = keyof Adjust;
const GROUPS: { title: string; sliders: { k: Key; label: string; min: number; max: number }[] }[] = [
  { title: 'Light', sliders: [
    { k: 'brightness', label: 'Brightness', min: -100, max: 100 }, { k: 'contrast', label: 'Contrast', min: -100, max: 100 },
    { k: 'highlights', label: 'Highlights', min: -100, max: 100 }, { k: 'shadows', label: 'Shadows', min: -100, max: 100 }, { k: 'fade', label: 'Fade', min: 0, max: 100 },
  ] },
  { title: 'Colour', sliders: [
    { k: 'saturation', label: 'Saturation', min: -100, max: 100 }, { k: 'warmth', label: 'Warmth', min: -100, max: 100 },
    { k: 'tint', label: 'Tint', min: -100, max: 100 }, { k: 'hue', label: 'Hue', min: -100, max: 100 },
  ] },
  { title: 'Detail', sliders: [
    { k: 'sharpen', label: 'Sharpen', min: 0, max: 100 }, { k: 'blur', label: 'Blur', min: 0, max: 100 },
    { k: 'grain', label: 'Grain', min: 0, max: 100 }, { k: 'vignette', label: 'Vignette', min: 0, max: 100 },
  ] },
];

/** One-tap fixes for what goes wrong in a jewellery photograph; they add to whatever is already set. */
const QUICK_FIXES: { id: string; label: string; hint: string; patch: Partial<Adjust> }[] = [
  { id: 'glare', label: 'Tame glare', hint: 'Pulls gold’s hot spots back', patch: { highlights: -55, shadows: 25 } },
  { id: 'sparkle', label: 'Sparkle', hint: 'Crisper facets on stones', patch: { sharpen: 55, contrast: 12, highlights: -15 } },
  { id: 'warm', label: 'Warm gold', hint: 'A richer, warmer yellow', patch: { warmth: 22, saturation: 10, tint: 4 } },
];

/** The filter thumbnails: the photo through each preset, drawn once per photo. */
function useFilterThumbs(img: HTMLImageElement | null): Record<string, string> {
  return useMemo(() => {
    if (!img || !img.naturalWidth) return {};
    const out: Record<string, string> = {};
    const s = 96, c = document.createElement('canvas');
    c.width = s; c.height = s;
    const t = c.getContext('2d', { willReadFrequently: true })!;
    const k = Math.max(s / img.naturalWidth, s / img.naturalHeight);
    for (const f of FILTERS) {
      t.drawImage(img, (s - img.naturalWidth * k) / 2, (s - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      try {
        if (!isPlain({ ...f.adjust, vignette: 0 })) { const d = t.getImageData(0, 0, s, s); applyAdjust(d.data, f.adjust, s, s); t.putImageData(d, 0, 0); }
        if (f.adjust.vignette) {
          const g = t.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.72);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${f.adjust.vignette / 100 * 0.85})`);
          t.fillStyle = g; t.fillRect(0, 0, s, s);
        }
        out[f.id] = c.toDataURL('image/jpeg', 0.7);
      } catch { /* a tainted image: no thumbnails */ }
    }
    return out;
  }, [img]);
}

/**
 * A photo's filter strip, quick fixes and sliders. `onCompare(true)` is called when the compare button goes down
 * and `onCompare(false)` when it is let go: the host shows the photo without its adjustments meanwhile.
 */
export function AdjustControls({ value, onChange, img, onCompare, openByDefault }: {
  value: Adjust; onChange: (a: Adjust, key?: string) => void; img: HTMLImageElement | null; onCompare?: (on: boolean) => void; openByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!!openByDefault);
  const thumbs = useFilterThumbs(img);
  const current = FILTERS.find(f => JSON.stringify(f.adjust) === JSON.stringify(value))?.id;
  const plain = isPlain(value);
  const v = (k: Key) => (value[k] as number | undefined) ?? 0;
  return (
    <div className="space-y-3">
      {onCompare && (
        <button type="button" disabled={plain}
          onPointerDown={e => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onCompare(true); }}
          onPointerUp={() => onCompare(false)} onPointerCancel={() => onCompare(false)} onLostPointerCapture={() => onCompare(false)}
          onContextMenu={e => e.preventDefault()}
          className="flex h-10 w-full select-none touch-none items-center justify-center gap-2 rounded-md border text-sm hover:bg-muted disabled:opacity-40 active:bg-primary/10 [-webkit-touch-callout:none]">
          <Eye className="h-4 w-4" /> Hold to see the original
        </button>
      )}
      <div className="flex gap-1.5 overflow-x-auto pb-1">{FILTERS.map(f => (
        <button key={f.id} type="button" onClick={() => onChange(f.adjust)} className="shrink-0 space-y-0.5 text-center">
          <span className={cn('block h-14 w-14 overflow-hidden rounded-md border-2 bg-muted', current === f.id ? 'border-primary' : 'border-transparent')}>
            {thumbs[f.id] && <img src={thumbs[f.id]} alt="" className="h-full w-full object-cover" />}
          </span>
          <span className="block text-[10px] text-muted-foreground">{f.label}</span>
        </button>
      ))}</div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_FIXES.map(q => (
          <button key={q.id} type="button" title={q.hint} onClick={() => onChange({ ...value, ...q.patch })}
            className="rounded-full border px-3 py-1 text-xs hover:bg-muted [@media(pointer:coarse)]:py-1.5">{q.label}</button>
        ))}
      </div>
      <button type="button" className="inline-flex items-center gap-1 text-xs text-primary" onClick={() => setOpen(o => !o)}>{open ? 'Hide the sliders' : 'Fine-tune with sliders'}</button>
      {open && (
        <div className="space-y-1">
          {GROUPS.map(g => (
            <Section key={g.title} title={g.title}>
              {g.sliders.map(s => <Row key={s.k} label={s.label}><Num value={v(s.k)} min={s.min} max={s.max} onChange={n => onChange({ ...value, [s.k]: n }, `adj-${s.k}`)} /></Row>)}
            </Section>
          ))}
          <button type="button" className="pt-2 text-xs text-muted-foreground" onClick={() => onChange(NO_ADJUST)}>Reset everything</button>
        </div>
      )}
    </div>
  );
}

/** "Cut out": the photo is a PNG with a transparent background (from the background remover), so it has no frame or fill of its own. */
export function CutoutSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs"><Switch checked={value} onCheckedChange={onChange} /> Cut out (transparent background)</label>
      <p className="text-[11px] text-muted-foreground">Turn on for a PNG whose background is already removed: it is drawn with no frame or border, and its shadow follows the piece’s own outline.</p>
    </div>
  );
}

/**
 * The document as it was before its photo adjustments, for the hold-to-compare button: the selected photos only
 * (or, when no photo is selected, the page’s background photo).
 */
export function withoutAdjust(doc: StoryDoc, ids: string[]): StoryDoc {
  const photosSelected = doc.layers.some(l => l.kind === 'image' && ids.includes(l.id));
  if (photosSelected) return { ...doc, layers: doc.layers.map(l => (l.kind === 'image' && ids.includes(l.id) && l.adjust ? { ...l, adjust: null } : l)) };
  return doc.bg.adjust ? { ...doc, bg: { ...doc.bg, adjust: null } } : doc;
}
