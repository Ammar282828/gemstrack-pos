'use client';

/**
 * Rulers, guides, grid, margin view, safe zones and the equal-spacing chips (designer v2). `StageGuides` is drawn
 * over the page by the stage; `GuidesPanel` is the rail panel that switches them on. The guides and the grid belong to
 * the document (`doc.meta`), so they are saved with it and snap everywhere the document is edited; which of the views
 * is showing belongs to the device.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SpacingGuide } from '@/lib/social/design';
import { addGuide, autoSafeKind, framePos, GRID_SIZES, marginBox, moveGuide, removeGuide, rulerTicks } from '@/lib/social/guides';
import { overlayRects, SAFE_KINDS, type SafeKind } from '@/lib/design/safe';
import { unionBox } from '@/lib/social/design';
import type { Editor } from '../story-editor';
import { NumField, Pills, Row, Section } from './kit';

/** Which views are on, remembered on this device. */
export interface ViewOpts { rulers: boolean; margins: boolean; safe: boolean; safeKind: SafeKind | 'auto' }
export const DEFAULT_VIEW: ViewOpts = { rulers: false, margins: false, safe: false, safeKind: 'auto' };
const VIEW_KEY = 'designer_view';
export const readView = (): ViewOpts => {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') }; } catch { return DEFAULT_VIEW; }
};
export const writeView = (v: ViewOpts) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

const RULER = 16;   // css px
/** The safe-zone view in use: the person's pick, or the one that fits this page. */
export const safeKindOf = (v: ViewOpts, F: { w: number; h: number }): SafeKind => (v.safeKind === 'auto' ? autoSafeKind(F) : v.safeKind);
const GUIDE = '#06b6d4';

type Drag = { axis: 'x' | 'y'; index: number | null; pos: number };

