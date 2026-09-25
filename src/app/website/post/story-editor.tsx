'use client';

/**
 * The story and square editor — a small one beside the form, and a full-screen
 * designer in the manner of Canva. The page makes the story and the post
 * (square) of a piece together, so PairEditor holds both: live thumbnails of
 * each, one open for editing, one designer that flips between them, and
 * "Copy to the post / story" for anything selected.
 *
 * Tap a layer to select it (shift-tap or drag a box round several); drag to
 * move it — it snaps to the page's centre and margins and to the edges and
 * centres of everything else, and says so with a guide; drag a corner (or
 * pinch) to size it, a side to stretch it, the dot beneath to turn it, an
 * arrow's ends to point it. Double-tap words to type on the canvas. Tap empty
 * space to select the photo and drag or pinch that instead. Right-click (or
 * ⋯) for copy, paste, order, lock and group; the keyboard does the same.
 *
 * The designer adds a rail of panels (templates, elements, text, photos and
 * uploads, brand, layers, background), a toolbar for whatever is selected,
 * zoom, and PNG/JPG download. It edits the same document as the small editor.
 *
 * The document and its undo history live in useStoryDoc(); the page owns them
 * so it can render the same document to the JPEG it publishes.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Undo2, Redo2, Plus, LayoutTemplate, Type, ArrowUpRight, Minus, Circle, Square, Link2, Image as ImageIcon, Trash2, Save, BookmarkCheck,
  Maximize2, Lock, Copy, MoreHorizontal, ArrowLeft, Download, ZoomIn, ZoomOut, Shapes, PaintBucket, Layers, Palette as PaletteIcon, Upload, Clipboard, Scissors,
  ChevronsUp, ChevronsDown, ArrowUp, ArrowDown, Group, Ungroup, Unlock, Paintbrush, Pencil, ArrowRightLeft, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Palette } from '@/lib/social/palettes';
import type { Frame } from '@/lib/social/story';
import {
  carryLayers, fontCss, frameOf, hitTest, layerBox, layoutText, loadUpload, moveLayer, newCornerMark, newImageLayer, newLayerId, newLinkPill, newMonogram, newShape, newText,
  newUploadLayer, newWordmark, placementOf, reflow, renderDoc, renderDocTo, scaleLayer, uploadedImage, withPlacement,
  type Assets, type Bind, type Box, type Fields, type Layer, type ShapeLayer, type StoryDoc, type TextLayer,
} from '@/lib/social/editor';
import { alignDeltas, distributeDeltas, intersects, snapBox, snapLines, unionBox, type AlignHow } from '@/lib/social/design';
import {
  BackgroundInspector, BrandPanel, ColourPanel, ContextToolbar, EffectsPanel, ElementsPanel, FontPanel, FramePanel, LayerInspector, LayersPanel, MobileToolbar,
  PhotoEditPanel, PhotosPanel, PositionPanel, SelectionSummary, TemplatesPanel, TextPanel, TransparencyPanel,
} from './editor-panels';

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

export interface Template { name: string; layers: Layer[]; bg: Pick<StoryDoc['bg'], 'dim' | 'gradient' | 'color' | 'color2' | 'adjust'> }
// A square layout and a story layout are different shapes; each keeps its own list.
const templateKey = (square: boolean) => square ? 'taheri_square_templates' : 'taheri_story_templates';
const readTemplates = (square: boolean): Template[] => { try { return JSON.parse(localStorage.getItem(templateKey(square)) || '[]'); } catch { return []; } };
const writeTemplates = (square: boolean, t: Template[]) => { try { localStorage.setItem(templateKey(square), JSON.stringify(t)); } catch { /* private mode, or full */ } };

// ── Clipboard, shared by the story and the square ──────────────────────────
// Copy on the story, paste on the square: both editors on the page read these.

let clipboard: Layer[] = [];
let styleClipboard: { kind: Layer['kind']; style: Partial<Layer> } | null = null;
const TEXT_STYLE_KEYS = ['font', 'size', 'color', 'spacing', 'lineHeight', 'upper', 'shadow', 'box', 'effect', 'underline', 'autoColor', 'curve', 'opacity'] as const;
const SHAPE_STYLE_KEYS = ['color', 'stroke', 'fill', 'fill2', 'dash', 'radius', 'opacity'] as const;
const IMAGE_STYLE_KEYS = ['radius', 'border', 'shadow', 'adjust', 'mask', 'opacity'] as const;
const styleKeys = (k: Layer['kind']): readonly string[] => k === 'text' ? TEXT_STYLE_KEYS : k === 'image' ? IMAGE_STYLE_KEYS : k === 'wordmark' ? ['color', 'autoColor', 'opacity'] : SHAPE_STYLE_KEYS;

/** Images uploaded this visit, to add again from the Photos panel. */
export const sessionUploads: string[] = [];

/** An uploaded file as a data URL: at most 1600 px, PNG where it may have transparency, SVG kept as drawn. */
async function fileToDataUrl(file: File): Promise<string> {
  const read = () => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  if (file.type === 'image/svg+xml') return read();
  const raw = await read();
  const img = await loadUpload(raw).catch(() => { throw new Error('That file can’t be read here — use a PNG or JPG.'); });
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && file.size < 1.5 * 1024 * 1024) return raw;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return /png|webp|gif/.test(file.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
}

// ── Props ──────────────────────────────────────────────────────────────────

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
  /** The layouts this frame offers, and laying one down. */
  presets: { id: string; label: string }[];
  onPreset: (id: string) => void;
  /** What a layout would make of the current document, for the designer's thumbnails. */
  previewPreset?: (id: string) => StoryDoc;
  /** The square (WhatsApp + website) rather than the story: its own marks, no palette, a crop per photo. */
  square?: boolean;
  /** Extra controls shown with the photo settings (the square's AI extend). */
  photoTools?: React.ReactNode;
  /** The name downloads start with. */
  fileName?: string;
  /** The other design on the page (the story's square, the square's story): the selection can be copied onto it. */
  sendTo?: { name: string; send: (layers: Layer[], from: Frame) => void };
}

// ── The editor's state and actions ─────────────────────────────────────────

export type SidePanel = 'templates' | 'elements' | 'text' | 'photos' | 'brand' | 'layers' | 'background' | 'edit' | 'effects' | 'position' | 'photo' | 'font' | 'colour' | 'transparency' | 'frame';

