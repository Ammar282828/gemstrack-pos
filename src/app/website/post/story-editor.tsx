'use client';

/**
 * The story editor: the canvas, what is selected on it, and the controls for it.
 *
 * Tap a layer to select it; drag to move it (it snaps to the centre and the
 * margins, and says so with a guide); drag the corner handle or pinch to size
 * it; drag the top handle to turn it. Tap empty space to select the photo and
 * drag or pinch that instead. Everything the canvas can do, the inspector
 * below it can do more precisely — and a phone gets both.
 *
 * The document and its undo history live in useStoryDoc(); the page owns them
 * so it can render the same document to the JPEG it publishes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Undo2, Redo2, Plus, LayoutTemplate, Type, ArrowUpRight, Minus, Circle, Square, Link2, Image as ImageIcon, Copy, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Unlink, Save, BookmarkCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORY_H, STORY_W } from '@/lib/social/story';
import { PALETTES, type Palette } from '@/lib/social/palettes';
import {
  FONT_LABEL, PRESETS, applyPalette, applyPreset, hitTest, layerBox, moveLayer, newImageLayer, newLayerId, newLinkPill, newShape, newText, newWordmark,
  renderDoc, scaleLayer, type Assets, type Bind, type Box, type Fields, type FontKey, type Layer, type PresetId, type ShapeLayer, type StoryDoc, type TextLayer,
} from '@/lib/social/editor';

// ── The document and its history ───────────────────────────────────────────

export function useStoryDoc(initial: StoryDoc) {
  const [doc, setDocState] = useState<StoryDoc>(initial);
  const past = useRef<StoryDoc[]>([]);
  const future = useRef<StoryDoc[]>([]);
  const last = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);

  /**
   * Change the document. `key` coalesces a run of the same edit (a slider being
   * dragged) into one undo step; `live` changes (a drag in progress) take no
   * step at all — the drag records one when it ends, through `checkpoint`.
   */
  const change = useCallback((updater: (d: StoryDoc) => StoryDoc, opts: { key?: string; live?: boolean } = {}) => {
    setDocState(prev => {
      const next = updater(prev);
      if (next === prev) return prev;
      if (!opts.live) {
        const now = Date.now();
        const same = opts.key && last.current?.key === opts.key && now - last.current.at < 1200;
        if (!same) { past.current.push(prev); if (past.current.length > 80) past.current.shift(); future.current = []; }
        last.current = opts.key ? { key: opts.key, at: now } : null;
      }
      return next;
    });
    bump(n => n + 1);
  }, []);
  const checkpoint = useCallback((before: StoryDoc) => { past.current.push(before); future.current = []; last.current = null; bump(n => n + 1); }, []);
  const undo = useCallback(() => setDocState(cur => { const p = past.current.pop(); if (!p) return cur; future.current.push(cur); bump(n => n + 1); return p; }), []);
  const redo = useCallback(() => setDocState(cur => { const f = future.current.pop(); if (!f) return cur; past.current.push(cur); bump(n => n + 1); return f; }), []);
  const reset = useCallback((d: StoryDoc) => { past.current = []; future.current = []; setDocState(d); bump(n => n + 1); }, []);
  return { doc, change, checkpoint, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
export type StoryDocApi = ReturnType<typeof useStoryDoc>;

// ── Templates (this device) ────────────────────────────────────────────────

interface Template { name: string; layers: Layer[]; bg: Pick<StoryDoc['bg'], 'dim' | 'gradient' | 'color'> }
const TEMPLATE_KEY = 'taheri_story_templates';
const readTemplates = (): Template[] => { try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]'); } catch { return []; } };
const writeTemplates = (t: Template[]) => { try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t)); } catch { /* private mode */ } };

// ── Colours offered everywhere ─────────────────────────────────────────────

const SWATCHES = ['#FFFFFF', '#111111', '#1F4A2C', '#2E9E57', '#C07A3E', '#C9973F', '#2C3480', '#7A5A35', '#E8D5B5', '#8B1E2D'];

function ColourRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SWATCHES.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={cn('h-7 w-7 rounded-full border-2', value.toLowerCase() === c.toLowerCase() ? 'border-primary' : 'border-border')} style={{ background: c }} />
      ))}
      <label className="h-7 w-7 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer text-[10px] text-muted-foreground" title="Any colour">
        +<input type="color" value={value.length === 7 ? value : '#ffffff'} onChange={e => onChange(e.target.value)} className="sr-only" />
      </label>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0 text-muted-foreground text-xs">{label}</span><span className="flex-1 min-w-0">{children}</span></label>;
}
const Num = ({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) => (
  <div className="flex items-center gap-2"><Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="flex-1" /><span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(value * 100) / 100}</span></div>
);
function Pills({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border p-0.5">
      {options.map(([v, l]) => <button key={v} type="button" onClick={() => onChange(v)} className={cn('rounded-full px-2.5 py-1 text-xs', value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{l}</button>)}
    </div>
  );
}

// ── The editor ─────────────────────────────────────────────────────────────

type Drag =
  | { mode: 'layer'; id: string; sx: number; sy: number; orig: Layer; before: StoryDoc }
  | { mode: 'photo'; sx: number; sy: number; fx: number; fy: number; before: StoryDoc }
  | { mode: 'resize'; id: string; cx: number; cy: number; d0: number; orig: Layer; before: StoryDoc }
  | { mode: 'rotate'; id: string; cx: number; cy: number; orig: Layer; before: StoryDoc }
  | { mode: 'pinch'; id: string | 'bg'; d0: number; orig: Layer | null; zoom0: number; before: StoryDoc };

export interface StoryEditorProps {
  api: StoryDocApi;
  fields: Fields;
  assets: Assets;
  photos: { id: string; url: string; label?: string }[];
  palette: Palette;
  onPalette: (p: Palette) => void;
  /** A finished AI-lettered image to show instead of our own lettering. */
  lettered: HTMLImageElement | null;
  /** Typing into a bound layer edits the piece's field. */
  onField: (bind: Bind, value: string) => void;
  weightOwnLine: boolean;
  overlay?: React.ReactNode;
  websiteLabel: string;
}

export function StoryEditor({ api, fields, assets, photos, palette, onPalette, lettered, onField, weightOwnLine, overlay, websiteLabel }: StoryEditorProps) {
  const { toast } = useToast();
  const { doc, change, checkpoint, undo, redo, canUndo, canRedo } = api;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | 'bg' | null>(null);
  const [scale, setScale] = useState(0.25);
  const [guides, setGuides] = useState<{ v?: number; h?: number }>({});
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [templates, setTemplates] = useState<Template[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTemplates(readTemplates()); }, []);

  // Draw on every change. The canvas is the export's twin, so nothing of the UI goes on it.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    renderDoc(c.getContext('2d')!, doc, fields, assets, lettered ? { background: lettered, hideBound: true } : {});
  }, [doc, fields, assets, lettered]);

  // Story pixels → CSS pixels, kept current as the page resizes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.getBoundingClientRect().width / STORY_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layer = typeof selected === 'string' && selected !== 'bg' ? doc.layers.find(l => l.id === selected) ?? null : null;
  const box: Box | null = layer ? layerBox(layer, fields, assets) : null;

  const toStory = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * STORY_W, y: (e.clientY - r.top) / r.height * STORY_H };
  };

  const update = useCallback((id: string, patch: Partial<Layer> | ((l: Layer) => Layer), key?: string) => {
    change(d => ({ ...d, layers: d.layers.map(l => l.id === id ? (typeof patch === 'function' ? patch(l) : ({ ...l, ...patch } as Layer)) : l) }), { key: key ? `${id}:${key}` : undefined });
  }, [change]);

  /** Snap a moving box to the centre lines and the side margins. */
  const snap = (b: Box, dx: number, dy: number) => {
    const T = 12;
    let sx = dx, sy = dy;
    const g: { v?: number; h?: number } = {};
    const nb = { ...b, x: b.x + dx, y: b.y + dy };
    for (const [edge, target] of [[nb.x + nb.w / 2, 540], [nb.x, 96], [nb.x + nb.w, 984]] as const) {
      if (Math.abs(edge - target) < T) { sx += target - edge; g.v = target; break; }
    }
    if (Math.abs(nb.y + nb.h / 2 - 960) < T) { sy += 960 - (nb.y + nb.h / 2); g.h = 960; }
    return { dx: sx, dy: sy, g };
  };

  // ── Pointer handling ──
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toStory(e);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const target = layer ? layer.id : 'bg';
      drag.current = { mode: 'pinch', id: target, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, orig: layer, zoom0: doc.bg.placement.zoom, before: doc };
      return;
    }
    if (lettered) { setSelected(null); return; }
    const hit = hitTest(doc, p.x, p.y, fields, assets);
    if (hit) {
      setSelected(hit.id);
      drag.current = { mode: 'layer', id: hit.id, sx: p.x, sy: p.y, orig: hit, before: doc };
    } else {
      setSelected('bg');
      drag.current = { mode: 'photo', sx: e.clientX, sy: e.clientY, fx: doc.bg.placement.focusX, fy: doc.bg.placement.focusY, before: doc };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const k = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / d.d0;
      if (d.id === 'bg' || !d.orig) change(doc0 => ({ ...doc0, bg: { ...doc0.bg, placement: { ...doc0.bg.placement, zoom: Math.min(3, Math.max(1, d.zoom0 * k)) } } }), { live: true });
      else { const o = d.orig; change(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === o.id ? scaleLayer(o, k) : l) }), { live: true }); }
      return;
    }
    const p = toStory(e);
    if (d.mode === 'layer') {
      const b = layerBox(d.orig, fields, assets);
      const s = snap(b, p.x - d.sx, p.y - d.sy);
      setGuides(s.g);
      change(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? moveLayer(d.orig, s.dx, s.dy) : l) }), { live: true });
    } else if (d.mode === 'resize') {
      const k = Math.max(0.1, Math.hypot(p.x - d.cx, p.y - d.cy) / d.d0);
      change(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? scaleLayer(d.orig, k) : l) }), { live: true });
    } else if (d.mode === 'rotate') {
      let ang = Math.round((Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI + 90);
      if (Math.abs(ang) < 4) ang = 0;
      change(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? { ...d.orig, rotate: ((ang + 540) % 360) - 180 } as Layer : l) }), { live: true });
    } else if (d.mode === 'photo') {
      const photo = doc.bg.photoId ? assets.photos[doc.bg.photoId] : null;
      if (!photo) return;
      const pl = doc.bg.placement;
      const iw = photo.naturalWidth, ih = photo.naturalHeight;
      const sc = (pl.mode === 'fill' ? Math.max(STORY_W / iw, STORY_H / ih) : Math.min(STORY_W / iw, STORY_H / ih)) * pl.zoom;
      const spareX = Math.abs(iw * sc - STORY_W) || 1, spareY = Math.abs(ih * sc - STORY_H) || 1;
      const k = STORY_W / canvasRef.current!.getBoundingClientRect().width;
      const dirX = iw * sc > STORY_W ? -1 : 1, dirY = ih * sc > STORY_H ? -1 : 1;
      const cl = (v: number) => Math.min(1, Math.max(0, v));
      change(doc0 => ({ ...doc0, bg: { ...doc0.bg, placement: { ...pl, focusX: cl(d.fx + dirX * (e.clientX - d.sx) * k / spareX), focusY: cl(d.fy + dirY * (e.clientY - d.sy) * k / spareY) } } }), { live: true });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d && d.before !== doc) checkpoint(d.before);
    drag.current = pointers.current.size ? drag.current : null;
    setGuides({});
  };

  const startHandle = (mode: 'resize' | 'rotate') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!layer || !box) return;
    wrapRef.current?.setPointerCapture(e.pointerId);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const p = toStory(e);
    drag.current = mode === 'resize'
      ? { mode, id: layer.id, cx, cy, d0: Math.max(10, Math.hypot(p.x - cx, p.y - cy)), orig: layer, before: doc }
      : { mode, id: layer.id, cx, cy, orig: layer, before: doc };
  };

  // Keyboard: nudge, delete, undo, duplicate — when the canvas has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (!layer) return;
    const step = e.shiftKey ? 20 : 4;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (nudge[e.key]) { e.preventDefault(); update(layer.id, l => moveLayer(l, nudge[e.key][0], nudge[e.key][1]), 'nudge'); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(layer.id); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(layer); }
  };

  // ── Layer actions ──
  const add = (l: Layer) => { change(d => ({ ...d, layers: [...d.layers, l] })); setSelected(l.id); };
  const remove = (id: string) => { change(d => ({ ...d, layers: d.layers.filter(l => l.id !== id) })); setSelected(null); };
  const duplicate = (l: Layer) => {
    const copy = { ...moveLayer(l, 30, 30), id: newLayerId(l.kind) } as Layer;
    // A copy of a bound line becomes free text — two layers tied to one field would move as one word.
    add(copy.kind === 'text' && copy.bind ? { ...copy, bind: undefined, text: fields[copy.bind] } : copy);
  };
  const reorder = (id: string, dir: 1 | -1) => change(d => {
    const i = d.layers.findIndex(l => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= d.layers.length) return d;
    const layers = [...d.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return { ...d, layers };
  });
  const preset = (id: PresetId) => { change(d => applyPreset(d, id, palette, fields, assets, { weightOwnLine, wordmark: d.layers.some(l => l.kind === 'wordmark') || d.layers.length === 0 })); setSelected(null); };
  const saveTemplate = () => {
    const name = window.prompt('Name this layout (it stays on this device):', `Layout ${templates.length + 1}`);
    if (!name) return;
    const t: Template = { name, layers: doc.layers.filter(l => l.kind !== 'image'), bg: { dim: doc.bg.dim, gradient: doc.bg.gradient, color: doc.bg.color } };
    const next = [...templates.filter(x => x.name !== name), t];
    setTemplates(next); writeTemplates(next);
    toast({ title: 'Layout saved', description: `“${name}” is under Layouts on this device.` });
  };
  const useTemplate = (t: Template) => { change(d => ({ ...d, bg: { ...d.bg, ...t.bg }, layers: t.layers.map(l => ({ ...l, id: newLayerId(l.kind) })) })); setSelected(null); };
  const dropTemplate = (name: string) => { const next = templates.filter(x => x.name !== name); setTemplates(next); writeTemplates(next); };

  const layerName = (l: Layer) => l.kind === 'text' ? (l.bind ? l.bind[0].toUpperCase() + l.bind.slice(1) : `Text “${l.text.slice(0, 14)}”`) : l.kind === 'wordmark' ? 'Wordmark' : l.kind === 'image' ? 'Photo inset' : l.kind[0].toUpperCase() + l.kind.slice(1);
  const bgPhoto = doc.bg.photoId;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><LayoutTemplate className="h-4 w-4 mr-1.5" /> Layouts</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>The shop’s layouts</DropdownMenuLabel>
            {PRESETS.map(p => <DropdownMenuItem key={p.id} onClick={() => preset(p.id)}>{p.label}</DropdownMenuItem>)}
            {templates.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Saved on this device</DropdownMenuLabel></>}
            {templates.map(t => (
              <DropdownMenuItem key={t.name} onClick={() => useTemplate(t)} className="justify-between gap-4">
                <span className="flex items-center gap-1.5"><BookmarkCheck className="h-3.5 w-3.5" /> {t.name}</span>
                <span role="button" className="text-muted-foreground hover:text-destructive" onClick={e => { e.stopPropagation(); dropTemplate(t.name); }}><Trash2 className="h-3.5 w-3.5" /></span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={saveTemplate}><Save className="h-4 w-4 mr-1.5" /> Save this layout…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => add(newText(palette.body))}><Type className="h-4 w-4 mr-2" /> Text</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add(newShape('arrow', '#FFFFFF'))}><ArrowUpRight className="h-4 w-4 mr-2" /> Arrow</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add(newShape('line', palette.headline))}><Minus className="h-4 w-4 mr-2" /> Line</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add(newShape('circle', '#FFFFFF'))}><Circle className="h-4 w-4 mr-2" /> Circle</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add(newShape('rect', '#FFFFFF'))}><Square className="h-4 w-4 mr-2" /> Box</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add(newLinkPill(websiteLabel))}><Link2 className="h-4 w-4 mr-2" /> Link pill ({websiteLabel})</DropdownMenuItem>
            {!doc.layers.some(l => l.kind === 'wordmark') && <DropdownMenuItem onClick={() => add(newWordmark(palette.dark))}><Type className="h-4 w-4 mr-2" /> Wordmark</DropdownMenuItem>}
            {photos.length > 1 && <DropdownMenuSeparator />}
            {photos.filter(p => p.id !== bgPhoto).map(p => (
              <DropdownMenuItem key={p.id} onClick={() => add(newImageLayer(p.id))}><ImageIcon className="h-4 w-4 mr-2" /> Photo inset {p.label ? `· ${p.label}` : ''}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)"><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)"><Redo2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Canvas with the selection drawn over it in the DOM (never on the canvas itself) */}
      <div ref={wrapRef} className="relative mx-auto w-[270px] sm:w-[300px] select-none"
        onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <canvas
          ref={canvasRef}
          width={STORY_W}
          height={STORY_H}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => textRef.current?.focus()}
          className="w-full rounded-xl shadow-md touch-none bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-crosshair"
          aria-label="Story — tap something to select it, drag to move it"
        />
        {guides.v !== undefined && <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-pink-500" style={{ left: guides.v * scale }} />}
        {guides.h !== undefined && <div className="pointer-events-none absolute left-0 right-0 h-px bg-pink-500" style={{ top: guides.h * scale }} />}
        {layer && box && !lettered && (
          <div className="absolute border-2 border-dashed border-sky-500 pointer-events-none"
            style={{ left: box.x * scale - 2, top: box.y * scale - 2, width: box.w * scale + 4, height: box.h * scale + 4, transform: `rotate(${layer.rotate}deg)` }}>
            <span onPointerDown={startHandle('resize')} className="pointer-events-auto absolute -right-2.5 -bottom-2.5 h-5 w-5 rounded-full bg-sky-500 border-2 border-white cursor-nwse-resize touch-none" title="Drag to resize" />
            <span onPointerDown={startHandle('rotate')} className="pointer-events-auto absolute left-1/2 -top-7 -ml-2.5 h-5 w-5 rounded-full bg-white border-2 border-sky-500 cursor-grab touch-none" title="Drag to turn" />
          </div>
        )}
        {overlay}
      </div>
      <p className="text-[11px] text-center text-muted-foreground">Tap to select · drag to move · corner to resize · top dot to turn · pinch works too</p>

      {/* Inspector */}
      {lettered ? (
        <p className="text-xs text-muted-foreground">AI lettering is on — switch to “Our fonts” to move and style the text yourself.</p>
      ) : layer ? (
        <LayerInspector
          layer={layer} box={box!} fields={fields} photos={photos} textRef={textRef}
          name={layerName(layer)}
          onChange={(patch, key) => update(layer.id, patch, key)}
          onField={onField}
          onDelete={() => remove(layer.id)} onDuplicate={() => duplicate(layer)}
          onForward={() => reorder(layer.id, 1)} onBack={() => reorder(layer.id, -1)}
          onDeselect={() => setSelected(null)}
        />
      ) : (
        <BackgroundInspector api={api} photos={photos} palette={palette} onPalette={onPalette} layers={doc.layers} layerName={layerName} onSelect={setSelected} />
      )}
    </div>
  );
}