/** Everything drawn over the page that is not the design: tick rulers, the user's guides, grid, margins, safe bands, spacing chips. */
export function StageGuides({ ed, scale, designer, spacing, getRect }: {
  ed: Editor; scale: number; designer: boolean; spacing: SpacingGuide[]; getRect: () => DOMRect | null;
}) {
  const { F, guides, viewOpts: v } = ed;
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);

  const posFrom = (axis: 'x' | 'y', e: PointerEvent | React.PointerEvent): number => {
    const r = getRect();
    if (!r) return -1;
    return axis === 'x' ? framePos(e.clientX, r.left, r.width, F.w) : framePos(e.clientY, r.top, r.height, F.h);
  };
  const begin = (axis: 'x' | 'y', index: number | null) => (e: React.PointerEvent) => {
    if (e.button === 2) return;
    e.preventDefault(); e.stopPropagation();
    const first = { axis, index, pos: posFrom(axis, e) } as Drag;
    live.current = first; setDrag(first);
    const move = (ev: PointerEvent) => { const d = { axis, index, pos: posFrom(axis, ev) } as Drag; live.current = d; setDrag(d); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      const d = live.current; live.current = null; setDrag(null);
      if (!d) return;
      ed.setGuides(d.index === null ? addGuide(guides, d.axis, d.pos, F) : moveGuide(guides, d.axis, d.index, d.pos, F));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  useEffect(() => () => { live.current = null; }, []);

  const sel = ed.selLayers.length ? unionBox(ed.selLayers.map(ed.boxOf)) : null;
  const gridPx = ed.doc.meta?.grid ? ed.doc.meta.grid * scale : 0;
  const mb = v.margins ? marginBox(F, ed.margin) : null;
  const safe = v.safe ? overlayRects(F, safeKindOf(v, F)) : [];
  const gx = guides.x.map((p, i) => ({ axis: 'x' as const, i, p })), gy = guides.y.map((p, i) => ({ axis: 'y' as const, i, p }));
  const shown = [...gx, ...gy].filter(g => !(drag && drag.index === g.i && drag.axis === g.axis));

  return (<>
    {gridPx >= 3 && <div className="pointer-events-none absolute inset-0" style={{
      backgroundImage: 'linear-gradient(to right, rgba(6,182,212,.28) 1px, transparent 1px), linear-gradient(to bottom, rgba(6,182,212,.28) 1px, transparent 1px)',
      backgroundSize: `${gridPx}px ${gridPx}px`,
    }} />}
    {safe.map((r, i) => (
      <div key={i} className="pointer-events-none absolute" style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale, background: 'repeating-linear-gradient(135deg, rgba(220,38,38,.22) 0 6px, rgba(220,38,38,.1) 6px 12px)', boxShadow: 'inset 0 0 0 1px rgba(220,38,38,.5)' }} />
    ))}
    {safe.length > 0 && <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] text-white">Keep words out of the shaded bands</div>}
    {mb && <div className="pointer-events-none absolute border border-dashed border-emerald-500/80" style={{ left: mb.x * scale, top: mb.y * scale, width: mb.w * scale, height: mb.h * scale }} />}

    {/* The user's guides: drag to move, drag off the page (or double-click) to remove. */}
    {shown.map(g => g.axis === 'x' ? (
      <div key={`x${g.i}`} className={cn('absolute top-0 bottom-0 -ml-1.5 w-3', designer ? 'pointer-events-auto cursor-col-resize' : 'pointer-events-none')} style={{ left: g.p * scale }}
        onPointerDown={designer ? begin('x', g.i) : undefined} onDoubleClick={designer ? () => ed.setGuides(removeGuide(guides, 'x', g.i)) : undefined} title="Drag to move; double-click to remove">
        <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2" style={{ background: GUIDE }} />
      </div>
    ) : (
      <div key={`y${g.i}`} className={cn('absolute left-0 right-0 -mt-1.5 h-3', designer ? 'pointer-events-auto cursor-row-resize' : 'pointer-events-none')} style={{ top: g.p * scale }}
        onPointerDown={designer ? begin('y', g.i) : undefined} onDoubleClick={designer ? () => ed.setGuides(removeGuide(guides, 'y', g.i)) : undefined} title="Drag to move; double-click to remove">
        <span className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2" style={{ background: GUIDE }} />
      </div>
    ))}
    {drag && drag.pos > 0 && (drag.axis === 'x' ? drag.pos < F.w : drag.pos < F.h) && (
      <div className="pointer-events-none absolute" style={drag.axis === 'x' ? { left: drag.pos * scale, top: 0, bottom: 0, width: 1, background: GUIDE } : { top: drag.pos * scale, left: 0, right: 0, height: 1, background: GUIDE }}>
        <span className="absolute rounded bg-cyan-600 px-1 text-[10px] tabular-nums text-white" style={drag.axis === 'x' ? { top: 4, left: 4 } : { left: 4, top: -16 }}>{drag.pos}</span>
      </div>
    )}
    {drag && (drag.pos <= 0 || (drag.axis === 'x' ? drag.pos >= F.w : drag.pos >= F.h)) && drag.index !== null && (
      <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded bg-foreground/85 px-2 py-0.5 text-[11px] text-background">Let go to remove this guide</div>
    )}

    {/* Equal spacing: the gaps that match, with their distance. */}
    {spacing.map((s, i) => {
      const len = Math.abs(s.b - s.a) * scale;
      const style: React.CSSProperties = s.axis === 'x'
        ? { left: Math.min(s.a, s.b) * scale, top: s.at * scale, width: len, height: 0 }
        : { top: Math.min(s.a, s.b) * scale, left: s.at * scale, height: len, width: 0 };
      return (
        <div key={i} className="pointer-events-none absolute" style={style}>
          <span className={cn('absolute bg-fuchsia-500', s.axis === 'x' ? 'left-0 right-0 top-0 h-px' : 'top-0 bottom-0 left-0 w-px')} />
          <span className={cn('absolute bg-fuchsia-500', s.axis === 'x' ? 'left-0 -top-1 h-2 w-px' : 'top-0 -left-1 w-2 h-px')} />
          <span className={cn('absolute bg-fuchsia-500', s.axis === 'x' ? 'right-0 -top-1 h-2 w-px' : 'bottom-0 -left-1 w-2 h-px')} />
          <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-fuchsia-500 px-1 text-[10px] tabular-nums leading-4 text-white">{Math.round(s.gap)}</span>
        </div>
      );
    })}

    {designer && v.rulers && (<>
      <Ruler axis="x" ed={ed} scale={scale} sel={sel && { from: sel.x, to: sel.x + sel.w }} onStart={begin('y', null)} />
      <Ruler axis="y" ed={ed} scale={scale} sel={sel && { from: sel.y, to: sel.y + sel.h }} onStart={begin('x', null)} />
    </>)}
  </>);
}