export function useEditor(p: StoryEditorProps) {
  const { toast } = useToast();
  const { api, fields, assets, square, onField } = p;
  const { doc, change } = api;
  const view = useMemo(() => reflow(doc, fields, assets), [doc, fields, assets]);
  const F = frameOf(doc);
  const [sel, setSel] = useState<string[]>([]);
  const [bgSel, setBgSel] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [panel, setPanel] = useState<SidePanel | null>('templates');
  // Bumped when a font or an uploaded image finishes loading, so the canvas redraws.
  const [ver, setVer] = useState(0);
  const tick = useCallback(() => setVer(n => n + 1), []);

  useEffect(() => { setTemplates(readTemplates(!!square)); }, [square]);

  // Keep the selection to layers that still exist (after an undo, a layout…).
  useEffect(() => {
    setSel(s => { const k = s.filter(id => doc.layers.some(l => l.id === id)); return k.length === s.length ? s : k; });
    setEditing(e => (e && doc.layers.some(l => l.id === e) ? e : null));
  }, [doc.layers]);

  // Fonts and uploaded images a layer uses, loaded on first use.
  useEffect(() => {
    let alive = true;
    for (const l of doc.layers) {
      if (l.kind === 'image' && l.src && !uploadedImage(l.src)) loadUpload(l.src).then(() => alive && tick()).catch(() => undefined);
      if (l.kind === 'text') {
        const css = fontCss(l.font, 40, assets.fonts);
        if (!document.fonts.check(css)) document.fonts.load(css).then(() => alive && tick()).catch(() => undefined);
      }
    }
    return () => { alive = false; };
  }, [doc.layers, assets.fonts, tick]);

  const selLayers = view.layers.filter(l => sel.includes(l.id));
  const one = selLayers.length === 1 ? selLayers[0] : null;
  const boxOf = useCallback((l: Layer) => layerBox(l, fields, assets), [fields, assets]);
  /** Ids plus everything grouped with them. */
  const withGroups = (ids: string[]) => {
    const groups = new Set(view.layers.filter(l => ids.includes(l.id) && l.group).map(l => l.group));
    return view.layers.filter(l => ids.includes(l.id) || (l.group && groups.has(l.group))).map(l => l.id);
  };
  const select = (ids: string[]) => { setSel(ids); setBgSel(false); setEditing(null); };
  const selectBg = () => { setSel([]); setBgSel(true); setEditing(null); };
  const clear = () => { setSel([]); setBgSel(false); setEditing(null); };

  const update = useCallback((id: string, patch: Partial<Layer> | ((l: Layer) => Layer), key?: string) => {
    change(d => ({ ...d, layers: d.layers.map(l => l.id === id ? (typeof patch === 'function' ? patch(l) : ({ ...l, ...patch } as Layer)) : l) }), { key: key ? `${id}:${key}` : undefined });
  }, [change]);
  const updateSel = (fn: (l: Layer) => Layer, key?: string) =>
    change(d => ({ ...d, layers: d.layers.map(l => sel.includes(l.id) ? fn(l) : l) }), { key: key ? `sel:${sel.join()}:${key}` : undefined });
  /** Move layers by their on-screen (reflowed) positions; locked ones stay. */
  const moveBy = (deltas: Map<string, { dx: number; dy: number }>, key?: string) => change(d => ({
    ...d,
    layers: d.layers.map(l => {
      const m = deltas.get(l.id);
      const seen = view.layers.find(x => x.id === l.id);
      return m && seen && !l.locked && (m.dx || m.dy) ? moveLayer(seen, m.dx, m.dy) : l;
    }),
  }), { key });

  const add = (ls: Layer | Layer[]) => {
    const arr = Array.isArray(ls) ? ls : [ls];
    if (!arr.length) return;
    change(d => ({ ...d, layers: [...d.layers, ...arr] }));
    select(arr.map(l => l.id));
  };
  const remove = (ids: string[] = sel) => {
    const gone = new Set(view.layers.filter(l => ids.includes(l.id) && !l.locked).map(l => l.id));
    if (!gone.size) { if (ids.length) toast({ title: 'Locked', description: 'Unlock it first to delete it.' }); return; }
    change(d => ({ ...d, layers: d.layers.filter(l => !gone.has(l.id)) }));
    clear();
  };
  /** Copies with new ids (and new group ids), `offset` along; a bound line this document already has becomes free text. */
  const clone = (src: Layer[], offset: number): Layer[] => {
    const groups = new Map<string, string>();
    return src.map(l => {
      let c = { ...moveLayer(l, offset, offset), id: newLayerId(l.kind), locked: false } as Layer;
      if (c.group) { if (!groups.has(c.group)) groups.set(c.group, newLayerId('grp')); c = { ...c, group: groups.get(c.group) }; }
      if (c.kind === 'text' && c.bind) {
        const b = c.bind;
        if (doc.layers.some(x => x.kind === 'text' && x.bind === b)) c = { ...c, bind: undefined, text: fields[b] };
      }
      return c;
    });
  };
  const duplicate = (ids: string[] = sel) => add(clone(view.layers.filter(l => ids.includes(l.id)), 30));
  const copy = (ids: string[] = sel) => {
    const ls = view.layers.filter(l => ids.includes(l.id));
    if (ls.length) { clipboard = ls.map(l => ({ ...l })); toast({ title: `Copied ${ls.length === 1 ? 'it' : `${ls.length} things`}`, description: `Paste here or on the ${square ? 'story' : 'post'} (⌘V).` }); }
  };
  /** The selection copied onto the other design, at the same place on its page. */
  const sendToOther = (ids: string[] = sel) => {
    const ls = view.layers.filter(l => ids.includes(l.id));
    if (!ls.length || !p.sendTo) return;
    p.sendTo.send(ls, F);
    toast({ title: `Copied to the ${p.sendTo.name}`, description: 'Same place on its page — move it there if it needs it.' });
  };
  const cut = () => { copy(); remove(); };
  const paste = () => {
    if (!clipboard.length) return;
    const here = clipboard.some(c => doc.layers.some(l => l.id === c.id) || view.layers.some(l => l.x === c.x && l.y === c.y));
    const pasted = clone(clipboard, here ? 30 : 0);
    clipboard = pasted.map(l => ({ ...l }));
    add(pasted);
  };
  const copyStyle = () => {
    if (!one) return;
    const style = Object.fromEntries(styleKeys(one.kind).filter(k => k in one).map(k => [k, (one as unknown as Record<string, unknown>)[k]])) as Partial<Layer>;
    styleClipboard = { kind: one.kind, style };
    toast({ title: 'Style copied', description: 'Select something and paste the style onto it.' });
  };
  const pasteStyle = () => {
    const s = styleClipboard;
    if (!s || !sel.length) return;
    const shapeKinds = ['arrow', 'line', 'rect', 'circle', 'shape'];
    updateSel(l => {
      const same = l.kind === s.kind || (shapeKinds.includes(l.kind) && shapeKinds.includes(s.kind));
      const keys = same ? styleKeys(l.kind) : ['color', 'opacity'];
      const patch = Object.fromEntries(Object.entries(s.style).filter(([k]) => keys.includes(k) && (same || k in l)));
      return { ...l, ...patch } as Layer;
    });
  };
  const reorder = (how: 'forward' | 'backward' | 'front' | 'back', ids: string[] = sel) => change(d => {
    const moving = d.layers.filter(l => ids.includes(l.id));
    if (!moving.length) return d;
    const rest = d.layers.filter(l => !ids.includes(l.id));
    if (how === 'front') return { ...d, layers: [...rest, ...moving] };
    if (how === 'back') return { ...d, layers: [...moving, ...rest] };
    // One step, past the nearest layer that isn't moving.
    const layers = [...d.layers];
    if (how === 'forward') { for (let i = layers.length - 2; i >= 0; i--) if (ids.includes(layers[i].id) && !ids.includes(layers[i + 1].id)) [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; }
    else { for (let i = 1; i < layers.length; i++) if (ids.includes(layers[i].id) && !ids.includes(layers[i - 1].id)) [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; }
    return { ...d, layers };
  });
  /** One element (or one group) lines up with the page; several with each other. */
  const align = (how: AlignHow) => {
    const ls = selLayers.filter(l => !l.locked);
    if (!ls.length) return;
    const boxes = ls.map(boxOf);
    const page = { x: 0, y: 0, w: F.w, h: F.h };
    const oneGroup = ls.length > 1 && !!ls[0].group && ls.every(l => l.group === ls[0].group);
    const deltas = ls.length === 1 ? alignDeltas(boxes, how, page)
      : oneGroup ? boxes.map(() => alignDeltas([unionBox(boxes)], how, page)[0])
        : alignDeltas(boxes, how);
    moveBy(new Map(ls.map((l, i) => [l.id, deltas[i]])));
  };
  const distribute = (axis: 'h' | 'v') => {
    const ls = selLayers.filter(l => !l.locked);
    const d = distributeDeltas(ls.map(boxOf), axis);
    moveBy(new Map(ls.map((l, i) => [l.id, d[i]])));
  };
  const nudge = (dx: number, dy: number) => moveBy(new Map(sel.map(id => [id, { dx, dy }])), 'nudge');
  const group = () => { if (sel.length < 2) return; const g = newLayerId('grp'); updateSel(l => ({ ...l, group: g })); };
  const ungroup = () => updateSel(l => ({ ...l, group: undefined }));
  const toggleLock = () => { const lock = !selLayers.every(l => l.locked); updateSel(l => ({ ...l, locked: lock })); };
  const grouped = selLayers.length > 1 && !!selLayers[0].group && selLayers.every(l => l.group === selLayers[0].group);

  // ── Templates ──
  const saveTemplate = () => {
    const name = window.prompt('Name this layout (it stays on this device):', `Layout ${templates.length + 1}`);
    if (!name) return;
    const t: Template = { name, layers: doc.layers.filter(l => l.kind !== 'image' || !!l.src), bg: { dim: doc.bg.dim, gradient: doc.bg.gradient, color: doc.bg.color, color2: doc.bg.color2, adjust: doc.bg.adjust } };
    const next = [...templates.filter(x => x.name !== name), t];
    setTemplates(next); writeTemplates(!!square, next);
    toast({ title: 'Layout saved', description: `“${name}” is under Templates on this device.` });
  };
  const templateDoc = (t: Template): StoryDoc => ({ ...doc, bg: { ...doc.bg, ...t.bg }, layers: t.layers.map(l => ({ ...l, id: newLayerId(l.kind) })) });
  const useTemplate = (t: Template) => { change(() => templateDoc(t)); clear(); };
  const dropTemplate = (name: string) => { const next = templates.filter(x => x.name !== name); setTemplates(next); writeTemplates(!!square, next); };
  const preset = (id: string) => { p.onPreset(id); clear(); };

  // ── Uploads and downloads ──
  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const src = await fileToDataUrl(file);
        const img = await loadUpload(src);
        if (!sessionUploads.includes(src)) sessionUploads.unshift(src);
        add(newUploadLayer(src, img, F));
      } catch (e) {
        toast({ title: 'Could not add that image', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      }
    }
  };
  const download = (type: 'png' | 'jpg') => {
    const c = renderDocTo(view, fields, assets, square ? 2160 : 1080, p.lettered ? { background: p.lettered, hideBound: true } : {});
    c.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${p.fileName || 'taheri'}-${square ? 'square' : 'story'}.${type}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, type === 'png' ? 'image/png' : 'image/jpeg', 0.95);
  };

  // ── Keyboard ──
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Keys typed into a field are the field's. On a focused button, slider or
   * menu, Enter, Space and Escape are its own; everything else (Delete, the
   * arrows, ⌘C…) still reaches the selection, as it does after a toolbar click in Canva.
   */
  const ownKeys = (t: EventTarget | null, key: string) => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return true;
    const control = el.tagName === 'BUTTON' || (el.hasAttribute?.('role') && el.tagName !== 'CANVAS');
    return control && (key === 'Enter' || key === ' ' || key === 'Escape');
  };
  const onKey = (e: React.KeyboardEvent | KeyboardEvent) => {
    if (e.defaultPrevented || ownKeys(e.target, e.key)) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const stop = () => e.preventDefault();
    if (mod && k === 'z') { stop(); if (e.shiftKey) api.redo(); else api.undo(); return; }
    if (mod && k === 'y') { stop(); api.redo(); return; }
    if (mod && k === 'a') { stop(); select(view.layers.filter(l => !l.hidden).map(l => l.id)); return; }
    // ⌘V waits a moment for the browser's paste event, which carries a copied image if there is one.
    if (mod && k === 'v') { if (pasteTimer.current) clearTimeout(pasteTimer.current); pasteTimer.current = setTimeout(paste, 80); return; }
    if (k === 'escape') { clear(); return; }
    if (!sel.length) return;
    if (mod && k === 'c') { stop(); copy(); }
    else if (mod && k === 'x') { stop(); cut(); }
    else if (mod && k === 'd') { stop(); duplicate(); }
    else if (mod && k === 'g') { stop(); if (e.shiftKey) ungroup(); else group(); }
    else if (mod && e.key === ']') { stop(); reorder(e.altKey ? 'front' : 'forward'); }
    else if (mod && e.key === '[') { stop(); reorder(e.altKey ? 'back' : 'backward'); }
    else if (e.altKey && e.shiftKey && k === 'l') { stop(); toggleLock(); }
    else if (k === 'delete' || k === 'backspace') { stop(); remove(); }
    else if (k === 'enter' && one?.kind === 'text' && !one.locked) { stop(); setEditing(one.id); }
    else {
      const step = e.shiftKey ? 20 : 2;
      const arrows: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
      if (arrows[k]) { stop(); nudge(...arrows[k]); }
    }
  };
  const onPasteEvent = (e: ClipboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return; // pasting words into a field
    if (pasteTimer.current) { clearTimeout(pasteTimer.current); pasteTimer.current = null; }
    const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); uploadFiles(files); } else paste();
  };

  const layerName = (l: Layer) => l.name || (l.kind === 'text' ? (l.bind ? l.bind[0].toUpperCase() + l.bind.slice(1) : `“${(l.text || 'Text').slice(0, 18)}”`) : l.kind === 'wordmark' ? (l.mark === 't' ? 't mark' : 'Wordmark') : l.kind === 'image' ? (l.src ? 'Upload' : l.mask ? 'Photo frame' : 'Photo inset') : l.kind === 'shape' ? (l.shape ? l.shape[0].toUpperCase() + l.shape.slice(1) : 'Shape') : l.kind[0].toUpperCase() + l.kind.slice(1));

  return {
    p, api, doc, view, F, fields, assets, square: !!square, onField, ver,
    sel, bgSel, one, selLayers, editing, setEditing, panel, setPanel, grouped,
    select, selectBg, clear, withGroups, boxOf, update, updateSel, add, remove, duplicate, copy, cut, paste, copyStyle, pasteStyle, hasStyle: () => !!styleClipboard, hasClip: () => clipboard.length > 0, sendToOther,
    reorder, align, distribute, nudge, group, ungroup, toggleLock, change,
    templates, saveTemplate, useTemplate, templateDoc, dropTemplate, preset,
    uploadFiles, download, onKey, onPasteEvent, layerName,
  };
}
export type Editor = ReturnType<typeof useEditor>;