// ── Inspectors ─────────────────────────────────────────────────────────────

function LayerInspector({ layer: l, box, fields, photos, textRef, name, onChange, onField, onDelete, onDuplicate, onForward, onBack, onDeselect }: {
  layer: Layer; box: Box; fields: Fields; photos: StoryEditorProps['photos']; textRef: React.RefObject<HTMLTextAreaElement>; name: string;
  onChange: (patch: Partial<Layer> | ((l: Layer) => Layer), key?: string) => void; onField: (b: Bind, v: string) => void;
  onDelete: () => void; onDuplicate: () => void; onForward: () => void; onBack: () => void; onDeselect: () => void;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2.5">
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium flex-1 truncate">{name}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Bring forward" onClick={onForward}><ArrowUp className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Send back" onClick={onBack}><ArrowDown className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title={l.hidden ? 'Show' : 'Hide'} onClick={() => onChange({ hidden: !l.hidden })}>{l.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicate (⌘D)" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDeselect}>Done</Button>
      </div>

      {l.kind === 'text' && (<>
        <Textarea ref={textRef} rows={2} value={l.bind ? fields[l.bind] : l.text}
          onChange={e => l.bind ? onField(l.bind, e.target.value) : onChange({ text: e.target.value }, 'text')} className="text-sm" />
        {l.bind && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-2">
            {l.bind === 'weight' || l.bind === 'details' ? 'Made from the piece’s fields.' : `Same as the ${l.bind} field.`}
            <button type="button" className="text-primary inline-flex items-center gap-1" onClick={() => onChange(x => ({ ...(x as TextLayer), bind: undefined, text: fields[(x as TextLayer).bind!] }))}><Unlink className="h-3 w-3" /> Type your own</button>
          </p>
        )}
        <Row label="Font">
          <Select value={l.font} onValueChange={v => onChange({ font: v as FontKey })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(FONT_LABEL) as FontKey[]).map(f => <SelectItem key={f} value={f}>{FONT_LABEL[f]}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
        <Row label="Size"><Num value={l.size} min={16} max={400} onChange={v => onChange({ size: v }, 'size')} /></Row>
        <Row label="Colour"><ColourRow value={l.color} onChange={c => onChange({ color: c }, 'color')} /></Row>
        <Row label="Align"><Pills value={l.align} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={v => onChange(x => {
          // Keep the text where it is on screen: move the anchor to the matching edge of its box.
          const pad = (x as TextLayer).box?.pad ?? 0;
          const ax = v === 'left' ? box.x + pad : v === 'center' ? box.x + box.w / 2 : box.x + box.w - pad;
          return { ...(x as TextLayer), align: v as TextLayer['align'], x: ax };
        })} /></Row>
        <Row label="Line width"><Num value={l.width} min={120} max={1080} step={10} onChange={v => onChange({ width: v }, 'width')} /></Row>
        <Row label="Spacing"><Num value={l.spacing} min={-0.05} max={0.5} step={0.01} onChange={v => onChange({ spacing: v }, 'spacing')} /></Row>
        <Row label="Line height"><Num value={l.lineHeight} min={0.7} max={2} step={0.05} onChange={v => onChange({ lineHeight: v }, 'lh')} /></Row>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-1.5"><Switch checked={l.fit} onCheckedChange={v => onChange({ fit: v })} /> Shrink to fit</label>
          <label className="flex items-center gap-1.5"><Switch checked={l.upper} onCheckedChange={v => onChange({ upper: v })} /> CAPITALS</label>
          <label className="flex items-center gap-1.5"><Switch checked={l.shadow} onCheckedChange={v => onChange({ shadow: v })} /> Shadow</label>
          <label className="flex items-center gap-1.5"><Switch checked={!!l.box} onCheckedChange={v => onChange({ box: v ? { color: '#FFFFFF', radius: 24, pad: 20 } : null })} /> Background</label>
        </div>
        {l.box && <Row label="Background"><ColourRow value={l.box.color} onChange={c => onChange(x => ({ ...(x as TextLayer), box: { ...(x as TextLayer).box!, color: c } }), 'boxc')} /></Row>}
      </>)}

      {l.kind === 'wordmark' && (<>
        <Row label="Size"><Num value={l.width} min={80} max={1000} step={5} onChange={v => onChange({ width: v }, 'w')} /></Row>
        <Row label="Colour"><Pills value={l.tone} options={[['dark', 'Dark'], ['light', 'Light']]} onChange={v => onChange({ tone: v as 'dark' | 'light' })} /></Row>
      </>)}

      {l.kind === 'image' && (<>
        <Row label="Photo">
          <div className="flex gap-1.5 overflow-x-auto">{photos.map(p => (
            <button key={p.id} type="button" onClick={() => onChange({ photoId: p.id })} className={cn('h-10 w-10 shrink-0 rounded overflow-hidden border-2', l.photoId === p.id ? 'border-primary' : 'border-transparent')}><img src={p.url} alt="" className="h-full w-full object-cover" /></button>
          ))}</div>
        </Row>
        <Row label="Size"><Num value={l.w} min={80} max={1080} step={5} onChange={v => onChange({ w: v }, 'w')} /></Row>
        <Row label="Corners"><Num value={l.radius} min={0} max={200} onChange={v => onChange({ radius: v }, 'r')} /></Row>
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-1.5"><Switch checked={!!l.border} onCheckedChange={v => onChange({ border: v ? '#FFFFFF' : null })} /> White border</label>
          <label className="flex items-center gap-1.5"><Switch checked={l.shadow} onCheckedChange={v => onChange({ shadow: v })} /> Shadow</label>
        </div>
      </>)}

      {(l.kind === 'arrow' || l.kind === 'line' || l.kind === 'rect' || l.kind === 'circle') && (<>
        <Row label="Colour"><ColourRow value={l.color} onChange={c => onChange({ color: c }, 'color')} /></Row>
        <Row label="Thickness"><Num value={l.stroke} min={0} max={40} onChange={v => onChange({ stroke: v }, 'stroke')} /></Row>
        {(l.kind === 'arrow' || l.kind === 'line') && (<>
          <Row label="Bend"><Num value={l.curve} min={-300} max={300} step={5} onChange={v => onChange({ curve: v }, 'curve')} /></Row>
          <Row label="Direction"><div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange(x => { const s = x as ShapeLayer; return { ...s, x: s.x + s.w, y: s.y + s.h, w: -s.w, h: -s.h }; })}>Reverse</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange(x => { const s = x as ShapeLayer; return { ...s, x: s.x + s.w, w: -s.w, curve: -s.curve }; })}>Flip</Button>
          </div></Row>
        </>)}
        {(l.kind === 'rect' || l.kind === 'circle') && (<>
          <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!l.fill} onCheckedChange={v => onChange({ fill: v ? '#FFFFFF' : null })} /> Filled</label>
          {l.fill && <Row label="Fill"><ColourRow value={l.fill} onChange={c => onChange({ fill: c }, 'fill')} /></Row>}
          {l.kind === 'rect' && <Row label="Corners"><Num value={l.radius} min={0} max={300} onChange={v => onChange({ radius: v }, 'r')} /></Row>}
          <Row label="Width"><Num value={Math.abs(l.w)} min={10} max={1080} step={5} onChange={v => onChange({ w: v }, 'w')} /></Row>
          <Row label="Height"><Num value={Math.abs(l.h)} min={10} max={1920} step={5} onChange={v => onChange({ h: v }, 'h')} /></Row>
        </>)}
      </>)}

      <Row label="Turn"><Num value={l.rotate} min={-180} max={180} onChange={v => onChange({ rotate: v }, 'rot')} /></Row>
      <Row label="Opacity"><Num value={l.opacity} min={0.1} max={1} step={0.05} onChange={v => onChange({ opacity: v }, 'op')} /></Row>
    </div>
  );
}

