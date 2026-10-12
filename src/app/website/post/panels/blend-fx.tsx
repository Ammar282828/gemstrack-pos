'use client';

/**
 * Blend modes and layer effects (designer v2): how a layer mixes with what is under it, and its shadow, glow and
 * outline (shapes, photos, marks and QR codes; text keeps its own effects). Both apply to the whole selection.
 */

import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Blend, Layer, LayerFx } from '@/lib/social/editor';
import { FX_DEFAULTS } from '@/lib/social/editor';
import type { Editor } from '../story-editor';
import { ColourRow, Num, Row, Section, Z, docColours } from './kit';

export const BLENDS: { id: Blend; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'Just on top' },
  { id: 'multiply', label: 'Multiply', hint: 'Darkens: a soft shadow under a cut-out piece' },
  { id: 'screen', label: 'Screen', hint: 'Lightens: glow, sparkle, gold light' },
  { id: 'overlay', label: 'Overlay', hint: 'Deepens contrast and colour' },
  { id: 'soft-light', label: 'Soft light', hint: 'A gentle wash of colour or light' },
  { id: 'hard-light', label: 'Hard light', hint: 'A strong wash' },
  { id: 'color-dodge', label: 'Colour dodge', hint: 'Bright, burning highlights' },
  { id: 'darken', label: 'Darken', hint: 'Keeps whichever is darker' },
  { id: 'lighten', label: 'Lighten', hint: 'Keeps whichever is lighter' },
];

/** How the selected layers mix with what is under them. */
export function BlendControl({ ed }: { ed: Editor }) {
  const cur = ed.selLayers[0]?.blend ?? 'normal';
  const mixed = ed.selLayers.some(l => (l.blend ?? 'normal') !== cur);
  const hint = BLENDS.find(b => b.id === cur)?.hint;
  return (
    <div className="space-y-1">
      <Row label="Blend">
        <Select value={mixed ? '' : cur} onValueChange={v => ed.updateSel(l => ({ ...l, blend: v === 'normal' ? undefined : (v as Blend) }), 'blend')} recentsKey={false}>
          <SelectTrigger className="h-9 text-base md:h-8 md:text-xs"><SelectValue placeholder="Mixed" /></SelectTrigger>
          <SelectContent className={Z}>{BLENDS.map(b => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      {hint && !mixed && <p className="pl-[92px] text-[11px] text-muted-foreground">{hint}.</p>}
    </div>
  );
}

type FxName = keyof LayerFx;

/** Shadow, glow and outline for the selected shapes, photos, marks and QR codes. */
export function FxControls({ ed }: { ed: Editor }) {
  const targets = ed.selLayers.filter(l => l.kind !== 'text');
  const first = targets[0];
  if (!first) return null;
  const fx: LayerFx = first.layerFx ?? {};
  const doc = docColours(ed);
  const apply = (next: LayerFx, key?: string) => ed.updateSel(l => (l.kind === 'text' ? l : ({ ...l, layerFx: Object.keys(next).length ? next : undefined } as Layer)), key ? `fx:${key}` : undefined);
  const toggle = (n: FxName, on: boolean) => {
    const next = { ...fx };
    if (on) (next as Record<string, unknown>)[n] = { ...FX_DEFAULTS[n] }; else delete next[n];
    apply(next);
  };
  const tune = <K extends FxName>(n: K, patch: Partial<NonNullable<LayerFx[K]>>, key: string) => apply({ ...fx, [n]: { ...FX_DEFAULTS[n], ...fx[n], ...patch } }, key);
  const sh = fx.shadow, gl = fx.glow, ol = fx.outline;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm"><Switch checked={!!sh} onCheckedChange={v => toggle('shadow', v)} /> Shadow</label>
        {sh && (
          <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <Row label="Colour"><ColourRow value={sh.color} onChange={c => tune('shadow', { color: c }, 'sc')} extra={doc} /></Row>
            <Row label="Across"><Num value={sh.x} min={-100} max={100} onChange={v => tune('shadow', { x: v }, 'sx')} /></Row>
            <Row label="Down"><Num value={sh.y} min={-100} max={100} onChange={v => tune('shadow', { y: v }, 'sy')} /></Row>
            <Row label="Blur"><Num value={sh.blur} min={0} max={120} onChange={v => tune('shadow', { blur: v }, 'sb')} /></Row>
            <Row label="Strength"><Num value={Math.round(sh.alpha * 100)} min={0} max={100} onChange={v => tune('shadow', { alpha: v / 100 }, 'sa')} /></Row>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm"><Switch checked={!!gl} onCheckedChange={v => toggle('glow', v)} /> Glow</label>
        {gl && (
          <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <Row label="Colour"><ColourRow value={gl.color} onChange={c => tune('glow', { color: c }, 'gc')} extra={doc} /></Row>
            <Row label="Spread"><Num value={gl.blur} min={0} max={160} onChange={v => tune('glow', { blur: v }, 'gb')} /></Row>
            <Row label="Strength"><Num value={Math.round(gl.alpha * 100)} min={0} max={100} onChange={v => tune('glow', { alpha: v / 100 }, 'ga')} /></Row>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm"><Switch checked={!!ol} onCheckedChange={v => toggle('outline', v)} /> Outline</label>
        {ol && (
          <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <Row label="Colour"><ColourRow value={ol.color} onChange={c => tune('outline', { color: c }, 'oc')} extra={doc} /></Row>
            <Row label="Thickness"><Num value={ol.width} min={1} max={60} onChange={v => tune('outline', { width: v }, 'ow')} /></Row>
          </div>
        )}
      </div>
    </div>
  );
}

/** The Effects panel for anything that is not text (text has its own): blend, shadow, glow, outline. */
export function FxPanel({ ed }: { ed: Editor }) {
  const kinds = ed.selLayers.filter(l => l.kind !== 'text');
  if (!ed.selLayers.length) return <p className="text-sm text-muted-foreground">Select something for its blend and effects.</p>;
  return (
    <div className="space-y-4">
      <Section title="Blend"><BlendControl ed={ed} /></Section>
      {kinds.length > 0 && <Section title="Effects"><FxControls ed={ed} />{kinds.some(l => l.kind === 'image' && l.shadow) && <p className="text-[11px] text-muted-foreground">An effect here replaces the photo’s plain Shadow switch.</p>}</Section>}
    </div>
  );
}