// ── The canvas and everything drawn over it ────────────────────────────────

type Drag = { changed?: boolean } & (
  | { mode: 'move'; ids: string[]; sx: number; sy: number; orig: Layer[]; box0: Box; before: StoryDoc; lines: ReturnType<typeof snapLines> }
  | { mode: 'photo'; sx: number; sy: number; fx: number; fy: number; before: StoryDoc }
  | { mode: 'resize'; id: string; cx: number; cy: number; d0: number; orig: Layer; before: StoryDoc }
  | { mode: 'side'; id: string; side: 'l' | 'r' | 't' | 'b'; sx: number; sy: number; orig: Layer; box0: Box; before: StoryDoc }
  | { mode: 'end'; id: string; end: 0 | 1; orig: ShapeLayer; before: StoryDoc }
  | { mode: 'rotate'; id: string; cx: number; cy: number; orig: Layer; before: StoryDoc }
  | { mode: 'pinch'; id: string | 'bg'; d0: number; a0: number; orig: Layer | null; zoom0: number; before: StoryDoc }
  | { mode: 'marquee'; sx: number; sy: number; add: boolean; base: string[] }
);

// Handles: small for a mouse, finger-sized on a touch screen (the hit area grows, not just the dot).
const HANDLE = `pointer-events-auto absolute h-4 w-4 rounded-full bg-white border-2 border-sky-500 shadow touch-none before:absolute before:-inset-2 before:content-[''] [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5 [@media(pointer:coarse)]:before:-inset-3`;
const CORNERS = [
  `-left-2 -top-2 cursor-nwse-resize [@media(pointer:coarse)]:-left-2.5 [@media(pointer:coarse)]:-top-2.5`,
  `-right-2 -top-2 cursor-nesw-resize [@media(pointer:coarse)]:-right-2.5 [@media(pointer:coarse)]:-top-2.5`,
  `-left-2 -bottom-2 cursor-nesw-resize [@media(pointer:coarse)]:-left-2.5 [@media(pointer:coarse)]:-bottom-2.5`,
  `-right-2 -bottom-2 cursor-nwse-resize [@media(pointer:coarse)]:-right-2.5 [@media(pointer:coarse)]:-bottom-2.5`,
];
/** Turning snaps to the eighths of a circle within 4°. */
const snapAngle = (a: number) => { const n = Math.round(a / 45) * 45; const v = Math.abs(a - n) < 4 ? n : Math.round(a); const w = ((v + 540) % 360) - 180; return w === -180 ? 180 : w; };

