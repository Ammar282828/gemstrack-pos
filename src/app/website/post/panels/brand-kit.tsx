'use client';

/**
 * The brand kit (designer v2): the house's own colours and foils (read-only: they come from the brand file and the
 * lettering palettes, so both houses carry their own), the colours the person has saved on this device, and the
 * brand fonts. Tapping a colour paints what is selected, or the page when nothing is.
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FONT_KEYS, FONT_LABEL, newInFont, type FontKey, type Gradient, type Layer } from '@/lib/social/editor';
import { PALETTES } from '@/lib/social/palettes';
import { VISUAL } from '@/lib/ads/studio/brand';
import type { Editor } from '../story-editor';
import { Section, SWATCHES, docColours, faceStyle, loadFaces } from './kit';
import { FOILS, GradientChip } from './gradient-editor';

const KEY = 'designer_brand_colours';
const MAX = 24;
const HEX = /^#[0-9a-f]{6}$/i;

/** The colours saved on this device. */
export function useMyColours() {
  const [mine, setMine] = useState<string[]>([]);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(v)) setMine(v.filter((c): c is string => typeof c === 'string' && HEX.test(c))); } catch { /* none saved */ }
  }, []);
  const write = (next: string[]) => { setMine(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  return {
    mine,
    add: (c: string) => { const u = c.toUpperCase(); if (HEX.test(u)) write([u, ...mine.filter(x => x !== u)].slice(0, MAX)); },
    remove: (c: string) => write(mine.filter(x => x !== c)),
  };
}

/** The house kit as named swatches. */
export function houseColours(): { name: string; hex: string }[] {
  const out = [
    { name: 'Main', hex: VISUAL.gold }, { name: 'Light', hex: VISUAL.lightGold }, { name: 'Ground', hex: VISUAL.ground }, { name: 'Ground 2', hex: VISUAL.ground2 }, { name: 'Bone', hex: VISUAL.bone },
  ];
  const seen = new Set(out.map(c => c.hex.toUpperCase()));
  for (const p of PALETTES) for (const [n, hex] of [[p.label, p.headline], [`${p.label} line`, p.body]] as const) {
    if (!seen.has(hex.toUpperCase())) { seen.add(hex.toUpperCase()); out.push({ name: n, hex }); }
  }
  return out;
}

export function BrandKitPanel({ ed }: { ed: Editor }) {
  const F = ed.F;
  const { mine, add, remove } = useMyColours();
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState('#C9973F');
  const house = houseColours();

  /** A colour on whatever is selected, or behind everything when nothing is. */
  const paint = (c: string) => {
    if (!ed.selLayers.length) { ed.api.change(d => ({ ...d, bg: { ...d.bg, color: c, fill: null } }), { key: 'bg:color' }); return; }
    ed.updateSel(l => l.kind === 'text' ? { ...l, color: c, autoColor: false, fillGradient: null }
      : l.kind === 'wordmark' ? { ...l, color: c, autoColor: false }
        : l.kind === 'image' ? { ...l, border: c }
          : l.kind === 'qr' ? { ...l, fg: c }
            : (l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape') && l.fill ? { ...l, fill: c, fillGradient: null } : { ...l, color: c }, 'brand');
  };
  /** A foil on the selected text and shapes, or behind everything when nothing is selected. */
  const paintFoil = (g: Gradient) => {
    if (!ed.selLayers.length) { ed.api.change(d => ({ ...d, bg: { ...d.bg, fill: g } }), { key: 'bg:fill' }); return; }
    ed.updateSel(l => l.kind === 'text' ? { ...l, fillGradient: g }
      : l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape' ? { ...l, fillGradient: g } as Layer : l, 'brand-foil');
  };
  const fonts = FONT_KEYS;
  useEffect(() => { loadFaces(ed); }, [ed.assets.fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = ed.one?.kind === 'text' ? ed.one : null;
  const Swatch = ({ hex, title, onRemove }: { hex: string; title: string; onRemove?: () => void }) => (
    <span className="relative">
      <button type="button" title={`${title} ${hex}`} aria-label={`${title} ${hex}`} onClick={() => paint(hex)} className="h-9 w-9 rounded-full border [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10" style={{ background: hex }} />
      {onRemove && <button type="button" aria-label={`Remove ${hex}`} onClick={onRemove} className="absolute -right-1 -top-1 flex h-4 min-h-0 w-4 items-center justify-center rounded-full bg-destructive text-white"><X className="h-3 w-3" /></button>}
    </span>
  );

  return (
    <div className="space-y-4">
      <Section title="The house’s colours">
        <p className="text-[11px] text-muted-foreground">{ed.selLayers.length ? 'Tap one to use it on what is selected.' : 'Tap one for the colour behind — or select something first.'}</p>
        <div className="flex flex-wrap gap-2">{house.map(c => <Swatch key={c.hex} hex={c.hex} title={c.name} />)}</div>
        <div className="flex flex-wrap gap-2 pt-1">{FOILS.map(f => <GradientChip key={f.id} g={f.gradient} title={f.label} onClick={() => paintFoil(f.gradient)} />)}</div>
        <p className="text-[11px] text-muted-foreground">Foils paint text and shapes with a metallic gradient.</p>
      </Section>

      <Section title="My colours" right={mine.length > 0 ? <button type="button" className="text-xs text-muted-foreground" onClick={() => setEditing(e => !e)}>{editing ? 'Done' : 'Edit'}</button> : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {mine.map(c => <Swatch key={c} hex={c} title="Saved" onRemove={editing ? () => remove(c) : undefined} />)}
          {mine.length === 0 && <p className="text-[11px] text-muted-foreground">Colours you save stay on this device, for every design.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-dashed" style={{ background: pick }} title="Pick a colour">
            <input type="color" value={pick} onChange={e => setPick(e.target.value)} className="sr-only" />
          </label>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => add(pick)}><Plus className="mr-1 h-3.5 w-3.5" /> Save {pick.toUpperCase()}</Button>
          {docColours(ed).length > 0 && <Button type="button" size="sm" variant="ghost" className="h-9 text-xs" onClick={() => docColours(ed).forEach(add)}>Save this design’s</Button>}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">{SWATCHES.map(c => <button key={c} type="button" title={`Use ${c}`} onClick={() => setPick(c)} className={cn('h-6 w-6 rounded-full border [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', pick.toUpperCase() === c && 'ring-2 ring-primary')} style={{ background: c }} />)}</div>
      </Section>

      <Section title="Brand fonts">
        <p className="text-[11px] text-muted-foreground">{text ? 'Tap one to set the selected text in it.' : 'Tap one to add a line in it.'}</p>
        <div className="space-y-1">
          {fonts.map((f: FontKey) => (
            <button key={f} type="button" onClick={() => text ? ed.update(text.id, { font: f }) : ed.add(newInFont(f, ed.p.palette.body, F))}
              className={cn('flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left hover:border-primary', text?.font === f && 'border-primary')}>
              <span style={faceStyle(ed, f, f === 'script' ? 24 : 18)}>{FONT_LABEL[f].replace(/ \(.*\)$/, '')}</span>
              {text?.font === f && <span className="text-[10px] text-primary">in use</span>}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