function BackgroundInspector({ api, photos, palette, onPalette, layers, layerName, onSelect }: {
  api: StoryDocApi; photos: StoryEditorProps['photos']; palette: Palette; onPalette: (p: Palette) => void;
  layers: Layer[]; layerName: (l: Layer) => string; onSelect: (id: string) => void;
}) {
  const { doc, change } = api;
  const bg = doc.bg;
  const setBg = (patch: Partial<StoryDoc['bg']>, key?: string) => change(d => ({ ...d, bg: { ...d.bg, ...patch } }), { key: key ? `bg:${key}` : undefined });
  const pl = bg.placement;
  return (
    <div className="rounded-lg border p-3 space-y-2.5">
      <p className="text-sm font-medium">Photo &amp; colours</p>
      <Row label="Photo">
        <div className="flex gap-1.5 overflow-x-auto">{photos.map(p => (
          <button key={p.id} type="button" onClick={() => setBg({ photoId: p.id, placement: { ...pl, focusX: 0.5, focusY: 0.5, zoom: 1 } })} className={cn('h-10 w-10 shrink-0 rounded overflow-hidden border-2', bg.photoId === p.id ? 'border-primary' : 'border-transparent')}><img src={p.url} alt="" className="h-full w-full object-cover" /></button>
        ))}</div>
      </Row>
      <Row label="Show"><Pills value={pl.mode} options={[['fill', 'Fill the frame'], ['fit', 'Whole photo']]} onChange={v => setBg({ placement: { ...pl, mode: v as 'fill' | 'fit', focusX: 0.5, focusY: 0.5 } })} /></Row>
      <Row label="Zoom"><Num value={pl.zoom} min={1} max={3} step={0.05} onChange={v => setBg({ placement: { ...pl, zoom: v } }, 'zoom')} /></Row>
      <Row label="Darken"><Num value={bg.dim} min={0} max={0.7} step={0.05} onChange={v => setBg({ dim: v }, 'dim')} /></Row>
      <Row label="Shade"><Pills value={bg.gradient} options={[['none', 'None'], ['top', 'Top'], ['bottom', 'Bottom'], ['both', 'Both']]} onChange={v => setBg({ gradient: v as StoryDoc['bg']['gradient'] })} /></Row>
      <Row label="Behind"><ColourRow value={bg.color} onChange={c => setBg({ color: c }, 'color')} /></Row>
      <Row label="Lettering">
        <div className="flex flex-wrap gap-1.5">
          {PALETTES.map(p => (
            <button key={p.id} type="button" onClick={() => { onPalette(p); change(d => applyPalette(d, p)); }} title={p.label}
              className={cn('h-8 w-8 rounded-full border-2 flex items-center justify-center', palette.id === p.id ? 'border-primary' : 'border-transparent')} style={{ background: p.dark ? '#2a2a2a' : '#EDE6DA' }}>
              <span className="h-4 w-4 rounded-full" style={{ background: p.headline }} />
            </button>
          ))}
        </div>
      </Row>
      {layers.length > 0 && (
        <div className="pt-1 border-t">
          <p className="text-xs text-muted-foreground mb-1.5">On the story — tap to edit</p>
          <div className="flex flex-wrap gap-1.5">{[...layers].reverse().map(l => (
            <button key={l.id} type="button" onClick={() => onSelect(l.id)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', l.hidden && 'opacity-50 line-through')}>{layerName(l)}</button>
          ))}</div>
        </div>
      )}
    </div>
  );
}