function Stage({ ed, width, designer, className }: { ed: Editor; width?: number; designer: boolean; className?: string }) {
  const { view, F, fields, assets, api, p } = ed;
  const { doc, change, checkpoint } = api;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hud, setHud] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // What the pointer did since it went down: for tap-to-type, long-press and the frame-rate cap.
  const down = useRef<{ x: number; y: number; t: number; hit: Layer | null; wasOnly: boolean; moved: boolean; touch: boolean } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number>(0);
  const latest = useRef<{ clientX: number; clientY: number } | null>(null);
  const placement = placementOf(doc);
  const lettered = p.lettered;

  // Draw on every change. The canvas is the export's twin, so nothing of the UI goes on it;
  // words being typed on the canvas are left off (the text box shows them).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const shown = ed.editing ? { ...view, layers: view.layers.map(l => l.id === ed.editing ? { ...l, hidden: true } : l) } : view;
    renderDoc(c.getContext('2d')!, shown, fields, assets, lettered ? { background: lettered, hideBound: true } : {});
  }, [view, fields, assets, lettered, ed.editing, ed.ver]);

  // Story pixels → CSS pixels, kept current as the page resizes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.getBoundingClientRect().width / F.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [F.w]);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); if (press.current) clearTimeout(press.current); }, []);

  const toStory = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * F.w, y: (e.clientY - r.top) / r.height * F.h };
  };
  const one = ed.one;
  const box = one ? ed.boxOf(one) : null;
  const margin = ed.square ? 45 : 96;
  const live = (fn: (d: StoryDoc) => StoryDoc) => { if (drag.current) drag.current.changed = true; change(fn, { live: true }); };
  const openMenuAt = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    setMenu({ x: clientX - r.left, y: clientY - r.top });
  };

  // ── Pointer handling ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return; // the context menu handles right-clicks
    setMenu(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press.current) { clearTimeout(press.current); press.current = null; }
    const pt = toStory(e);
    if (pointers.current.size === 2) {
      // Two fingers: pinch to size and twist to turn the selected layer, or zoom the photo.
      const [a, b] = [...pointers.current.values()];
      const target = one && !one.locked ? one.id : 'bg';
      if (drag.current?.changed && 'before' in drag.current) checkpoint(drag.current.before);
      drag.current = { mode: 'pinch', id: target, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), orig: target === 'bg' ? null : one, zoom0: placement.zoom, before: doc };
      down.current = null;
      return;
    }
    if (lettered) { ed.clear(); return; }
    if (ed.editing) ed.setEditing(null);
    const hit = hitTest(view, pt.x, pt.y, fields, assets);
    const touch = e.pointerType !== 'mouse';
    down.current = { x: e.clientX, y: e.clientY, t: Date.now(), hit, wasOnly: !!hit && one?.id === hit.id, moved: false, touch };
    if (touch) {
      // A long press opens the menu a right-click would.
      press.current = setTimeout(() => {
        press.current = null;
        if (!down.current || down.current.moved) return;
        if (drag.current && 'before' in drag.current && drag.current.changed) checkpoint(drag.current.before);
        drag.current = null;
        if (hit && !ed.sel.includes(hit.id)) ed.select(ed.withGroups([hit.id]));
        navigator.vibrate?.(10);
        openMenuAt(e.clientX, e.clientY);
      }, 520);
    }
    if (hit) {
      const ids = ed.withGroups([hit.id]);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const all = ids.every(id => ed.sel.includes(id));
        ed.select(all ? ed.sel.filter(id => !ids.includes(id)) : [...new Set([...ed.sel, ...ids])]);
        return;
      }
      const next = ed.sel.includes(hit.id) ? ed.sel : ids;
      ed.select(next);
      const movers = view.layers.filter(l => next.includes(l.id) && !l.locked);
      if (!movers.length) return;
      const others = view.layers.filter(l => !next.includes(l.id) && !l.hidden).map(ed.boxOf);
      drag.current = { mode: 'move', ids: movers.map(l => l.id), sx: pt.x, sy: pt.y, orig: movers, box0: unionBox(movers.map(ed.boxOf)), before: doc, lines: snapLines(F, margin, others) };
    } else if (!touch && !ed.bgSel) {
      drag.current = { mode: 'marquee', sx: pt.x, sy: pt.y, add: e.shiftKey, base: ed.sel };
    } else {
      ed.selectBg();
      drag.current = { mode: 'photo', sx: e.clientX, sy: e.clientY, fx: placement.focusX, fy: placement.focusY, before: doc };
    }
  };

  /** Apply the latest pointer position — at most once a frame, however fast the events come. */
  const apply = () => {
    frame.current = 0;
    const d = drag.current, e = latest.current;
    if (!d || !e) return;
    if (d.mode === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const k = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / d.d0;
      if (d.id === 'bg' || !d.orig) live(doc0 => withPlacement(doc0, { ...placementOf(doc0), zoom: Math.min(3, Math.max(1, d.zoom0 * k)) }));
      else {
        const o = d.orig;
        const turn = ((Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) - d.a0) * 180) / Math.PI;
        const rotate = snapAngle(o.rotate + turn);
        setHud(`${rotate}°`);
        live(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === o.id ? { ...scaleLayer(o, k), rotate } as Layer : l) }));
      }
      return;
    }
    const pt = toStory(e);
    if (d.mode === 'move') {
      const dx = pt.x - d.sx, dy = pt.y - d.sy;
      const s = snapBox({ ...d.box0, x: d.box0.x + dx, y: d.box0.y + dy }, d.lines, 7 / scale);
      setGuides(g => {
        if ((s.v !== null && g.v === null) || (s.h !== null && g.h === null)) navigator.vibrate?.(5);
        return g.v === s.v && g.h === s.h ? g : { v: s.v, h: s.h };
      });
      const moved = new Map(d.orig.map(o => [o.id, moveLayer(o, dx + s.dx, dy + s.dy)]));
      live(doc0 => ({ ...doc0, layers: doc0.layers.map(l => moved.get(l.id) ?? l) }));
    } else if (d.mode === 'resize') {
      const k = Math.max(0.1, Math.hypot(pt.x - d.cx, pt.y - d.cy) / d.d0);
      const next = scaleLayer(d.orig, k);
      const b = ed.boxOf(next);
      setHud(`${Math.round(b.w)} × ${Math.round(b.h)}`);
      live(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? next : l) }));
    } else if (d.mode === 'side') {
      // The pointer's travel along the layer's own (turned) axes.
      const r = (d.orig.rotate * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      const mx = pt.x - d.sx, my = pt.y - d.sy;
      const along = mx * cos + my * sin, across = -mx * sin + my * cos;
      const o = d.orig;
      let next: Layer = o;
      if (o.kind === 'text') {
        const pad = o.box?.pad ?? 0;
        const grow = d.side === 'r' ? along : -along;
        const width = Math.max(60, Math.round(d.box0.w - pad * 2 + grow));
        // The opposite edge stays put: move the anchor by however much of the change is on its side.
        const shift = o.align === 'center' ? along / 2 : (o.align === 'left') === (d.side === 'l') ? along : 0;
        next = { ...o, width, x: o.x + shift * cos, y: o.y + shift * sin, flow: undefined };
        setHud(`width ${width}`);
      } else if (o.kind === 'image' || o.kind === 'rect' || o.kind === 'circle' || o.kind === 'shape') {
        const w0 = o.kind === 'image' ? o.w : Math.abs(o.w), h0 = o.kind === 'image' ? (o.h ?? d.box0.h) : Math.abs(o.h);
        let w = w0, h = h0, x = o.x, y = o.y;
        if (d.side === 'r') w = Math.max(20, w0 + along);
        if (d.side === 'l') { w = Math.max(20, w0 - along); x += (w0 - w) * cos; y += (w0 - w) * sin; }
        if (d.side === 'b') h = Math.max(20, h0 + across);
        if (d.side === 't') { h = Math.max(20, h0 - across); x -= (h0 - h) * sin; y += (h0 - h) * cos; }
        next = { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } as Layer;
        setHud(`${Math.round(w)} × ${Math.round(h)}`);
      }
      live(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? next : l) }));
    } else if (d.mode === 'end') {
      const o = d.orig;
      const next = d.end === 1 ? { ...o, w: Math.round(pt.x - o.x), h: Math.round(pt.y - o.y) } : { ...o, x: Math.round(pt.x), y: Math.round(pt.y), w: Math.round(o.x + o.w - pt.x), h: Math.round(o.y + o.h - pt.y) };
      live(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? next : l) }));
    } else if (d.mode === 'rotate') {
      // The handle hangs beneath the layer, so straight down is 0°.
      const ang = snapAngle((Math.atan2(pt.y - d.cy, pt.x - d.cx) * 180) / Math.PI - 90);
      setHud(`${ang}°`);
      live(doc0 => ({ ...doc0, layers: doc0.layers.map(l => l.id === d.id ? { ...d.orig, rotate: ang } as Layer : l) }));
    } else if (d.mode === 'photo') {
      const photo = doc.bg.photoId ? assets.photos[doc.bg.photoId] : null;
      if (!photo) return;
      const pl = placementOf(doc);
      const iw = photo.naturalWidth, ih = photo.naturalHeight;
      const sc = (pl.mode === 'fill' ? Math.max(F.w / iw, F.h / ih) : Math.min(F.w / iw, F.h / ih)) * pl.zoom;
      const spareX = Math.abs(iw * sc - F.w) || 1, spareY = Math.abs(ih * sc - F.h) || 1;
      const k = F.w / canvasRef.current!.getBoundingClientRect().width;
      const dirX = iw * sc > F.w ? -1 : 1, dirY = ih * sc > F.h ? -1 : 1;
      const cl = (v: number) => Math.min(1, Math.max(0, v));
      live(doc0 => withPlacement(doc0, { ...pl, focusX: cl(d.fx + dirX * (e.clientX - d.sx) * k / spareX), focusY: cl(d.fy + dirY * (e.clientY - d.sy) * k / spareY) }));
    } else if (d.mode === 'marquee') {
      setMarquee({ x: Math.min(d.sx, pt.x), y: Math.min(d.sy, pt.y), w: Math.abs(pt.x - d.sx), h: Math.abs(pt.y - d.sy) });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dn = down.current;
    if (dn && !dn.moved && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > (dn.touch ? 8 : 4)) {
      dn.moved = true;
      if (press.current) { clearTimeout(press.current); press.current = null; }
    }
    const d = drag.current;
    if (!d) return;
    // Nothing moves until the pointer really has: a tap is a tap, not a 1-px nudge.
    if (dn && !dn.moved && d.mode !== 'pinch') return;
    if (!dragging && d.mode !== 'marquee') setDragging(true);
    latest.current = { clientX: e.clientX, clientY: e.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (press.current) { clearTimeout(press.current); press.current = null; }
    if (frame.current) { cancelAnimationFrame(frame.current); apply(); }
    const d = drag.current, dn = down.current;
    if (d?.mode === 'marquee') {
      const m = marquee;
      if (!m || (m.w * scale < 6 && m.h * scale < 6)) ed.selectBg();
      else {
        const hit = view.layers.filter(l => !l.hidden && intersects(ed.boxOf(l), m)).map(l => l.id);
        const ids = ed.withGroups(hit);
        ed.select(d.add ? [...new Set([...d.base, ...ids])] : ids);
      }
      setMarquee(null);
    } else if (d && 'before' in d && d.changed) checkpoint(d.before);
    // Tapping words that were already selected puts you in them to type (Canva's second tap).
    if (dn && !dn.moved && dn.wasOnly && dn.hit?.kind === 'text' && !dn.hit.locked && Date.now() - dn.t < 500 && d?.mode !== 'pinch') ed.setEditing(dn.hit.id);
    if (!pointers.current.size) { drag.current = null; down.current = null; }
    setGuides({ v: null, h: null });
    setDragging(false);
    setHud(null);
  };

  const startHandle = (mode: 'resize' | 'rotate' | 'l' | 'r' | 't' | 'b' | 'end0' | 'end1') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!one || !box || one.locked) return;
    wrapRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down.current = null;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const pt = toStory(e);
    if (mode === 'resize') drag.current = { mode, id: one.id, cx, cy, d0: Math.max(10, Math.hypot(pt.x - cx, pt.y - cy)), orig: one, before: doc };
    else if (mode === 'rotate') drag.current = { mode, id: one.id, cx, cy, orig: one, before: doc };
    else if (mode === 'end0' || mode === 'end1') drag.current = { mode: 'end', id: one.id, end: mode === 'end1' ? 1 : 0, orig: one as ShapeLayer, before: doc };
    else drag.current = { mode: 'side', id: one.id, side: mode, sx: pt.x, sy: pt.y, orig: one, box0: box, before: doc };
    setDragging(true);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (lettered || down.current?.touch) return; // a long press opens it on a phone
    const pt = toStory(e);
    const hit = hitTest(view, pt.x, pt.y, fields, assets);
    if (hit && !ed.sel.includes(hit.id)) ed.select(ed.withGroups([hit.id]));
    if (!hit) ed.selectBg();
    openMenuAt(e.clientX, e.clientY);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    ed.uploadFiles(e.dataTransfer.files);
  };

  // What the side handles do for this kind of layer.
  const sides: ('l' | 'r' | 't' | 'b')[] = !one || one.locked ? []
    : one.kind === 'text' ? (one.curve ? [] : ['l', 'r'])
      : one.kind === 'rect' || one.kind === 'circle' || one.kind === 'shape' || (one.kind === 'image' && one.h) ? ['l', 'r', 't', 'b'] : [];
  const isLine = one && (one.kind === 'arrow' || one.kind === 'line') && !one.rotate;
  const union = ed.selLayers.length ? unionBox(ed.selLayers.map(ed.boxOf)) : null;
  const editingLayer = ed.editing ? view.layers.find(l => l.id === ed.editing && l.kind === 'text') as TextLayer | undefined : undefined;
  // Too small for four corners and the sides as well: one corner does. A finger needs more room than a mouse.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => { setCoarse(window.matchMedia('(pointer: coarse)').matches); }, []);
  const small = !!box && (box.w * scale < (coarse ? 90 : 44) || box.h * scale < (coarse ? 60 : 44));

  return (
    <div ref={wrapRef} className={cn('relative select-none touch-none [-webkit-touch-callout:none]', className)} style={width ? { width } : undefined}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
      <canvas
        ref={canvasRef}
        width={F.w}
        height={F.h}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onDoubleClick={e => {
          // Straight into the words under the pointer, even inside a group.
          const pt = toStory(e);
          const hit = lettered ? null : hitTest(view, pt.x, pt.y, fields, assets);
          if (hit?.kind === 'text' && !hit.locked) { ed.select([hit.id]); ed.setEditing(hit.id); }
        }}
        className={cn('block w-full touch-none bg-muted outline-none cursor-default', designer ? 'rounded-sm shadow-xl' : 'rounded-xl shadow-md focus-visible:ring-2 focus-visible:ring-primary')}
        aria-label={ed.square ? 'Square photo — tap something to select it, drag to move it' : 'Story — tap something to select it, drag to move it'}
      />
      {/* Guides: the line a moving layer snapped to. */}
      {guides.v !== null && <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-fuchsia-500" style={{ left: guides.v * scale }} />}
      {guides.h !== null && <div className="pointer-events-none absolute left-0 right-0 h-px bg-fuchsia-500" style={{ top: guides.h * scale }} />}
      {marquee && <div className="pointer-events-none absolute border border-sky-500 bg-sky-500/10" style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }} />}

      {/* Every selected layer's outline; the handles on a single one. */}
      {!lettered && ed.selLayers.map(l => {
        const b = ed.boxOf(l);
        const single = one?.id === l.id;
        return (
          <div key={l.id} className={cn('absolute pointer-events-none', single ? 'border-2 border-sky-500' : 'border border-dashed border-sky-500')}
            style={{ left: b.x * scale - 2, top: b.y * scale - 2, width: b.w * scale + 4, height: b.h * scale + 4, transform: `rotate(${l.rotate}deg)` }}>
            {single && !l.locked && !ed.editing && (<>
              {!isLine && (small ? [CORNERS[3]] : CORNERS).map(c => (
                <span key={c} onPointerDown={startHandle('resize')} className={cn(HANDLE, c)} title="Drag to resize" />
              ))}
              {!small && sides.map(s => (
                <span key={s} onPointerDown={startHandle(s)} title="Drag to stretch"
                  className={cn('pointer-events-auto absolute rounded-full bg-white border-2 border-sky-500 shadow touch-none before:absolute before:-inset-2.5 before:content-[\'\']',
                    s === 'l' || s === 'r' ? `top-1/2 -mt-3 h-6 w-2.5 cursor-ew-resize [@media(pointer:coarse)]:-mt-3.5 [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-3` : `left-1/2 -ml-3 w-6 h-2.5 cursor-ns-resize [@media(pointer:coarse)]:-ml-3.5 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:h-3`,
                    s === 'l' ? '-left-1.5' : s === 'r' ? '-right-1.5' : s === 't' ? '-top-1.5' : '-bottom-1.5')} />
              ))}
              <span onPointerDown={startHandle('rotate')} className={cn(HANDLE, `left-1/2 -bottom-10 -ml-2 cursor-grab !bg-sky-500 !border-white [@media(pointer:coarse)]:-ml-2.5 [@media(pointer:coarse)]:-bottom-11`)} title="Drag to turn" />
            </>)}
            {l.locked && single && <span className="absolute -top-3 -right-3 rounded-full bg-background border p-0.5"><Lock className="h-3 w-3" /></span>}
          </div>
        );
      })}
      {/* An arrow's or line's two ends. */}
      {isLine && one && !one.locked && !ed.editing && (() => {
        const s = one as ShapeLayer;
        return ([[s.x, s.y, 'end0'], [s.x + s.w, s.y + s.h, 'end1']] as const).map(([x, y, m]) => (
          <span key={m} onPointerDown={startHandle(m)} className={cn(HANDLE, 'cursor-move')} style={{ left: x * scale - 8, top: y * scale - 8 }} title="Drag to point it" />
        ));
      })()}
      {/* Several selected: the box round all of them. */}
      {union && ed.selLayers.length > 1 && <div className="pointer-events-none absolute border-2 border-sky-500/60" style={{ left: union.x * scale - 4, top: union.y * scale - 4, width: union.w * scale + 8, height: union.h * scale + 8 }} />}
      {/* The angle or size while turning or sizing. */}
      {hud && union && <div className="pointer-events-none absolute z-10 rounded-md bg-foreground/85 px-2 py-0.5 text-[11px] tabular-nums text-background" style={{ left: (union.x + union.w / 2) * scale, top: Math.max(4, union.y * scale - 30), transform: 'translateX(-50%)' }}>{hud}</div>}

      {/* Canva's little bar above what is selected. */}
      {designer && union && !dragging && !ed.editing && !menu && (
        <div className="absolute z-10 flex items-center gap-0.5 rounded-full border bg-background px-1 py-0.5 shadow-md"
          style={{ left: Math.min(Math.max((union.x + union.w / 2) * scale, 90), F.w * scale - 90), top: union.y * scale - (coarse ? 68 : 50) < 0 ? (union.y + union.h) * scale + (coarse ? 56 : 48) : union.y * scale - (coarse ? 68 : 50), transform: 'translateX(-50%)' }}>
          {ed.one?.kind === 'text' && !ed.one.locked && <MiniButton title="Type (Enter)" onClick={() => ed.setEditing(ed.one!.id)}><Pencil className="h-4 w-4" /></MiniButton>}
          <MiniButton title={ed.selLayers.every(l => l.locked) ? 'Unlock' : 'Lock'} onClick={ed.toggleLock}>{ed.selLayers.every(l => l.locked) ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</MiniButton>
          <MiniButton title="Duplicate (⌘D)" onClick={() => ed.duplicate()}><Copy className="h-4 w-4" /></MiniButton>
          <MiniButton title="Delete" onClick={() => ed.remove()}><Trash2 className="h-4 w-4" /></MiniButton>
          <MiniButton title="More" onClick={e => openMenuAt(e.clientX, e.clientY + 12)}><MoreHorizontal className="h-4 w-4" /></MiniButton>
        </div>
      )}

      {editingLayer && <InlineText ed={ed} l={editingLayer} scale={scale} />}
      {menu && <ContextMenu ed={ed} at={menu} width={F.w * scale} onClose={() => setMenu(null)} />}
      {p.overlay}
    </div>
  );
}

