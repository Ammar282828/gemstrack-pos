'use client';

/**
 * The small parts every designer panel is built from (rows, sliders, pills, colour rows, number fields), kept in
 * one place so the panels in this folder and editor-panels.tsx share them without importing one another.
 * Everything a finger touches grows on a coarse pointer, and every field is 16 px on a phone (an iPhone zooms
 * the whole page into anything smaller).
 */

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FONT_KEYS, fontCss, type FontKey } from '@/lib/social/editor';
import type { AlignHow } from '@/lib/social/design';
import type { Editor } from '../story-editor';

export const Z = 'z-[70]'; // above the designer, which sits over the page
/** An icon button that grows to a finger's size on a touch screen. */
export const IB = `h-7 w-7 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9`;

export const SWATCHES = ['#FFFFFF', '#111111', '#1F4A2C', '#2E9E57', '#C07A3E', '#C9973F', '#2C3480', '#7A5A35', '#E8D5B5', '#8B1E2D'];

/** The colours already in the design, as Canva offers them first. */
export function docColours(ed: Editor): string[] {
  const out = new Set<string>();
  const put = (c?: string | null) => { if (c && /^#[0-9a-f]{6}$/i.test(c)) out.add(c.toUpperCase()); };
  put(ed.doc.bg.color); put(ed.doc.bg.color2);
  for (const l of ed.doc.layers) {
    if (l.kind === 'text') { put(l.color); put(l.box?.color); put(l.effect?.color); }
    else if (l.kind === 'image') put(l.border);
    else if (l.kind === 'wordmark') put(l.color);
    else if (l.kind === 'qr') { put(l.fg); put(l.bg); }
    else { put(l.color); put(l.fill); put(l.fill2); }
  }
  return [...out].filter(c => !SWATCHES.includes(c)).slice(0, 10);
}

export function ColourRow({ value, onChange, extra = [] }: { value: string; onChange: (c: string) => void; extra?: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[...extra, ...SWATCHES].map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={cn('h-7 min-h-0 w-7 shrink-0 rounded-full border-2 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9', value?.toLowerCase() === c.toLowerCase() ? 'border-primary' : 'border-border')} style={{ background: c }} />
      ))}
      <label className="h-7 w-7 shrink-0 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer text-[10px] text-muted-foreground [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9" title="Any colour">
        +<input type="color" value={value?.length === 7 ? value : '#ffffff'} onChange={e => onChange(e.target.value)} className="sr-only" />
      </label>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0 text-muted-foreground text-xs">{label}</span><span className="flex-1 min-w-0">{children}</span></label>;
}
export const Num = ({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) => (
  <div className="flex items-center gap-2"><Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="flex-1" /><span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(value * 100) / 100}</span></div>
);
export function Pills({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border p-0.5">
      {options.map(([v, l]) => <button key={v} type="button" onClick={() => onChange(v)} className={cn('rounded-full px-2.5 py-1 text-xs', `[@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:py-1.5`, value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{l}</button>)}
    </div>
  );
}
export const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="space-y-2 pt-3 first:pt-0">
    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>{right}</div>
    {children}
  </div>
);
export const Tool = ({ title, active, onClick, children, disabled }: { title: string; active?: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean }) => (
  <button type="button" title={title} disabled={disabled} onClick={onClick}
    className={cn('flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs disabled:opacity-40', active ? 'bg-primary/15 text-primary' : 'hover:bg-muted')}>
    {children}
  </button>
);

/** A shape's outline as a little SVG, for the pickers. */
export const ShapeIcon = ({ path, fill = 'currentColor', size = 40 }: { path: string; fill?: string; size?: number }) => (
  <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden><path d={path} fill={fill} /></svg>
);

/** The piece's photos and the text on them are drawn in these CSS faces too. */
export const faceStyle = (ed: Editor, font: FontKey, px: number): React.CSSProperties => ({ font: fontCss(font, px, ed.assets.fonts) });

/**
 * Load every face the designer has (the shop's and the six added in v2) the first time a list of them is looked
 * at, so the list shows each in its own letters and the canvas can use one the moment it is picked.
 */
export function loadFaces(ed: Editor, which: readonly FontKey[] = FONT_KEYS) {
  for (const f of which) {
    const css = fontCss(f, 40, ed.assets.fonts);
    try { if (!document.fonts.check(css)) document.fonts.load(css).then(() => ed.tick()).catch(() => undefined); } catch { /* an old browser */ }
  }
}

/**
 * A number the person can type: a 16-px field on a phone, committed on Enter or when it loses focus, and shown as
 * the value moves (a drag on the canvas) while it is not being typed in. `suffix` is a unit shown inside.
 */
export function NumField({ label, value, onCommit, min, max, step = 1, suffix, disabled, title, decimals = 0 }: {
  label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean; title?: string; decimals?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const shown = text ?? String(Math.round(value * 10 ** decimals) / 10 ** decimals);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    setText(null);
    if (!text.trim() || !Number.isFinite(v)) return;
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (Math.abs(c - value) > 1e-9) onCommit(c);
  };
  const bump = (d: number) => { const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round((value + d) * 10 ** decimals) / 10 ** decimals)); onCommit(v); setText(null); };
  return (
    <label className="block space-y-1" title={title}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="relative block">
        <Input ref={ref} type="text" inputMode={decimals || (min ?? 0) < 0 ? 'decimal' : 'numeric'} value={shown} disabled={disabled}
          onFocus={e => e.currentTarget.select()}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); ref.current?.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); setText(null); ref.current?.blur(); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); bump((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step); }
            e.stopPropagation();
          }}
          className={cn('h-9 text-base tabular-nums md:h-8 md:text-xs', suffix && 'pr-7')} />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

/** Line up the selection with the page (one thing) or with each other (several), and space three or more evenly. */
export function AlignButtons({ ed }: { ed: Editor }) {
  const many = ed.selLayers.length > 1 && !ed.grouped;
  const items: [AlignHow, string, React.ReactNode][] = [
    ['left', 'Left', <AlignStartVertical key="l" className="h-4 w-4" />], ['center', 'Centre', <AlignCenterVertical key="c" className="h-4 w-4" />], ['right', 'Right', <AlignEndVertical key="r" className="h-4 w-4" />],
    ['top', 'Top', <AlignStartHorizontal key="t" className="h-4 w-4" />], ['middle', 'Middle', <AlignCenterHorizontal key="m" className="h-4 w-4" />], ['bottom', 'Bottom', <AlignEndHorizontal key="b" className="h-4 w-4" />],
  ];
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">{many ? 'Line them up with each other' : 'Line it up with the page'}</p>
      <div className="grid grid-cols-3 gap-1">
        {items.map(([how, label, icon]) => <Button key={how} size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.align(how)}>{icon}<span className="ml-1.5">{label}</span></Button>)}
      </div>
      {ed.selLayers.length > 2 && (
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => ed.distribute('h')}><AlignHorizontalDistributeCenter className="h-4 w-4 mr-1.5" /> Space across</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => ed.distribute('v')}><AlignVerticalDistributeCenter className="h-4 w-4 mr-1.5" /> Space down</Button>
        </div>
      )}
    </div>
  );
}