/** A ruler along the top (axis x) or left (axis y) edge, drawn just outside the page. Dragging from it pulls a guide. */
function Ruler({ axis, ed, scale, sel, onStart }: { axis: 'x' | 'y'; ed: Editor; scale: number; sel: { from: number; to: number } | null; onStart: (e: React.PointerEvent) => void }) {
  const horizontal = axis === 'x';
  const len = horizontal ? ed.F.w : ed.F.h;
  const ticks = rulerTicks(len, scale);
  const px = len * scale;
  return (
    <div onPointerDown={onStart} title="Drag onto the page to pull out a guide"
      className={cn('absolute z-10 touch-none select-none overflow-hidden border bg-background/90 text-muted-foreground', horizontal ? 'cursor-row-resize' : 'cursor-col-resize')}
      style={horizontal ? { left: 0, top: -RULER - 2, width: px, height: RULER } : { top: 0, left: -RULER - 2, height: px, width: RULER }}>
      <svg width={horizontal ? px : RULER} height={horizontal ? RULER : px} className="block">
        {sel && <rect fill="#0ea5e9" fillOpacity={0.25} {...(horizontal ? { x: sel.from * scale, y: 0, width: (sel.to - sel.from) * scale, height: RULER } : { x: 0, y: sel.from * scale, width: RULER, height: (sel.to - sel.from) * scale })} />}
        {ticks.map(t => {
          const p = t.at * scale;
          return horizontal ? (
            <g key={t.at}><line x1={p} x2={p} y1={t.major ? 4 : RULER - 5} y2={RULER} stroke="currentColor" strokeWidth={1} opacity={0.6} />
              {t.label && <text x={p + 2} y={9} fontSize={8} fill="currentColor" stroke="none">{t.label}</text>}</g>
          ) : (
            <g key={t.at}><line y1={p} y2={p} x1={t.major ? 4 : RULER - 5} x2={RULER} stroke="currentColor" strokeWidth={1} opacity={0.6} />
              {t.label && <text transform={`translate(9 ${p + 2}) rotate(90)`} fontSize={8} fill="currentColor" stroke="none">{t.label}</text>}</g>
          );
        })}
      </svg>
    </div>
  );
}

// ── The rail panel ─────────────────────────────────────────────────────────

export function GuidesPanel({ ed }: { ed: Editor }) {
  const { viewOpts: v, setViewOpts, guides, F } = ed;
  const grid = ed.doc.meta?.grid ?? 0;
  const set = (patch: Partial<ViewOpts>) => setViewOpts(o => ({ ...o, ...patch }));
  const addAt = (axis: 'x' | 'y') => {
    const len = axis === 'x' ? F.w : F.h;
    const have = guides[axis];
    let at = Math.round(len / 2);
    while (have.includes(at)) at += 24;
    ed.setGuides(addGuide(guides, axis, at, F));
  };
  const list = (axis: 'x' | 'y', title: string) => (
    <Section title={title} right={<Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => addAt(axis)}><Plus className="mr-1 h-3 w-3" /> Add</Button>}>
      {guides[axis].length === 0 ? <p className="text-[11px] text-muted-foreground">None. {v.rulers ? 'Drag from the ruler onto the page' : 'Switch the rulers on and drag from them'}, or add one here.</p> : (
        <div className="grid grid-cols-2 gap-2">
          {guides[axis].map((p, i) => (
            <div key={`${axis}${i}`} className="flex items-end gap-1">
              <div className="min-w-0 flex-1"><NumField label={axis === 'x' ? `Across ${i + 1}` : `Down ${i + 1}`} value={p} min={1} max={(axis === 'x' ? F.w : F.h) - 1} onCommit={n => ed.setGuides(moveGuide(guides, axis, i, n, F))} /></div>
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 md:h-8 md:w-8" title="Remove" onClick={() => ed.setGuides(removeGuide(guides, axis, i))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
  return (
    <div className="space-y-4">
      <Section title="See">
        <label className="flex items-center gap-2 text-sm"><Switch checked={v.rulers} onCheckedChange={x => set({ rulers: x })} /> Rulers</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={v.margins} onCheckedChange={x => set({ margins: x })} /> Margins ({ed.margin} px)</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={v.safe} onCheckedChange={x => set({ safe: x })} /> Safe zones</label>
        {v.safe && (<>
          <Row label="For"><Pills value={v.safeKind} options={[['auto', 'This page'], ...SAFE_KINDS.map(k => [k.id, k.label] as [string, string])]} onChange={k => set({ safeKind: k as SafeKind | 'auto' })} /></Row>
          {overlayRects(F, safeKindOf(v, F)).length === 0 && <p className="text-[11px] text-muted-foreground">Nothing needs keeping clear on a page this shape.</p>}
        </>)}
      </Section>
      <Section title="Grid">
        <label className="flex items-center gap-2 text-sm"><Switch checked={grid > 0} onCheckedChange={x => ed.setGrid(x ? 60 : 0)} /> Grid that things snap to</label>
        {grid > 0 && <Row label="Every"><Pills value={String(grid)} options={GRID_SIZES.map(g => [String(g), String(g)])} onChange={g => ed.setGrid(Number(g))} /></Row>}
      </Section>
      {list('x', 'Vertical guides')}
      {list('y', 'Horizontal guides')}
      {guides.x.length + guides.y.length > 0 && <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => ed.setGuides({ x: [], y: [] })}>Clear all guides</Button>}
      <p className="text-[11px] text-muted-foreground">Things you move snap to the guides, the grid, the page’s middle and margins and each other, and show the gap when spacing is equal. Guides are for you: they are not in the picture you post.</p>
    </div>
  );
}