const MiniButton = ({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) => (
  <button type="button" title={title} aria-label={title} onPointerDown={e => e.stopPropagation()} onClick={onClick}
    className="h-8 w-8 rounded-full flex items-center justify-center text-foreground/80 hover:bg-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">{children}</button>
);

/**
 * Typing on the canvas: a text box over the words, in their font, size and
 * colour. Never below 16 px as far as the browser knows — an iPhone zooms the
 * whole page into any smaller field — and scaled down to the true size instead.
 */
function InlineText({ ed, l, scale }: { ed: Editor; l: TextLayer; scale: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const ctx = useMemo(() => document.createElement('canvas').getContext('2d')!, []);
  const t = layoutText(ctx, l, ed.fields, ed.assets.fonts);
  const b = ed.boxOf(l);
  const value = l.bind ? ed.fields[l.bind] : l.text;
  const w = Math.max(b.w, l.fit ? b.w : Math.min(l.width, ed.F.w)) + 24;
  const left = l.align === 'left' ? l.x : l.align === 'center' ? l.x - w / 2 : l.x - w;
  const px = t.size * scale;
  const k = px < 16 ? px / 16 : 1;
  // Focused in the same tap that asked for it, or an iPhone won't raise the keyboard.
  useLayoutEffect(() => { const el = ref.current; if (el) { el.focus({ preventScroll: true }); el.select(); } }, []);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } });
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => l.bind ? ed.onField(l.bind, e.target.value) : ed.update(l.id, { text: e.target.value }, 'text')}
      onBlur={() => ed.setEditing(null)}
      onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ed.setEditing(null); } e.stopPropagation(); }}
      onPointerDown={e => e.stopPropagation()}
      rows={1}
      spellCheck={false}
      autoCapitalize="sentences"
      enterKeyHint="done"
      className="absolute z-20 resize-none overflow-hidden bg-black/10 outline-2 outline-dashed outline-sky-500 p-0"
      style={{
        left: left * scale, top: b.y * scale, width: (w * scale) / k, minHeight: (b.h * scale) / k,
        font: fontCss(l.font, px / k, ed.assets.fonts), letterSpacing: `${(l.spacing * t.size * scale) / k}px`, lineHeight: l.lineHeight,
        color: l.autoColor ? '#ffffff' : l.color, textAlign: l.align, textTransform: l.upper ? 'uppercase' : 'none',
        transformOrigin: 'top left', transform: `${l.rotate ? `rotate(${l.rotate}deg) ` : ''}${k < 1 ? `scale(${k})` : ''}` || undefined,
        textShadow: l.autoColor ? '0 1px 4px rgba(0,0,0,.6)' : undefined,
      }}
    />
  );
}

