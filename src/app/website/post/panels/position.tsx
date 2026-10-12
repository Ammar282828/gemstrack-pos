'use client';

/**
 * Position (designer v2): order, alignment and exact numbers. One thing: X, Y, width, height and turn for every kind
 * (text, marks, photos, QR codes, shapes, lines), with a lock that keeps its shape. Several things: the same four
 * numbers for the whole selection as one block, and "match" buttons that give the others the size or the place of the
 * first one picked.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Link2, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { moveLayer, scaleLayer, type Box, type Layer, type ShapeLayer } from '@/lib/social/editor';
import { unionBox } from '@/lib/social/design';
import { fitToUnion, matchTo, sizeWith, type MatchHow } from '@/lib/social/guides';
import type { Editor } from '../story-editor';
import { AlignButtons, NumField, Section } from './kit';

/** Whether a shape's width and height move together by default (a circle, a badge, a photo) or not (a box, a line). */
const lockByDefault = (l: Layer) => l.kind === 'image' || l.kind === 'wordmark' || l.kind === 'qr' || l.kind === 'circle' || l.kind === 'shape';

/** What the W and H fields show for a layer: the figures the person set, not the box round them. */
function dims(l: Layer, b: Box): { w: number; h: number } {
  switch (l.kind) {
    case 'text': return { w: l.width, h: b.h };
    case 'wordmark': return { w: l.width, h: b.h };
    case 'image': return { w: l.w, h: l.h ?? b.h };
    case 'qr': return { w: l.w, h: l.w };
    default: return { w: Math.abs(l.w), h: Math.abs(l.h) };
  }
}

/** The layer with this width and/or height (the other kept, or followed when the shape is locked). */
export function withDims(l: Layer, b: Box, edit: { w?: number; h?: number }, lock: boolean): Layer {
  const cur = dims(l, b);
  const round = Math.round;
  switch (l.kind) {
    case 'text':
      if (edit.w !== undefined) return { ...l, width: Math.min(2400, Math.max(80, round(edit.w))), flow: l.flow };
      return edit.h !== undefined && b.h > 0 ? scaleLayer(l, edit.h / b.h) : l;
    case 'wordmark': {
      const w = edit.w ?? (edit.h !== undefined && b.h > 0 ? l.width * (edit.h / b.h) : l.width);
      return { ...l, width: Math.min(1080, Math.max(20, round(w))) };
    }
    case 'qr': {
      const w = edit.w ?? edit.h ?? l.w;
      return { ...l, w: Math.min(2400, Math.max(20, round(w))) };
    }
    case 'image': {
      if (!l.h) {
        const w = edit.w ?? (edit.h !== undefined && b.h > 0 ? l.w * (edit.h / b.h) : l.w);
        return { ...l, w: Math.min(2400, Math.max(20, round(w))) };
      }
      const n = sizeWith(cur, edit, lock);
      return { ...l, w: Math.min(2400, n.w), h: Math.min(3000, n.h) };
    }
    default: {
      const s = l as ShapeLayer;
      const n = sizeWith(cur, edit, lock);
      return { ...s, w: (s.w < 0 ? -1 : 1) * n.w, h: (s.h < 0 ? -1 : 1) * n.h };
    }
  }
}

/** `l` made to fill `to` (it was `from`): scaled by the box's two factors, then moved so its corner lands on `to`'s. */
function fitLayerTo(l: Layer, from: Box, to: Box, boxOf: (l: Layer) => Box): Layer {
  const kx = from.w > 0 ? to.w / from.w : 1, ky = from.h > 0 ? to.h / from.h : 1;
  let s: Layer;
  if (l.kind === 'image' && l.h) s = { ...l, w: Math.max(20, Math.round(l.w * kx)), h: Math.max(20, Math.round(l.h * ky)) };
  else if (l.kind === 'text' || l.kind === 'wordmark' || l.kind === 'qr' || l.kind === 'image') s = scaleLayer(l, Math.abs(kx - 1) >= Math.abs(ky - 1) ? kx : ky);
  else s = { ...l, w: Math.round(l.w * kx), h: Math.round(l.h * ky) } as Layer;
  const nb = boxOf(s);
  return moveLayer(s, to.x - nb.x, to.y - nb.y);
}

