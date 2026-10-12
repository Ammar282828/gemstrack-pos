'use client';

/**
 * The gradient editor (designer v2): linear at any angle or radial, any number of stops (2 to 8), each with its own
 * colour, position and opacity. One component serves the fill of text, of shapes and the page behind. The bar is
 * the gradient itself: tap it to add a stop, drag a stop to move it. Foil presets (gold, rose, silver) start it.
 */

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Gradient } from '@/lib/social/editor';
import { GOLD_FOIL, ROSE_FOIL, SILVER_FOIL, gradientAt, gradientCss, normalizeGradient, reverseGradient, simpleGradient } from '@/lib/social/gradient';
import { STORE_BRAND } from '@/lib/store-config';
import { ColourRow, Num, Pills, Row } from './kit';

/** The three foils, the house's own first (gold and rose for Taheri, silver for House of Mina). */
export const FOILS: { id: string; label: string; gradient: Gradient }[] = (() => {
  const all = [
    { id: 'gold', label: 'Gold foil', gradient: GOLD_FOIL },
    { id: 'rose', label: 'Rose gold', gradient: ROSE_FOIL },
    { id: 'silver', label: 'Silver foil', gradient: SILVER_FOIL },
  ];
  return STORE_BRAND === 'mina' ? [all[2], all[1], all[0]] : all;
})();

const OTHER_PRESETS: { id: string; label: string; gradient: Gradient }[] = [
  { id: 'dusk', label: 'Dark fade', gradient: simpleGradient('#000000', '#1F4A2C', 180) },
  { id: 'glow', label: 'Soft glow', gradient: { type: 'radial', angle: 0, stops: [{ at: 0, color: '#FFE9B0' }, { at: 1, color: '#C9973F', alpha: 0 }] } },
  { id: 'ivory', label: 'Ivory', gradient: simpleGradient('#FBF6EC', '#E8D5B5', 160) },
];

/** A little swatch of a gradient, for the preset buttons. */
export function GradientChip({ g, title, onClick, active, className }: { g: Gradient; title: string; onClick?: () => void; active?: boolean; className?: string }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={cn('h-9 min-h-0 w-14 shrink-0 rounded-md border-2 [@media(pointer:coarse)]:h-10', active ? 'border-primary' : 'border-border', className)} style={{ background: gradientCss(g) }} />
  );
}

const ANGLES: [string, string][] = [['180', '↓'], ['0', '↑'], ['90', '→'], ['270', '←'], ['135', '↘'], ['225', '↙'], ['45', '↗'], ['315', '↖']];