/** Right-click (or a long press, or ⋯): a menu by the pointer on a computer, a sheet from the bottom on a phone. */
function ContextMenu({ ed, at, width, onClose }: { ed: Editor; at: { x: number; y: number }; width: number; onClose: () => void }) {
  const has = ed.sel.length > 0;
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setSheet(window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768); }, []);
  const run = (f: () => void) => () => { f(); onClose(); };
  const Item = ({ icon, label, keys, onClick, off }: { icon: React.ReactNode; label: string; keys?: string; onClick: () => void; off?: boolean }) => (
    <button type="button" disabled={off} onClick={run(onClick)}
      className={cn('flex w-full items-center gap-2 rounded px-2 text-sm hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent', sheet ? 'py-3 gap-3' : 'py-1.5')}>
      {icon}<span className="flex-1 text-left">{label}</span>{keys && !sheet && <span className="text-[10px] text-muted-foreground">{keys}</span>}
    </button>
  );
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('[data-editor-menu]')) onClose(); };
    // Escape closes the menu, and only the menu (caught first, so the selection stays).
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const t = setTimeout(() => window.addEventListener('pointerdown', close), 0);
    window.addEventListener('keydown', esc, true);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc, true); };
  }, [onClose]);
  const allLocked = has && ed.selLayers.every(l => l.locked);
  const items = (<>
    <Item icon={<Copy className="h-4 w-4" />} label="Copy" keys="⌘C" onClick={() => ed.copy()} off={!has} />
    <Item icon={<Clipboard className="h-4 w-4" />} label="Paste" keys="⌘V" onClick={ed.paste} off={!ed.hasClip()} />
    <Item icon={<Scissors className="h-4 w-4" />} label="Cut" keys="⌘X" onClick={ed.cut} off={!has} />
    <Item icon={<Copy className="h-4 w-4" />} label="Duplicate" keys="⌘D" onClick={() => ed.duplicate()} off={!has} />
    {ed.p.sendTo && <Item icon={<ArrowRightLeft className="h-4 w-4" />} label={`Copy to the ${ed.p.sendTo.name}`} onClick={() => ed.sendToOther()} off={!has} />}
    <Item icon={<Trash2 className="h-4 w-4" />} label="Delete" keys="⌫" onClick={() => ed.remove()} off={!has || allLocked} />
    <div className="col-span-2 my-1 border-t" />
    <Item icon={<Paintbrush className="h-4 w-4" />} label="Copy style" onClick={ed.copyStyle} off={!ed.one} />
    <Item icon={<Paintbrush className="h-4 w-4" />} label="Paste style" onClick={ed.pasteStyle} off={!has || !ed.hasStyle()} />
    <div className="col-span-2 my-1 border-t" />
    <Item icon={<ChevronsUp className="h-4 w-4" />} label="Bring to front" keys="⌥⌘]" onClick={() => ed.reorder('front')} off={!has} />
    <Item icon={<ArrowUp className="h-4 w-4" />} label="Bring forward" keys="⌘]" onClick={() => ed.reorder('forward')} off={!has} />
    <Item icon={<ArrowDown className="h-4 w-4" />} label="Send backward" keys="⌘[" onClick={() => ed.reorder('backward')} off={!has} />
    <Item icon={<ChevronsDown className="h-4 w-4" />} label="Send to back" keys="⌥⌘[" onClick={() => ed.reorder('back')} off={!has} />
    <div className="col-span-2 my-1 border-t" />
    {ed.sel.length > 1 && !ed.grouped && <Item icon={<Group className="h-4 w-4" />} label="Group" keys="⌘G" onClick={ed.group} />}
    {ed.selLayers.some(l => l.group) && <Item icon={<Ungroup className="h-4 w-4" />} label="Ungroup" keys="⇧⌘G" onClick={ed.ungroup} />}
    <Item icon={allLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />} label={allLocked ? 'Unlock' : 'Lock'} keys="⌥⇧L" onClick={ed.toggleLock} off={!has} />
  </>);
  if (sheet) {
    return createPortal(
      <div data-editor-menu className="fixed inset-0 z-[80] flex items-end bg-black/30" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
        <div className="max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl bg-popover p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl">
          <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="grid grid-cols-2 gap-x-1">{items}</div>
        </div>
      </div>,
      document.body,
    );
  }
  return (
    <div data-editor-menu className="absolute z-30 w-56 rounded-lg border bg-popover p-1 shadow-lg"
      style={{ left: Math.max(0, Math.min(at.x - 20, width - 224)), top: at.y }} onPointerDown={e => e.stopPropagation()}>
      {items}
    </div>
  );
}

// ── The small editor beside the form: the story and the square together ────

export type PairKey = 'story' | 'square';
/** One of the two designs: its editor's props, and what the page shows around it. */
export interface PairSide {
  props: StoryEditorProps;
  /** Its tab: a name, and where it goes. */
  label: string;
  sub: string;
  /** Shown instead of the editor while there is nothing to design yet (no photo). */
  placeholder?: React.ReactNode;
  /** The page's own tools for this design: in the editor's toolbar (its AI menu), and above and below the editor. */
  tools?: React.ReactNode;
  top?: React.ReactNode;
  bottom?: React.ReactNode;
}

/**
 * The story and the square as one piece of work: both always in view as live
 * thumbnails, one of them open in the editor (a tap swaps them), one designer
 * that flips between them, and anything on one copied onto the other in its
 * place. Either can be left out (`show`) when only a story or only a post is
 * being made.
 */
export function PairEditor({ story, square, show, active, onActive }: {
  story: PairSide; square: PairSide; show: PairKey[]; active: PairKey; onActive: (k: PairKey) => void;
}) {
  const both = show.includes('story') && show.includes('square');
  const carryTo = (to: PairSide) => (ls: Layer[], from: Frame) =>
    to.props.api.change(d => ({ ...d, layers: [...d.layers, ...carryLayers(ls, from, d, to.props.fields, to.props.assets)] }));
  const storyEd = useEditor({ ...story.props, sendTo: both && !square.placeholder ? { name: 'post', send: carryTo(square) } : undefined });
  const squareEd = useEditor({ ...square.props, sendTo: both && !story.placeholder ? { name: 'story', send: carryTo(story) } : undefined });
  const k: PairKey = show.includes(active) ? active : show[0];
  const ed = k === 'square' ? squareEd : storyEd;
  const side = k === 'square' ? square : story;
  const [designer, setDesigner] = useState(false);
  const empty = !!side.placeholder;
  // The designer closes if what it shows goes (its last photo removed).
  useEffect(() => { if (empty) setDesigner(false); }, [empty]);

  // The browser's paste event carries a copied image; listen while the editor has focus.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { if (!designer && !empty && rootRef.current?.contains(document.activeElement)) ed.onPasteEvent(e); };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const sides = (['story', 'square'] as const).map(key => ({ key, side: key === 'story' ? story : square, ed: key === 'story' ? storyEd : squareEd }));
  return (
    <div ref={rootRef} className="space-y-3" onKeyDown={e => { if (!designer && !empty) ed.onKey(e); }}>
      {both ? (
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="The story and the post">
          {sides.map(s => (
            <PageTab key={s.key} ed={s.ed} label={s.side.label} sub={s.side.sub} active={k === s.key} empty={!!s.side.placeholder} onClick={() => onActive(s.key)} />
          ))}
        </div>
      ) : (
        <p className="text-sm font-semibold">{side.label} <span className="font-normal text-muted-foreground">· {side.sub}</span></p>
      )}
      {side.top}
      {side.placeholder ?? <InlineEditor key={k} ed={ed} tools={side.tools} designer={designer} onDesign={panel => { if (panel) ed.setPanel(panel); setDesigner(true); }} />}
      {!empty && side.bottom}
      {designer && !empty && (
        <Designer ed={ed} onClose={() => setDesigner(false)} F={ed.F}
          frameLabel={ed.square ? 'Post · square 1:1 · WhatsApp + website' : 'Story 9:16 · Instagram'}
          pages={both ? sides.map(s => ({ key: s.key, label: s.side.label, square: s.ed.square, off: !!s.side.placeholder })) : undefined}
          current={k} onPage={onActive} />
      )}
    </div>
  );
}