export function PositionPanel({ ed }: { ed: Editor }) {
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const l = ed.one;
  const b = l ? ed.boxOf(l) : null;
  const lock = l ? locks[l.id] ?? lockByDefault(l) : true;
  const frozen = !!l?.locked;

  if (!ed.selLayers.length) return <p className="text-sm text-muted-foreground">Select something to arrange it.</p>;

  const arrange = (
    <Section title="Arrange">
      <div className="grid grid-cols-2 gap-1">
        <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('forward')}><ArrowUp className="h-4 w-4 mr-1.5" /> Forward</Button>
        <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('backward')}><ArrowDown className="h-4 w-4 mr-1.5" /> Backward</Button>
        <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('front')}><ChevronsUp className="h-4 w-4 mr-1.5" /> To front</Button>
        <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('back')}><ChevronsDown className="h-4 w-4 mr-1.5" /> To back</Button>
      </div>
    </Section>
  );
  const align = <Section title="Align"><AlignButtons ed={ed} /></Section>;
  const unit = <p className="text-[11px] text-muted-foreground">In the {ed.square ? 'square’s 1080 × 1080' : ed.F.h === 1920 ? 'story’s 1080 × 1920' : `${ed.F.w} × ${ed.F.h}`} pixels.</p>;

  // One thing.
  if (l && b) {
    const d = dims(l, b);
    const textual = l.kind === 'text';
    const setSize = (edit: { w?: number; h?: number }) => ed.update(l.id, () => withDims(l, b, edit, lock), 'dims');
    return (
      <div className="space-y-4">
        {arrange}{align}
        <Section title="Exactly">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={b.x} disabled={frozen} onCommit={v => ed.update(l.id, () => moveLayer(l, v - b.x, 0))} />
            <NumField label="Y" value={b.y} disabled={frozen} onCommit={v => ed.update(l.id, () => moveLayer(l, 0, v - b.y))} />
            <NumField label={textual ? 'Line width' : 'Width'} value={d.w} min={4} disabled={frozen} onCommit={v => setSize({ w: v })} />
            <NumField label="Height" value={d.h} min={4} disabled={frozen} title={textual ? 'Changing the height sizes the letters' : undefined} onCommit={v => setSize({ h: v })} />
            <NumField label="Turn" suffix="°" value={l.rotate} min={-180} max={180} disabled={frozen} onCommit={v => ed.update(l.id, { rotate: v })} />
            {l.kind === 'text' ? <NumField label="Size" value={l.size} min={8} max={800} disabled={frozen} onCommit={v => ed.update(l.id, { size: v } as Partial<Layer>)} />
              : <button type="button" onClick={() => setLocks(m => ({ ...m, [l.id]: !lock }))} title={lock ? 'Width and height move together' : 'Width and height are free'}
                className={cn('mt-5 flex h-9 items-center justify-center gap-1.5 rounded-md border text-xs md:h-8', lock ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
                {lock ? <Link2 className="h-4 w-4" /> : <Unlink className="h-4 w-4" />} {lock ? 'Shape locked' : 'Free shape'}
              </button>}
          </div>
          {unit}
        </Section>
      </div>
    );
  }

  // Several things: one block.
  const live = ed.selLayers.filter(x => !x.locked);
  const boxes = live.map(ed.boxOf);
  const u = unionBox(ed.selLayers.map(ed.boxOf));
  const lockU = locks.__union ?? true;
  const toUnion = (to: Partial<Box>) => {
    if (!live.length) return;
    let t = to;
    if (lockU && (to.w !== undefined || to.h !== undefined)) {
      const r = u.h > 0 ? u.w / u.h : 1;
      t = to.w !== undefined ? { ...to, h: Math.max(1, to.w / r) } : { ...to, w: Math.max(1, (to.h as number) * r) };
    }
    const next = fitToUnion(boxes, u, t);
    const out = new Map(live.map((x, i) => [x.id, fitLayerTo(x, boxes[i], next[i], ed.boxOf)]));
    ed.change(doc => ({ ...doc, layers: doc.layers.map(x => out.get(x.id) ?? x) }), { key: `union:${ed.sel.join()}` });
  };
  const match = (how: MatchHow) => {
    const ref = ed.view.layers.find(x => x.id === ed.sel[0]);
    if (!ref) return;
    const rb = ed.boxOf(ref);
    const others = live.filter(x => x.id !== ref.id);
    const steps = matchTo(rb, others.map(ed.boxOf), how);
    const out = new Map(others.map((x, i) => {
      const bx = ed.boxOf(x), s = steps[i];
      return [x.id, fitLayerTo(x, bx, { x: bx.x + s.dx, y: bx.y + s.dy, w: bx.w * s.kx, h: bx.h * s.ky }, ed.boxOf)];
    }));
    ed.change(doc => ({ ...doc, layers: doc.layers.map(x => out.get(x.id) ?? x) }));
  };
  const M = ({ how, children }: { how: MatchHow; children: React.ReactNode }) => (
    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => match(how)} disabled={live.length < 2}>{children}</Button>
  );
  return (
    <div className="space-y-4">
      {arrange}{align}
      <Section title="The whole selection">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="X" value={u.x} onCommit={v => toUnion({ x: v })} />
          <NumField label="Y" value={u.y} onCommit={v => toUnion({ y: v })} />
          <NumField label="Width" value={u.w} min={4} onCommit={v => toUnion({ w: v })} />
          <NumField label="Height" value={u.h} min={4} onCommit={v => toUnion({ h: v })} />
        </div>
        <button type="button" onClick={() => setLocks(m => ({ ...m, __union: !lockU }))}
          className={cn('flex h-9 w-full items-center justify-center gap-1.5 rounded-md border text-xs md:h-8', lockU ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
          {lockU ? <Link2 className="h-4 w-4" /> : <Unlink className="h-4 w-4" />} {lockU ? 'Shape locked' : 'Free shape'}
        </button>
        {unit}
      </Section>
      <Section title="Match the first one picked">
        <div className="grid grid-cols-3 gap-1">
          <M how="width">Width</M><M how="height">Height</M><M how="both">Size</M>
          <M how="x">Left edge</M><M how="y">Top edge</M><M how="position">Place</M>
        </div>
        <p className="text-[11px] text-muted-foreground">The others take the size or the place of the layer you picked first.</p>
      </Section>
    </div>
  );
}