export function GradientEditor({ value, onChange, colours = [] }: { value: Gradient; onChange: (g: Gradient, key?: string) => void; colours?: string[] }) {
  const g = normalizeGradient(value);
  const [sel, setSel] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number } | null>(null);
  const at = Math.min(sel, g.stops.length - 1);
  const stop = g.stops[at];
  const put = (stops: Gradient['stops'], key?: string) => onChange({ ...g, stops }, key);
  const setStop = (i: number, patch: Partial<Gradient['stops'][number]>, key?: string) => put(g.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)), key);

  const posOf = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const addAt = (t: number) => {
    if (g.stops.length >= 8) return;
    const c = gradientAt(g, t);
    const color = c ? `#${[c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}` : '#ffffff';
    const stops = [...g.stops, { at: Math.round(t * 100) / 100, color, ...(c && c.a < 1 ? { alpha: Math.round(c.a * 100) / 100 } : {}) }].sort((a, b) => a.at - b.at);
    onChange({ ...g, stops });
    setSel(stops.findIndex(s => s.at === Math.round(t * 100) / 100));
  };
  const remove = () => { if (g.stops.length > 2) { put(g.stops.filter((_, k) => k !== at)); setSel(0); } };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[...FOILS, ...OTHER_PRESETS].map(p => <GradientChip key={p.id} g={p.gradient} title={p.label} onClick={() => { onChange(p.gradient); setSel(0); }} />)}
      </div>

      <Row label="Kind"><Pills value={g.type} options={[['linear', 'Linear'], ['radial', 'Radial']]} onChange={v => onChange({ ...g, type: v as Gradient['type'] })} /></Row>
      {g.type === 'linear' && (<>
        <Row label="Direction"><Pills value={ANGLES.some(([a]) => Number(a) === Math.round(g.angle)) ? String(Math.round(g.angle)) : ''} options={ANGLES} onChange={v => onChange({ ...g, angle: Number(v) })} /></Row>
        <Row label="Angle"><Num value={Math.round(g.angle)} min={0} max={360} onChange={v => onChange({ ...g, angle: v }, 'g-angle')} /></Row>
      </>)}

      {/* The gradient as a bar: its stops sit under it. */}
      <div className="pt-1">
        <div ref={barRef} className="relative h-9 touch-none select-none rounded-md border" style={{ background: `${gradientCss({ ...g, type: 'linear', angle: 90 })}, repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 12px 12px` }}
          onPointerDown={e => { if (e.target === e.currentTarget) addAt(posOf(e.clientX)); }}
          onPointerMove={e => { if (drag.current) setStop(drag.current.i, { at: Math.round(posOf(e.clientX) * 100) / 100 }, 'g-pos'); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          {g.stops.map((s, i) => (
            <button key={i} type="button" aria-label={`Stop ${i + 1}`} title="Drag to move; tap the bar to add another"
              onPointerDown={e => { e.stopPropagation(); (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); drag.current = { i }; setSel(i); }}
              className={cn('absolute top-full -mt-0.5 h-5 w-5 min-h-0 -translate-x-1/2 rounded-full border-2 shadow [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7', i === at ? 'border-primary ring-2 ring-primary/30' : 'border-white')}
              style={{ left: `${s.at * 100}%`, background: s.color }} />
          ))}
        </div>
        <div className="h-6 [@media(pointer:coarse)]:h-8" />
      </div>

      <div className="space-y-2 rounded-md bg-muted/40 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Stop {at + 1} of {g.stops.length}</span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => addAt(stop.at < 0.85 ? stop.at + 0.15 : stop.at - 0.15)} disabled={g.stops.length >= 8}><Plus className="mr-1 h-3 w-3" /> Add</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={remove} disabled={g.stops.length <= 2}><Trash2 className="mr-1 h-3 w-3" /> Remove</Button>
          </span>
        </div>
        <ColourRow value={stop.color} onChange={c => setStop(at, { color: c }, 'g-colour')} extra={colours} />
        <Row label="Position"><Num value={Math.round(stop.at * 100)} min={0} max={100} onChange={v => setStop(at, { at: v / 100 }, 'g-pos')} /></Row>
        <Row label="Opacity"><Num value={Math.round((stop.alpha ?? 1) * 100)} min={0} max={100} onChange={v => setStop(at, { alpha: v / 100 >= 1 ? undefined : v / 100 }, 'g-alpha')} /></Row>
      </div>

      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onChange(reverseGradient(g))}><ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" /> Reverse</Button>
    </div>
  );
}

/** A switch that turns a gradient on (starting from `start`) or off, with the editor under it while it is on. */
export function GradientToggle({ label, value, onChange, start, colours }: {
  label: string; value: Gradient | null | undefined; onChange: (g: Gradient | null, key?: string) => void; start: Gradient; colours?: string[];
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!value} onCheckedChange={v => onChange(v ? start : null)} /> {label}</label>
      {value && <GradientEditor value={value} onChange={onChange} colours={colours} />}
    </div>
  );
}

/** A plain gradient from one colour to a darker or lighter cousin of it, to begin a gradient from a solid fill. */
export function gradientFrom(color: string): Gradient {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return GOLD_FOIL;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, gr = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  const k = lum > 140 ? 0.55 : 1.6;
  const mix = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return simpleGradient(color, `#${[mix(r), mix(gr), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`, 160);
}