/** A design's tab: a live thumbnail, its name and where it goes. */
function PageTab({ ed, label, sub, active, empty, onClick }: { ed: Editor; label: string; sub: string; active: boolean; empty: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn('flex min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors', active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-foreground/30')}>
      <span className="flex h-[72px] w-[60px] shrink-0 items-center justify-center">
        {empty
          ? <span className={cn('rounded-[3px] border-2 border-dashed border-muted-foreground/40', ed.square ? 'h-[56px] w-[56px]' : 'h-[72px] w-[40px]')} />
          : <Thumb ed={ed} h={ed.square ? 58 : 72} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block break-words text-[11px] leading-tight text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

/** The design drawn small — a moment after it stops changing, so a drag on the big one stays smooth. */
function Thumb({ ed, h }: { ed: Editor; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { F, view, fields, assets, ver } = ed;
  const lettered = ed.p.lettered;
  const w = Math.round((h * F.w) / F.h);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(c.width / F.w, 0, 0, c.height / F.h, 0, 0);
      renderDoc(ctx, view, fields, assets, lettered ? { background: lettered, hideBound: true } : {});
    }, 150);
    return () => clearTimeout(t);
  }, [view, fields, assets, lettered, ver, w, h, F]);
  return <canvas ref={ref} aria-hidden className="rounded-[3px] bg-muted shadow-sm" style={{ width: w, height: h }} />;
}

/**
 * One design's small editor: one row of tools, the canvas, undo and redo under
 * it, and the settings for what is selected — the photo's own settings folded
 * away until asked for (the designer has everything).
 */
function InlineEditor({ ed, tools, designer, onDesign }: { ed: Editor; tools?: React.ReactNode; designer: boolean; onDesign: (panel?: SidePanel) => void }) {
  const { api, square, p } = ed;
  const { palette, assets, photos, websiteLabel } = p;
  const [bgOpen, setBgOpen] = useState(false);
  return (<>
    <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 [&>button]:px-2.5 sm:[&>button]:px-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><LayoutTemplate className="h-4 w-4 mr-1.5" /> Layouts</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{square ? 'Post layouts' : 'The shop’s layouts'}</DropdownMenuLabel>
          {p.presets.map(x => <DropdownMenuItem key={x.id} onClick={() => ed.preset(x.id)}>{x.label}</DropdownMenuItem>)}
          {ed.templates.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Saved on this device</DropdownMenuLabel></>}
          {ed.templates.map(t => (
            <DropdownMenuItem key={t.name} onClick={() => ed.useTemplate(t)} className="justify-between gap-4">
              <span className="flex items-center gap-1.5"><BookmarkCheck className="h-3.5 w-3.5" /> {t.name}</span>
              <span role="button" className="text-muted-foreground hover:text-destructive" onClick={e => { e.stopPropagation(); ed.dropTemplate(t.name); }}><Trash2 className="h-3.5 w-3.5" /></span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={ed.saveTemplate}><Save className="h-4 w-4 mr-1.5" /> Save this layout…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => ed.add(newText(palette.body))}><Type className="h-4 w-4 mr-2" /> Text</DropdownMenuItem>
          <DropdownMenuItem onClick={() => ed.add(newShape('arrow', '#FFFFFF'))}><ArrowUpRight className="h-4 w-4 mr-2" /> Arrow</DropdownMenuItem>
          <DropdownMenuItem onClick={() => ed.add(newShape('line', palette.headline))}><Minus className="h-4 w-4 mr-2" /> Line</DropdownMenuItem>
          <DropdownMenuItem onClick={() => ed.add(newShape('circle', '#FFFFFF'))}><Circle className="h-4 w-4 mr-2" /> Circle</DropdownMenuItem>
          <DropdownMenuItem onClick={() => ed.add(newShape('rect', '#FFFFFF'))}><Square className="h-4 w-4 mr-2" /> Box</DropdownMenuItem>
          <DropdownMenuItem onClick={() => ed.add(newLinkPill(websiteLabel))}><Link2 className="h-4 w-4 mr-2" /> Link pill ({websiteLabel})</DropdownMenuItem>
          <DropdownMenuItem onClick={() => ed.add(square ? newCornerMark('wordmark', assets) : newWordmark(palette.dark ? '#FFFFFF' : '#111111'))}><Type className="h-4 w-4 mr-2" /> Wordmark</DropdownMenuItem>
          {assets.marks.t && <DropdownMenuItem onClick={() => ed.add(square ? newCornerMark('t', assets) : newMonogram(palette.dark ? '#FFFFFF' : '#111111'))}><Type className="h-4 w-4 mr-2" /> t mark</DropdownMenuItem>}
          {photos.length > 1 && <DropdownMenuSeparator />}
          {photos.filter(x => x.id !== api.doc.bg.photoId).map(x => (
            <DropdownMenuItem key={x.id} onClick={() => ed.add(newImageLayer(x.id))}><ImageIcon className="h-4 w-4 mr-2" /> Photo inset {x.label ? `· ${x.label}` : ''}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDesign('elements')}><Shapes className="h-4 w-4 mr-2" /> Shapes, frames, stickers…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tools}
      <Button size="sm" onClick={() => onDesign()} title="Open the full designer"><Maximize2 className="h-4 w-4 mr-1.5" /> Design</Button>
    </div>

    {designer ? (
      <p className={cn('mx-auto flex items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground', square ? 'w-[300px] sm:w-[340px] aspect-square' : 'w-[270px] sm:w-[300px] aspect-[9/16]')}>
        Open in the designer
      </p>
    ) : (
      <Stage ed={ed} designer={false} className={cn('mx-auto', square ? 'w-[300px] sm:w-[340px]' : 'w-[270px] sm:w-[300px]')} />
    )}
    <div className="flex items-center gap-1">
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={api.undo} disabled={!api.canUndo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={api.redo} disabled={!api.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
      <p className="min-w-0 flex-1 text-right text-[11px] leading-tight text-muted-foreground">Tap to select and drag · double-tap words to type</p>
    </div>

    {p.lettered ? (
      <p className="text-xs text-muted-foreground">AI lettering is on — switch back to our fonts (AI menu) to move and style the text yourself.</p>
    ) : ed.one ? (
      <LayerInspector ed={ed} layer={ed.one} />
    ) : ed.selLayers.length > 1 ? (
      <SelectionSummary ed={ed} />
    ) : bgOpen ? (
      <div className="space-y-1">
        <button type="button" onClick={() => setBgOpen(false)} className="ml-auto flex min-h-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Hide <ChevronUp className="h-3.5 w-3.5" /></button>
        <BackgroundInspector ed={ed} />
      </div>
    ) : (
      <button type="button" onClick={() => setBgOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm hover:bg-muted/50">
        <PaintBucket className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1">{square ? 'Photos & crop' : 'Photo & colours'}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
    )}
  </>);
}

// ── The full-screen designer ───────────────────────────────────────────────

const RAIL: { id: SidePanel; label: string; icon: React.ReactNode }[] = [
  { id: 'templates', label: 'Templates', icon: <LayoutTemplate className="h-5 w-5" /> },
  { id: 'elements', label: 'Elements', icon: <Shapes className="h-5 w-5" /> },
  { id: 'text', label: 'Text', icon: <Type className="h-5 w-5" /> },
  { id: 'photos', label: 'Photos', icon: <Upload className="h-5 w-5" /> },
  { id: 'brand', label: 'Brand', icon: <PaletteIcon className="h-5 w-5" /> },
  { id: 'layers', label: 'Layers', icon: <Layers className="h-5 w-5" /> },
  { id: 'background', label: 'Background', icon: <PaintBucket className="h-5 w-5" /> },
];
/** Panels that belong to a selection; they close when it goes. */
const CONTEXT_PANELS: SidePanel[] = ['edit', 'effects', 'position', 'photo', 'font', 'colour', 'transparency', 'frame'];
const PANEL_TITLE: Record<SidePanel, string> = {
  templates: 'Templates', elements: 'Elements', text: 'Text', photos: 'Photos & uploads', brand: 'Brand kit', layers: 'Layers', background: 'Background',
  edit: 'Edit', effects: 'Effects', position: 'Position', photo: 'Edit photo', font: 'Font', colour: 'Colour', transparency: 'Transparency', frame: 'Frame',
};

/**
 * The part of the screen actually showing: on a phone it shrinks when the
 * keyboard comes up, and the designer shrinks with it so the words being typed
 * stay in view above the keys.
 */
function useVisibleViewport() {
  const [vp, setVp] = useState<{ h: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setVp({ h: Math.round(vv.height), top: Math.round(vv.offsetTop) });
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); };
  }, []);
  return vp;
}

function Designer({ ed, onClose, frameLabel, F, pages, current, onPage }: {
  ed: Editor; onClose: () => void; frameLabel: string; F: { w: number; h: number };
  /** With the story and the post both being made: a switch between them in the header. */
  pages?: { key: PairKey; label: string; square: boolean; off: boolean }[]; current?: PairKey; onPage?: (k: PairKey) => void;
}) {
  const { api } = ed;
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [mounted, setMounted] = useState(false);
  const [sheetTall, setSheetTall] = useState(false);
  const mobile = !!useIsMobile();
  const vp = useVisibleViewport();
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  // A phone opens on the design itself; a computer on the templates.
  const { setPanel, panel } = ed;
  useEffect(() => { if (mobile) setPanel(null); }, [mobile, setPanel]);
  // A selection's own panels close when nothing is selected; typing on a phone closes whatever is open.
  const nothing = ed.selLayers.length === 0 && !ed.bgSel;
  useEffect(() => { if (nothing && panel && CONTEXT_PANELS.includes(panel) && panel !== 'photo') setPanel(null); }, [nothing, panel, setPanel]);
  useEffect(() => { if (mobile && ed.editing) setPanel(null); }, [mobile, ed.editing, setPanel]);
  // On a phone, adding or picking something closes the rail's sheet: the design and the thing's own tools come first.
  const selKey = ed.sel.join();
  useEffect(() => { if (mobile && selKey && panel && !CONTEXT_PANELS.includes(panel)) setPanel(null); }, [mobile, selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSheetTall(false); }, [panel]);

  // Keys and pastes go to the designer while it is open; the page underneath doesn't scroll.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => ed.onKey(e);
    const onPaste = (e: ClipboardEvent) => ed.onPasteEvent(e);
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('paste', onPaste); document.body.style.overflow = overflow; };
  });

  const pad = mobile ? 24 : 64;
  const fit = Math.max(120, Math.min(area.w - pad, (area.h - pad) * (F.w / F.h)));
  const cssW = zoom === 'fit' ? fit : F.w * zoom;
  const pct = Math.round((cssW / F.w) * 100);
  const setZoomTo = (z: number) => setZoom(Math.min(3, Math.max(0.08, z)));
  const stepZoom = (dir: 1 | -1) => {
    const levels = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
    const now = cssW / F.w;
    const next = dir > 0 ? levels.find(z => z > now + 0.001) : [...levels].reverse().find(z => z < now - 0.001);
    if (next) setZoom(next);
  };
  // ⌘/Ctrl + scroll, or a trackpad pinch, zooms the page (not the browser).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => { const now = z === 'fit' ? fit / F.w : z; return Math.min(3, Math.max(0.08, now * Math.exp(-e.deltaY * 0.01))); });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mounted, fit, F.w]);

  const panelBody = (() => {
    switch (panel) {
      case 'templates': return <TemplatesPanel ed={ed} />;
      case 'elements': return <ElementsPanel ed={ed} />;
      case 'text': return <TextPanel ed={ed} />;
      case 'photos': return <PhotosPanel ed={ed} />;
      case 'brand': return <BrandPanel ed={ed} />;
      case 'layers': return <LayersPanel ed={ed} />;
      case 'background': return <BackgroundInspector ed={ed} bare />;
      case 'edit': return ed.one ? <LayerInspector ed={ed} layer={ed.one} bare /> : ed.selLayers.length > 1 ? <SelectionSummary ed={ed} /> : <p className="text-sm text-muted-foreground">Select something on the page to edit it.</p>;
      case 'effects': return ed.one?.kind === 'text' ? <EffectsPanel ed={ed} layer={ed.one} /> : <p className="text-sm text-muted-foreground">Select some text for its effects.</p>;
      case 'position': return <PositionPanel ed={ed} />;
      case 'photo': return <PhotoEditPanel ed={ed} />;
      case 'font': return ed.one?.kind === 'text' ? <FontPanel ed={ed} layer={ed.one} /> : <p className="text-sm text-muted-foreground">Select some text.</p>;
      case 'colour': return <ColourPanel ed={ed} />;
      case 'transparency': return <TransparencyPanel ed={ed} />;
      case 'frame': return ed.one?.kind === 'image' ? <FramePanel ed={ed} layer={ed.one} /> : <p className="text-sm text-muted-foreground">Select a photo.</p>;
      default: return null;
    }
  })();

  // The sheet on a phone: drag its handle up to make it taller, down to close it.
  const sheetDrag = useRef<{ y: number } | null>(null);
  const sheetHandle = {
    onPointerDown: (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); sheetDrag.current = { y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = sheetDrag.current; sheetDrag.current = null;
      if (!s) return;
      const dy = e.clientY - s.y;
      if (dy < -30) setSheetTall(true);
      else if (dy > 40) { if (sheetTall) setSheetTall(false); else setPanel(null); }
      else if (Math.abs(dy) < 6) setSheetTall(t => !t);
    },
  };
  const H = vp?.h ?? (typeof window !== 'undefined' ? window.innerHeight : 800);

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-x-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground [touch-action:manipulation] overscroll-none"
      style={{ top: vp?.top ?? 0, height: vp ? vp.h : '100dvh' }} role="dialog" aria-label="Designer">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-1.5 pt-[env(safe-area-inset-top)] md:gap-2 md:px-2">
        <Button size="sm" variant="ghost" onClick={onClose} className="px-2"><ArrowLeft className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Done</span></Button>
        {pages ? (<>
          <div className="flex shrink-0 items-center rounded-full border p-0.5" role="tablist" aria-label="The story and the post">
            {pages.map(pg => (
              <button key={pg.key} type="button" role="tab" aria-selected={current === pg.key} disabled={pg.off} onClick={() => onPage?.(pg.key)}
                className={cn('flex min-h-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium disabled:opacity-40', current === pg.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                <span aria-hidden className={cn('inline-block rounded-[2px] border-[1.5px] border-current', pg.square ? 'h-3 w-3' : 'h-3.5 w-2')} />{pg.label}
              </button>
            ))}
          </div>
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:inline">{frameLabel}</span>
        </>) : (
          <span className="min-w-0 truncate text-sm font-medium">{mobile ? (ed.square ? 'Post' : 'Story') : frameLabel}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5 md:gap-1">
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={api.undo} disabled={!api.canUndo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={api.redo} disabled={!api.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="secondary" className="px-2.5 md:px-3" aria-label="Download"><Download className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Download</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[70]">
              <DropdownMenuItem onClick={() => ed.download('png')}>PNG — sharpest</DropdownMenuItem>
              <DropdownMenuItem onClick={() => ed.download('jpg')}>JPG — smaller file</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={ed.saveTemplate}><Save className="h-4 w-4 mr-1.5" /> Save as a template…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={onClose} className="ml-1 md:hidden">Done</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* A computer: the rail and its panel down the left. */}
        {!mobile && (<>
          <nav className="flex w-[76px] shrink-0 flex-col overflow-y-auto border-r">
            {RAIL.map(r => (
              <button key={r.id} type="button" onClick={() => setPanel(panel === r.id ? null : r.id)}
                className={cn('flex flex-col items-center gap-1 px-1 py-3 text-[10px]', panel === r.id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60')}>
                {r.icon}{r.label}
              </button>
            ))}
          </nav>
          {panel && (
            <aside className="flex w-[320px] shrink-0 flex-col border-r xl:w-[360px]">
              <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <p className="text-sm font-semibold">{PANEL_TITLE[panel]}</p>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPanel(null)}>Close</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{panelBody}</div>
            </aside>
          )}
        </>)}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!mobile && <ContextToolbar ed={ed} />}
          <div ref={areaRef} className={cn('relative min-h-0 flex-1 overflow-auto bg-muted/60', zoom === 'fit' && 'touch-none')}>
            <div className="flex min-h-full min-w-full items-center justify-center p-3 md:p-8" style={{ width: zoom === 'fit' ? undefined : cssW + pad }}>
              <Stage key={ed.square ? 'square' : 'story'} ed={ed} designer width={cssW} />
            </div>
          </div>
          {!mobile && (
            <footer className="flex h-10 shrink-0 items-center gap-1 border-t px-2 text-xs text-muted-foreground">
              <span className="truncate">Drag a box round several · double-click words to type · ⌘C / ⌘V between story and post · right-click for more</span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => stepZoom(-1)} title="Zoom out (⌘ scroll)"><ZoomOut className="h-4 w-4" /></Button>
                <input type="range" min={8} max={300} value={pct} onChange={e => setZoomTo(Number(e.target.value) / 100)} className="w-24 accent-primary" aria-label="Zoom" />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => stepZoom(1)} title="Zoom in (⌘ scroll)"><ZoomIn className="h-4 w-4" /></Button>
                <button type="button" className="w-11 tabular-nums" onClick={() => setZoom('fit')} title="Fit to screen">{pct}%</button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setZoom('fit')}>Fit</Button>
              </div>
            </footer>
          )}
        </main>
      </div>

      {/* A phone: the panel as a sheet over the bottom (the design shrinks to stay in view), then the bar. */}
      {mobile && panel && (
        <div className="flex shrink-0 flex-col rounded-t-2xl border-t bg-background shadow-[0_-8px_24px_rgba(0,0,0,.12)]"
          style={{ height: Math.round(H * (sheetTall ? 0.72 : 0.44)) }}>
          <div className="flex items-center px-3 pt-1.5 pb-1 touch-none" {...sheetHandle}>
            <span className="w-14" />
            <span className="mx-auto h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            <button type="button" className="w-14 text-right text-xs text-muted-foreground" onPointerDown={e => e.stopPropagation()} onClick={() => setPanel(null)}>Close</button>
          </div>
          <p className="px-4 pb-2 text-sm font-semibold">{PANEL_TITLE[panel]}</p>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{panelBody}</div>
        </div>
      )}
      {mobile && !ed.editing && (
        <div className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
          {ed.selLayers.length ? <MobileToolbar ed={ed} /> : (
            <nav className="flex overflow-x-auto">
              {RAIL.map(r => (
                <button key={r.id} type="button" onClick={() => setPanel(panel === r.id ? null : r.id)}
                  className={cn('flex min-w-[68px] flex-1 flex-col items-center gap-1 px-1 py-2 text-[10px]', panel === r.id ? 'text-primary' : 'text-muted-foreground')}>
                  {r.icon}{r.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
