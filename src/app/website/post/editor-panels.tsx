'use client';

/**
 * The editor's panels: the inspectors the small editor shows under its canvas,
 * and the designer's rail (templates, elements, text, photos and uploads,
 * brand, layers, background), its selection toolbar, and the panels that
 * toolbar opens (effects, position, edit photo).
 *
 * Every control changes the document through the editor (story-editor.tsx),
 * so undo, the preview and the published JPEG all follow.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Copy, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Unlink, Lock, Unlock, Group, Ungroup, ChevronsUp, ChevronsDown, Bold, Italic, Underline, CaseUpper,
  AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, FlipHorizontal2, FlipVertical2, Sparkles, Move, Droplet, SlidersHorizontal, Minus, Plus,
  Upload, GripVertical, Type, Image as ImageIcon, Shapes, Paintbrush, Spline, Save, Trash, Frame as FrameIcon, Wand2, Link2, Pencil, Check, Keyboard, Palette as PaletteIcon, MoreHorizontal,
  ArrowRightLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PALETTES } from '@/lib/social/palettes';
import {
  BADGES, BOLD_OF, EFFECTS, FONT_LABEL, ITALIC_OF, TEXT_STYLES, applyPalette, effectDefaults, effectOf, fontCss, layerBox, moveLayer, newBody, newCornerMark,
  newFrame, newHeading, newImageLayer, newInFont, newLineStyle, newLinkPill, newMonogram, newShape, newShapeOf, newSubheading, newUploadLayer, newWordmark,
  placementOf, reflow, renderDocTo, uploadedImage, withPlacement,
  type Bind, type EffectKind, type FontKey, type ImageLayer, type Layer, type MarkLayer, type ShapeLayer, type StoryDoc, type TextLayer, type TextEffect,
} from '@/lib/social/editor';
import { FILTERS, MASK_PICKS, NO_ADJUST, SHAPES, SHAPE_PICKS, applyAdjust, isPlain, type Adjust, type AlignHow, type MaskKey } from '@/lib/social/design';
import { sessionUploads, type Editor, type SidePanel } from './story-editor';

const Z = 'z-[70]'; // above the designer, which sits over the page
/** An icon button that grows to a finger's size on a touch screen. */
const IB = `h-7 w-7 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9`;

// ── Small parts ────────────────────────────────────────────────────────────

const SWATCHES = ['#FFFFFF', '#111111', '#1F4A2C', '#2E9E57', '#C07A3E', '#C9973F', '#2C3480', '#7A5A35', '#E8D5B5', '#8B1E2D'];

/** The colours already in the design, as Canva offers them first. */
function docColours(ed: Editor): string[] {
  const out = new Set<string>();
  const put = (c?: string | null) => { if (c && /^#[0-9a-f]{6}$/i.test(c)) out.add(c.toUpperCase()); };
  put(ed.doc.bg.color); put(ed.doc.bg.color2);
  for (const l of ed.doc.layers) {
    if (l.kind === 'text') { put(l.color); put(l.box?.color); put(l.effect?.color); }
    else if (l.kind === 'image') put(l.border);
    else if (l.kind === 'wordmark') put(l.color);
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

/** A swatch that opens the colour choices (document colours, brand colours, any colour). */
function ColourButton({ ed, value, onChange, title, ring }: { ed: Editor; value: string; onChange: (c: string) => void; title: string; ring?: boolean }) {
  const doc = docColours(ed);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title={title} className="flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted">
          <span className={cn('h-5 w-5 rounded-full border', ring && 'ring-2 ring-offset-1 ring-border')} style={{ background: value }} />
          <span className="text-xs hidden lg:inline">{title}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn(Z, 'w-64 space-y-3')} align="start">
        {doc.length > 0 && <div><p className="mb-1.5 text-[11px] text-muted-foreground">In this design</p><ColourRow value={value} onChange={onChange} extra={doc} /></div>}
        <div><p className="mb-1.5 text-[11px] text-muted-foreground">{doc.length ? 'Brand colours' : 'Colours'}</p><ColourRow value={value} onChange={onChange} /></div>
      </PopoverContent>
    </Popover>
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
const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="space-y-2 pt-3 first:pt-0">
    <div className="flex items-center justify-between"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>{right}</div>
    {children}
  </div>
);
const Tool = ({ title, active, onClick, children, disabled }: { title: string; active?: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean }) => (
  <button type="button" title={title} disabled={disabled} onClick={onClick}
    className={cn('flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs disabled:opacity-40', active ? 'bg-primary/15 text-primary' : 'hover:bg-muted')}>
    {children}
  </button>
);

/** A shape's outline as a little SVG, for the pickers. */
const ShapeIcon = ({ path, fill = 'currentColor', size = 40 }: { path: string; fill?: string; size?: number }) => (
  <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden><path d={path} fill={fill} /></svg>
);

/** The piece's photos and the text on them are drawn in these CSS faces too. */
const faceStyle = (ed: Editor, font: FontKey, px: number): React.CSSProperties => ({ font: fontCss(font, px, ed.assets.fonts) });

// ── Inspectors (the small editor, and the designer's Edit panel) ───────────

export function LayerInspector({ ed, layer: l, bare }: { ed: Editor; layer: Layer; bare?: boolean }) {
  const set = (patch: Partial<Layer> | ((x: Layer) => Layer), key?: string) => ed.update(l.id, patch, key);
  const box = layerBox(l, ed.fields, ed.assets);
  const doc = docColours(ed);
  return (
    <div className={cn('space-y-2.5', !bare && 'rounded-lg border p-3')}>
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium flex-1 truncate">{ed.layerName(l)}{l.group ? <span className="text-muted-foreground font-normal"> · grouped</span> : null}</span>
        <Button size="icon" variant="ghost" className={IB} title="Bring forward" onClick={() => ed.reorder('forward', [l.id])}><ArrowUp className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className={IB} title="Send back" onClick={() => ed.reorder('backward', [l.id])}><ArrowDown className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className={IB} title={l.hidden ? 'Show' : 'Hide'} onClick={() => set({ hidden: !l.hidden })}>{l.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
        <Button size="icon" variant="ghost" className={IB} title={l.locked ? 'Unlock' : 'Lock'} onClick={() => set({ locked: !l.locked })}>{l.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}</Button>
        <Button size="icon" variant="ghost" className={IB} title="Duplicate (⌘D)" onClick={() => ed.duplicate([l.id])}><Copy className="h-3.5 w-3.5" /></Button>
        {ed.p.sendTo && <Button size="icon" variant="ghost" className={IB} title={`Copy to the ${ed.p.sendTo.name}`} onClick={() => ed.sendToOther([l.id])}><ArrowRightLeft className="h-3.5 w-3.5" /></Button>}
        <Button size="icon" variant="ghost" className={cn(IB, 'text-destructive')} title="Delete" onClick={() => ed.remove([l.id])} disabled={l.locked}><Trash2 className="h-3.5 w-3.5" /></Button>
        {!bare && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={ed.clear}>Done</Button>}
      </div>
      {l.locked && <p className="text-[11px] text-muted-foreground">Locked — it can’t be moved or deleted until you unlock it.</p>}

      {l.kind === 'text' && (<>
        <Textarea rows={2} value={l.bind ? ed.fields[l.bind] : l.text}
          onChange={e => l.bind ? ed.onField(l.bind, e.target.value) : set({ text: e.target.value }, 'text')} className="text-sm" />
        {l.bind && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-2">
            {l.bind === 'weight' || l.bind === 'details' ? 'Made from the piece’s fields.' : `Same as the ${l.bind} field.`}
            <button type="button" className="text-primary inline-flex items-center gap-1" onClick={() => set(x => ({ ...(x as TextLayer), bind: undefined, text: ed.fields[(x as TextLayer).bind!] }))}><Unlink className="h-3 w-3" /> Type your own</button>
          </p>
        )}
        <Row label="Font">
          <Select value={l.font} onValueChange={v => set({ font: v as FontKey })} recentsKey={false}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent className={Z}>{(Object.keys(FONT_LABEL) as FontKey[]).map(f => <SelectItem key={f} value={f}><span style={faceStyle(ed, f, 15)}>{FONT_LABEL[f]}</span></SelectItem>)}</SelectContent>
          </Select>
        </Row>
        <Row label="Size"><Num value={l.size} min={16} max={400} onChange={v => set({ size: v }, 'size')} /></Row>
        <Row label="Colour"><ColourRow value={l.color} onChange={c => set({ color: c }, 'color')} extra={doc} /></Row>
        <Row label="Align"><Pills value={l.align} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={v => set(x => realign(x as TextLayer, v as TextLayer['align'], box))} /></Row>
        <Row label="Line width"><Num value={l.width} min={120} max={1080} step={10} onChange={v => set({ width: v }, 'width')} /></Row>
        <Row label="Spacing"><Num value={l.spacing} min={-0.05} max={0.5} step={0.01} onChange={v => set({ spacing: v }, 'spacing')} /></Row>
        <Row label="Line height"><Num value={l.lineHeight} min={0.7} max={2} step={0.05} onChange={v => set({ lineHeight: v }, 'lh')} /></Row>
        <Row label="Curve"><Num value={l.curve ?? 0} min={-100} max={100} onChange={v => set({ curve: Math.abs(v) < 2 ? 0 : v }, 'curve')} /></Row>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-1.5"><Switch checked={l.fit} onCheckedChange={v => set({ fit: v })} /> Shrink to fit</label>
          <label className="flex items-center gap-1.5"><Switch checked={l.upper} onCheckedChange={v => set({ upper: v })} /> CAPITALS</label>
          <label className="flex items-center gap-1.5"><Switch checked={!!l.underline} onCheckedChange={v => set({ underline: v })} /> Underline</label>
          <label className="flex items-center gap-1.5" title="White or dark, whichever reads over each photo"><Switch checked={!!l.autoColor} onCheckedChange={v => set({ autoColor: v })} /> Auto colour</label>
          <label className="flex items-center gap-1.5"><Switch checked={!!l.box} onCheckedChange={v => set({ box: v ? { color: '#FFFFFF', radius: 24, pad: 20 } : null })} /> Background</label>
        </div>
        {l.box && <Row label="Background"><ColourRow value={l.box.color} onChange={c => set(x => ({ ...(x as TextLayer), box: { ...(x as TextLayer).box!, color: c } }), 'boxc')} /></Row>}
        <Row label="Effect">
          <Select value={effectOf(l)?.kind ?? 'none'} onValueChange={v => set({ effect: v === 'none' ? null : effectDefaults(v as EffectKind, l.color), shadow: false })} recentsKey={false}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent className={Z}>{EFFECTS.map(e => <SelectItem key={e.kind} value={e.kind}>{e.label}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
        {effectOf(l) && <EffectControls ed={ed} l={l} />}
      </>)}

      {l.kind === 'wordmark' && (<>
        {ed.assets.marks.t && <Row label="Mark"><Pills value={l.mark} options={[['wordmark', 'taheri'], ['t', 't']]} onChange={v => set(x => {
          // Keep it about the same height on screen when switching between the wide and the tall mark.
          const m = x as MarkLayer;
          const next = v as MarkLayer['mark'];
          const width = next === m.mark ? m.width : next === 't' ? Math.max(24, Math.round(m.width * 0.25 / 2)) : Math.round(m.width * 2 / 0.25);
          return { ...m, mark: next, width: Math.min(width, 1000) };
        })} /></Row>}
        <Row label="Size"><Num value={l.width} min={20} max={1000} step={2} onChange={v => set({ width: v }, 'w')} /></Row>
        <label className="flex items-center gap-1.5 text-xs" title="White or dark, whichever reads over each photo"><Switch checked={l.autoColor} onCheckedChange={v => set({ autoColor: v })} /> Auto colour (white or dark by the photo)</label>
        {!l.autoColor && <Row label="Colour"><ColourRow value={l.color} onChange={c => set({ color: c }, 'color')} extra={doc} /></Row>}
      </>)}

      {l.kind === 'image' && <ImageControls ed={ed} l={l} />}

      {(l.kind === 'arrow' || l.kind === 'line' || l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape') && <ShapeControls ed={ed} l={l} />}

      {l.kind !== 'text' && (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => set({ flipX: !l.flipX })}><FlipHorizontal2 className="h-3.5 w-3.5 mr-1" /> Flip</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => set({ flipY: !l.flipY })}><FlipVertical2 className="h-3.5 w-3.5 mr-1" /> Flip vertical</Button>
        </div>
      )}
      <Row label="Turn"><Num value={l.rotate} min={-180} max={180} onChange={v => set({ rotate: v }, 'rot')} /></Row>
      <Row label="Opacity"><Num value={l.opacity} min={0.05} max={1} step={0.05} onChange={v => set({ opacity: v }, 'op')} /></Row>
    </div>
  );
}

/** Keep text where it is on screen when its alignment changes: move the anchor to the matching edge. */
function realign(x: TextLayer, v: TextLayer['align'], box: { x: number; w: number }): TextLayer {
  const pad = x.box?.pad ?? 0;
  const ax = v === 'left' ? box.x + pad : v === 'center' ? box.x + box.w / 2 : box.x + box.w - pad;
  return { ...x, align: v, x: ax };
}

function EffectControls({ ed, l }: { ed: Editor; l: TextLayer }) {
  const fx = effectOf(l)!;
  const setFx = (patch: Partial<TextEffect>, key: string) => ed.update(l.id, x => ({ ...(x as TextLayer), shadow: false, effect: { ...effectOf(x as TextLayer)!, ...patch } }), key);
  const uses = {
    offset: ['shadow', 'splice', 'echo', 'glitch'].includes(fx.kind),
    angle: ['shadow', 'splice', 'echo'].includes(fx.kind),
    blur: ['shadow', 'neon'].includes(fx.kind),
    thickness: ['hollow', 'outline', 'splice'].includes(fx.kind),
    transparency: ['shadow', 'lift'].includes(fx.kind),
    color: ['shadow', 'outline', 'splice', 'echo', 'neon'].includes(fx.kind),
  };
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      {uses.offset && <Row label="Offset"><Num value={fx.offset} min={0} max={100} onChange={v => setFx({ offset: v }, 'fxo')} /></Row>}
      {uses.angle && <Row label="Direction"><Num value={fx.angle} min={-180} max={180} onChange={v => setFx({ angle: v }, 'fxa')} /></Row>}
      {uses.blur && <Row label={fx.kind === 'neon' ? 'Glow' : 'Blur'}><Num value={fx.blur} min={0} max={100} onChange={v => setFx({ blur: v }, 'fxb')} /></Row>}
      {uses.thickness && <Row label="Thickness"><Num value={fx.thickness} min={1} max={100} onChange={v => setFx({ thickness: v }, 'fxt')} /></Row>}
      {uses.transparency && <Row label={fx.kind === 'lift' ? 'Softness' : 'Transparency'}><Num value={fx.transparency} min={0} max={100} onChange={v => setFx({ transparency: v }, 'fxtr')} /></Row>}
      {uses.color && <Row label="Colour"><ColourRow value={fx.color} onChange={c => setFx({ color: c }, 'fxc')} extra={docColours(ed)} /></Row>}
    </div>
  );
}

function ShapeControls({ ed, l }: { ed: Editor; l: ShapeLayer }) {
  const set = (patch: Partial<ShapeLayer>, key?: string) => ed.update(l.id, patch as Partial<Layer>, key);
  const doc = docColours(ed);
  const closed = l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape';
  return (<>
    {l.kind === 'shape' && (
      <div className="flex flex-wrap gap-1">{SHAPE_PICKS.map(k => (
        <button key={k} type="button" title={SHAPES[k].label} onClick={() => set({ shape: k })} className={cn('rounded-md border p-1', l.shape === k ? 'border-primary' : 'border-transparent hover:border-border')}>
          <ShapeIcon path={SHAPES[k].path(40, 40)} size={22} />
        </button>
      ))}</div>
    )}
    {closed && (<>
      <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!l.fill} onCheckedChange={v => set({ fill: v ? '#FFFFFF' : null })} /> Filled</label>
      {l.fill && <Row label="Fill"><ColourRow value={l.fill} onChange={c => set({ fill: c }, 'fill')} extra={doc} /></Row>}
      {l.fill && <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!l.fill2} onCheckedChange={v => set({ fill2: v ? '#C9973F' : null })} /> Gradient</label>}
      {l.fill && l.fill2 && <Row label="Fades to"><ColourRow value={l.fill2} onChange={c => set({ fill2: c }, 'fill2')} extra={doc} /></Row>}
    </>)}
    <Row label={closed ? 'Border' : 'Colour'}><ColourRow value={l.color} onChange={c => set({ color: c }, 'color')} extra={doc} /></Row>
    <Row label="Thickness"><Num value={l.stroke} min={0} max={40} onChange={v => set({ stroke: v }, 'stroke')} /></Row>
    <Row label="Style"><Pills value={l.dash ?? 'solid'} options={[['solid', '——'], ['dash', '– – –'], ['dot', '• • •']]} onChange={v => set({ dash: v as ShapeLayer['dash'] })} /></Row>
    {(l.kind === 'arrow' || l.kind === 'line') && (<>
      <Row label="Bend"><Num value={l.curve} min={-300} max={300} step={5} onChange={v => set({ curve: v }, 'curve')} /></Row>
      <Row label="Direction"><div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ed.update(l.id, x => { const s = x as ShapeLayer; return { ...s, x: s.x + s.w, y: s.y + s.h, w: -s.w, h: -s.h }; })}>Reverse</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ed.update(l.id, x => { const s = x as ShapeLayer; return { ...s, x: s.x + s.w, w: -s.w, curve: -s.curve }; })}>Mirror</Button>
      </div></Row>
    </>)}
    {l.kind === 'rect' && <Row label="Corners"><Num value={l.radius} min={0} max={300} onChange={v => set({ radius: v }, 'r')} /></Row>}
    {closed && <>
      <Row label="Width"><Num value={Math.abs(l.w)} min={10} max={1080} step={5} onChange={v => set({ w: v }, 'w')} /></Row>
      <Row label="Height"><Num value={Math.abs(l.h)} min={10} max={1920} step={5} onChange={v => set({ h: v }, 'h')} /></Row>
    </>}
  </>);
}

function ImageControls({ ed, l }: { ed: Editor; l: ImageLayer }) {
  const set = (patch: Partial<ImageLayer>, key?: string) => ed.update(l.id, patch as Partial<Layer>, key);
  return (<>
    {!l.src && (
      <Row label="Photo">
        <div className="flex gap-1.5 overflow-x-auto">{ed.p.photos.map(p => (
          <button key={p.id} type="button" onClick={() => set({ photoId: p.id })} className={cn('h-10 w-10 shrink-0 rounded overflow-hidden border-2', l.photoId === p.id ? 'border-primary' : 'border-transparent')}><img src={p.url} alt="" className="h-full w-full object-cover" /></button>
        ))}</div>
      </Row>
    )}
    <Row label="Frame"><MaskPicker value={l.mask ?? null} onChange={m => ed.update(l.id, x => withMask(x as ImageLayer, m, ed))} /></Row>
    {l.h && (<>
      <Row label="Crop across"><Num value={l.fx ?? 0.5} min={0} max={1} step={0.01} onChange={v => set({ fx: v }, 'fx')} /></Row>
      <Row label="Crop down"><Num value={l.fy ?? 0.5} min={0} max={1} step={0.01} onChange={v => set({ fy: v }, 'fy')} /></Row>
    </>)}
    <Row label="Size"><Num value={l.w} min={40} max={1080} step={5} onChange={v => ed.update(l.id, x => { const i = x as ImageLayer; return { ...i, w: v, ...(i.h ? { h: Math.round(i.h * v / i.w) } : {}) }; }, 'w')} /></Row>
    {!l.mask && <Row label="Corners"><Num value={l.radius} min={0} max={300} onChange={v => set({ radius: v }, 'r')} /></Row>}
    <div className="flex gap-4 text-xs">
      <label className="flex items-center gap-1.5"><Switch checked={!!l.border} onCheckedChange={v => set({ border: v ? '#FFFFFF' : null })} /> Border</label>
      <label className="flex items-center gap-1.5"><Switch checked={l.shadow} onCheckedChange={v => set({ shadow: v })} /> Shadow</label>
    </div>
    {l.border && <Row label="Border"><ColourRow value={l.border} onChange={c => set({ border: c }, 'border')} extra={docColours(ed)} /></Row>}
    <AdjustControls value={l.adjust ?? NO_ADJUST} onChange={(a, key) => set({ adjust: isPlain(a) ? null : a }, key)} img={imageOfLayer(ed, l)} />
  </>);
}

const imageOfLayer = (ed: Editor, l: ImageLayer) => (l.src ? uploadedImage(l.src) : ed.assets.photos[l.photoId]) ?? null;

/** Framing a photo gives it a frame's own height (square, or an arch's); unframing gives it back its proportions. */
function withMask(l: ImageLayer, m: MaskKey | null, ed: Editor): ImageLayer {
  if (!m) return { ...l, mask: null, h: undefined, fx: undefined, fy: undefined };
  const img = imageOfLayer(ed, l);
  const natural = img && img.naturalWidth ? l.w * img.naturalHeight / img.naturalWidth : l.w;
  const h = l.h ?? (m === 'arch' || m === 'pill' ? Math.round(l.w * 1.3) : m === 'rounded' ? Math.round(natural) : l.w);
  return { ...l, mask: m, h, radius: 0 };
}

function MaskPicker({ value, onChange }: { value: MaskKey | null; onChange: (m: MaskKey | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" title="No frame" onClick={() => onChange(null)} className={cn('h-8 rounded-md border px-2 text-[11px]', !value ? 'border-primary' : 'border-transparent hover:border-border')}>None</button>
      {MASK_PICKS.map(m => (
        <button key={m} type="button" title={SHAPES[m].label} onClick={() => onChange(m)} className={cn('rounded-md border p-1', value === m ? 'border-primary' : 'border-transparent hover:border-border')}>
          <ShapeIcon path={SHAPES[m].path(40, 40)} size={22} />
        </button>
      ))}
    </div>
  );
}

/** A photo's filter strip (each a thumbnail of the photo through that filter) and its six sliders. */
function AdjustControls({ value, onChange, img }: { value: Adjust; onChange: (a: Adjust, key?: string) => void; img: HTMLImageElement | null }) {
  const [open, setOpen] = useState(false);
  const thumbs = useFilterThumbs(img);
  const current = FILTERS.find(f => JSON.stringify(f.adjust) === JSON.stringify(value))?.id;
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1">{FILTERS.map(f => (
        <button key={f.id} type="button" onClick={() => onChange(f.adjust)} className="shrink-0 space-y-0.5 text-center">
          <span className={cn('block h-14 w-14 overflow-hidden rounded-md border-2 bg-muted', current === f.id ? 'border-primary' : 'border-transparent')}>
            {thumbs[f.id] && <img src={thumbs[f.id]} alt="" className="h-full w-full object-cover" />}
          </span>
          <span className="block text-[10px] text-muted-foreground">{f.label}</span>
        </button>
      ))}</div>
      <button type="button" className="text-xs text-primary inline-flex items-center gap-1" onClick={() => setOpen(o => !o)}><SlidersHorizontal className="h-3 w-3" /> {open ? 'Hide' : 'Adjust'} brightness, contrast…</button>
      {open && (
        <div className="space-y-2">
          {([['brightness', 'Brightness', -100], ['contrast', 'Contrast', -100], ['saturation', 'Saturation', -100], ['warmth', 'Warmth', -100], ['fade', 'Fade', 0], ['vignette', 'Vignette', 0]] as const).map(([k, label, min]) => (
            <Row key={k} label={label}><Num value={value[k]} min={min} max={100} onChange={v => onChange({ ...value, [k]: v }, `adj-${k}`)} /></Row>
          ))}
          <button type="button" className="text-xs text-muted-foreground" onClick={() => onChange(NO_ADJUST)}>Reset</button>
        </div>
      )}
    </div>
  );
}

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
        if (!isPlain({ ...f.adjust, vignette: 0 })) { const d = t.getImageData(0, 0, s, s); applyAdjust(d.data, f.adjust); t.putImageData(d, 0, 0); }
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

/** Several selected: what can be done to all of them at once. */
export function SelectionSummary({ ed }: { ed: Editor }) {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium flex-1">{ed.selLayers.length} selected{ed.grouped ? ' · a group' : ''}</span>
        <Button size="icon" variant="ghost" className={IB} title={ed.grouped ? 'Ungroup (⇧⌘G)' : 'Group (⌘G)'} onClick={ed.grouped ? ed.ungroup : ed.group}>{ed.grouped ? <Ungroup className="h-3.5 w-3.5" /> : <Group className="h-3.5 w-3.5" />}</Button>
        <Button size="icon" variant="ghost" className={IB} title="Lock" onClick={ed.toggleLock}><Lock className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className={IB} title="Duplicate (⌘D)" onClick={() => ed.duplicate()}><Copy className="h-3.5 w-3.5" /></Button>
        {ed.p.sendTo && <Button size="icon" variant="ghost" className={IB} title={`Copy to the ${ed.p.sendTo.name}`} onClick={() => ed.sendToOther()}><ArrowRightLeft className="h-3.5 w-3.5" /></Button>}
        <Button size="icon" variant="ghost" className={cn(IB, 'text-destructive')} title="Delete" onClick={() => ed.remove()}><Trash2 className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={ed.clear}>Done</Button>
      </div>
      <AlignButtons ed={ed} />
      <Row label="Opacity"><Num value={ed.selLayers[0]?.opacity ?? 1} min={0.05} max={1} step={0.05} onChange={v => ed.updateSel(l => ({ ...l, opacity: v }), 'op')} /></Row>
    </div>
  );
}

function AlignButtons({ ed }: { ed: Editor }) {
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

export function BackgroundInspector({ ed, bare }: { ed: Editor; bare?: boolean }) {
  const { doc, change } = ed.api;
  const { photos, palette, onPalette, photoTools } = ed.p;
  const square = ed.square;
  const bg = doc.bg;
  const setBg = (patch: Partial<StoryDoc['bg']>, key?: string) => change(d => ({ ...d, bg: { ...d.bg, ...patch } }), { key: key ? `bg:${key}` : undefined });
  const pl = placementOf(doc);
  const setPl = (patch: Partial<typeof pl>, key?: string) => change(d => withPlacement(d, { ...placementOf(d), ...patch }), { key: key ? `pl:${key}` : undefined });
  const photo = bg.photoId ? ed.assets.photos[bg.photoId] ?? null : null;
  return (
    <div className={cn('space-y-2.5', !bare && 'rounded-lg border p-3')}>
      {!bare && <p className="text-sm font-medium">{square ? 'Photos & crop' : 'Photo & colours'}</p>}
      <Row label={square ? 'Editing' : 'Photo'}>
        <div className="flex gap-1.5 overflow-x-auto">{photos.map(p => (
          <button key={p.id} type="button" onClick={() => setBg(square ? { photoId: p.id } : { photoId: p.id, placement: { ...pl, focusX: 0.5, focusY: 0.5, zoom: 1 } })} className={cn('h-10 w-10 shrink-0 rounded overflow-hidden border-2', bg.photoId === p.id ? 'border-primary' : 'border-transparent')}><img src={p.url} alt="" className="h-full w-full object-cover" /></button>
        ))}</div>
      </Row>
      {square && <p className="text-[11px] text-muted-foreground">Every photo going to WhatsApp or the website is shown here. The words and marks are shared; each photo keeps its own crop — drag or pinch it to choose what shows.</p>}
      <Row label="Show"><Pills value={pl.mode} options={[['fill', square ? 'Crop to square' : 'Fill the frame'], ['fit', 'Whole photo']]} onChange={v => setPl({ mode: v as 'fill' | 'fit', focusX: 0.5, focusY: 0.5 })} /></Row>
      <Row label="Zoom"><Num value={pl.zoom} min={1} max={3} step={0.05} onChange={v => setPl({ zoom: v }, 'zoom')} /></Row>
      {photoTools}
      <Row label="Darken"><Num value={bg.dim} min={0} max={0.7} step={0.05} onChange={v => setBg({ dim: v }, 'dim')} /></Row>
      <Row label="Shade"><Pills value={bg.gradient} options={[['none', 'None'], ['top', 'Top'], ['bottom', 'Bottom'], ['both', 'Both']]} onChange={v => setBg({ gradient: v as StoryDoc['bg']['gradient'] })} /></Row>
      <Row label="Behind"><ColourRow value={bg.color} onChange={c => setBg({ color: c }, 'color')} extra={docColours(ed)} /></Row>
      <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!bg.color2} onCheckedChange={v => setBg({ color2: v ? '#C9973F' : null })} /> Gradient behind</label>
      {bg.color2 && <Row label="Fades to"><ColourRow value={bg.color2} onChange={c => setBg({ color2: c }, 'color2')} /></Row>}
      {photo && (
        <div className="pt-1 border-t">
          <p className="text-xs text-muted-foreground mb-1.5">Photo filter{square ? ' (every square)' : ''}</p>
          <AdjustControls value={bg.adjust ?? NO_ADJUST} onChange={(a, key) => setBg({ adjust: isPlain(a) ? null : a }, key)} img={photo} />
        </div>
      )}
      {!square && <Row label="Lettering">
        <div className="flex flex-wrap gap-1.5">
          {PALETTES.map(pp => (
            <button key={pp.id} type="button" onClick={() => { onPalette(pp); change(d => applyPalette(d, pp)); }} title={pp.label}
              className={cn('h-8 w-8 rounded-full border-2 flex items-center justify-center', palette.id === pp.id ? 'border-primary' : 'border-transparent')} style={{ background: pp.dark ? '#2a2a2a' : '#EDE6DA' }}>
              <span className="h-4 w-4 rounded-full" style={{ background: pp.headline }} />
            </button>
          ))}
        </div>
      </Row>}
      {doc.layers.length > 0 && (
        <div className="pt-1 border-t">
          <p className="text-xs text-muted-foreground mb-1.5">On the {square ? 'square' : 'story'} — tap to edit</p>
          <div className="flex flex-wrap gap-1.5">{[...ed.view.layers].reverse().map(l => (
            <button key={l.id} type="button" onClick={() => ed.select(ed.withGroups([l.id]))} className={cn('rounded-full border px-2.5 py-0.5 text-xs', l.hidden && 'opacity-50 line-through')}>{ed.layerName(l)}</button>
          ))}</div>
        </div>
      )}
    </div>
  );
}

// ── The designer's toolbar for what is selected ────────────────────────────

export function ContextToolbar({ ed }: { ed: Editor }) {
  const l = ed.one;
  const openPanel = (p: Parameters<Editor['setPanel']>[0]) => ed.setPanel(ed.panel === p ? null : p);
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
  const common = (
    <>
      {sep}
      <Tool title="Position, align and order" active={ed.panel === 'position'} onClick={() => openPanel('position')}><Move className="h-4 w-4" /><span className="hidden sm:inline">Position</span></Tool>
      <Popover>
        <PopoverTrigger asChild><button type="button" title="Transparency" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted"><Droplet className="h-4 w-4" /></button></PopoverTrigger>
        <PopoverContent className={cn(Z, 'w-60')}><Row label="Transparency"><Num value={Math.round((1 - (ed.selLayers[0]?.opacity ?? 1)) * 100)} min={0} max={95} onChange={v => ed.updateSel(x => ({ ...x, opacity: 1 - v / 100 }), 'op')} /></Row></PopoverContent>
      </Popover>
      <Tool title="Copy style" onClick={ed.copyStyle} disabled={!l}><Paintbrush className="h-4 w-4" /></Tool>
      <Tool title={ed.selLayers.every(x => x.locked) ? 'Unlock' : 'Lock'} active={ed.selLayers.every(x => x.locked)} onClick={ed.toggleLock}>{ed.selLayers.every(x => x.locked) ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</Tool>
      <Tool title="Duplicate (⌘D)" onClick={() => ed.duplicate()}><Copy className="h-4 w-4" /></Tool>
      {ed.p.sendTo && <Tool title={`Copy to the ${ed.p.sendTo.name}, in the same place`} onClick={() => ed.sendToOther()}><ArrowRightLeft className="h-4 w-4" /><span className="hidden 2xl:inline">To the {ed.p.sendTo.name}</span></Tool>}
      <Tool title="Delete" onClick={() => ed.remove()}><Trash2 className="h-4 w-4" /></Tool>
    </>
  );
  let body: React.ReactNode;
  if (ed.p.lettered) body = <span className="text-xs text-muted-foreground">AI lettering is on — switch to “Our fonts” to style the text yourself.</span>;
  else if (!ed.selLayers.length) {
    body = (<>
      <span className="text-xs text-muted-foreground mr-2 shrink-0">{ed.bgSel ? 'The photo:' : 'Select something on the page, or:'}</span>
      <Tool title="Background" active={ed.panel === 'background'} onClick={() => openPanel('background')}><Paintbrush className="h-4 w-4" /> Background</Tool>
      {ed.doc.bg.photoId && <Tool title="Filters and adjustments" active={ed.panel === 'photo'} onClick={() => openPanel('photo')}><Wand2 className="h-4 w-4" /> Edit photo</Tool>}
      <Tool title="Layers" active={ed.panel === 'layers'} onClick={() => openPanel('layers')}><GripVertical className="h-4 w-4" /> Layers</Tool>
    </>);
  } else if (!l) {
    body = (<>
      <span className="text-xs text-muted-foreground mr-1 shrink-0">{ed.selLayers.length} selected</span>
      <Tool title={ed.grouped ? 'Ungroup (⇧⌘G)' : 'Group (⌘G)'} onClick={ed.grouped ? ed.ungroup : ed.group}>{ed.grouped ? <Ungroup className="h-4 w-4" /> : <Group className="h-4 w-4" />}<span>{ed.grouped ? 'Ungroup' : 'Group'}</span></Tool>
      <Tool title="Line up with each other" onClick={() => ed.align('left')}><AlignStartVertical className="h-4 w-4" /></Tool>
      <Tool title="Centre them" onClick={() => ed.align('center')}><AlignCenterVertical className="h-4 w-4" /></Tool>
      <Tool title="Middle them" onClick={() => ed.align('middle')}><AlignCenterHorizontal className="h-4 w-4" /></Tool>
      {common}
    </>);
  } else if (l.kind === 'text') {
    const set = (patch: Partial<TextLayer>, key?: string) => ed.update(l.id, patch as Partial<Layer>, key);
    const bold = BOLD_OF[l.font], italic = ITALIC_OF[l.font];
    const alignNext: Record<TextLayer['align'], TextLayer['align']> = { left: 'center', center: 'right', right: 'left' };
    body = (<>
      <Select value={l.font} onValueChange={v => set({ font: v as FontKey })} recentsKey={false}>
        <SelectTrigger className="h-8 w-[150px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent className={Z}>{(Object.keys(FONT_LABEL) as FontKey[]).map(f => <SelectItem key={f} value={f}><span style={faceStyle(ed, f, 15)}>{FONT_LABEL[f]}</span></SelectItem>)}</SelectContent>
      </Select>
      <div className="ml-1 flex shrink-0 items-center rounded-md border">
        <button type="button" className="h-8 w-7 flex items-center justify-center hover:bg-muted" onClick={() => set({ size: Math.max(12, Math.round(l.size - (l.size > 100 ? 10 : 2))) }, 'size')} title="Smaller"><Minus className="h-3 w-3" /></button>
        <input className="h-8 w-11 bg-transparent text-center text-xs tabular-nums outline-none" value={Math.round(l.size)} onChange={e => { const v = Number(e.target.value); if (v >= 8 && v <= 800) set({ size: v }, 'size'); }} />
        <button type="button" className="h-8 w-7 flex items-center justify-center hover:bg-muted" onClick={() => set({ size: Math.min(800, Math.round(l.size + (l.size >= 100 ? 10 : 2))) }, 'size')} title="Bigger"><Plus className="h-3 w-3" /></button>
      </div>
      <ColourButton ed={ed} value={l.color} onChange={c => set({ color: c, autoColor: false }, 'color')} title="Text colour" />
      <Tool title="Bold" disabled={!bold} active={l.font === 'bold' || l.font === 'montserrat-bold'} onClick={() => bold && set({ font: bold })}><Bold className="h-4 w-4" /></Tool>
      <Tool title="Italic" disabled={!italic} active={l.font.endsWith('italic')} onClick={() => italic && set({ font: italic })}><Italic className="h-4 w-4" /></Tool>
      <Tool title="Underline" active={!!l.underline} onClick={() => set({ underline: !l.underline })}><Underline className="h-4 w-4" /></Tool>
      <Tool title="Capitals" active={l.upper} onClick={() => set({ upper: !l.upper })}><CaseUpper className="h-4 w-4" /></Tool>
      <Tool title={`Align ${l.align}`} onClick={() => ed.update(l.id, x => realign(x as TextLayer, alignNext[l.align], ed.boxOf(x)))}>
        {l.align === 'left' ? <AlignLeft className="h-4 w-4" /> : l.align === 'center' ? <AlignCenter className="h-4 w-4" /> : <AlignRight className="h-4 w-4" />}
      </Tool>
      <Popover>
        <PopoverTrigger asChild><button type="button" title="Spacing" className="flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-muted"><Spline className="h-4 w-4" /><span className="hidden sm:inline">Spacing</span></button></PopoverTrigger>
        <PopoverContent className={cn(Z, 'w-64 space-y-2')}>
          <Row label="Letters"><Num value={l.spacing} min={-0.05} max={0.5} step={0.01} onChange={v => set({ spacing: v }, 'spacing')} /></Row>
          <Row label="Lines"><Num value={l.lineHeight} min={0.7} max={2} step={0.05} onChange={v => set({ lineHeight: v }, 'lh')} /></Row>
          <Row label="Width"><Num value={l.width} min={120} max={1080} step={10} onChange={v => set({ width: v }, 'width')} /></Row>
        </PopoverContent>
      </Popover>
      <Tool title="Effects" active={ed.panel === 'effects'} onClick={() => openPanel('effects')}><Sparkles className="h-4 w-4" /><span className="hidden sm:inline">Effects</span></Tool>
      <Tool title="Type on the canvas (Enter)" onClick={() => ed.setEditing(l.id)} disabled={l.locked}><Pencil className="h-4 w-4" /></Tool>
      {common}
    </>);
  } else if (l.kind === 'image') {
    body = (<>
      <Tool title="Filters and adjustments" active={ed.panel === 'photo'} onClick={() => openPanel('photo')}><Wand2 className="h-4 w-4" /> Edit photo</Tool>
      <Popover>
        <PopoverTrigger asChild><button type="button" title="Frame" className="flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-muted"><FrameIcon className="h-4 w-4" /> Frame</button></PopoverTrigger>
        <PopoverContent className={cn(Z, 'w-72')}><MaskPicker value={l.mask ?? null} onChange={m => ed.update(l.id, x => withMask(x as ImageLayer, m, ed))} /></PopoverContent>
      </Popover>
      <Tool title="Flip" onClick={() => ed.update(l.id, { flipX: !l.flipX })}><FlipHorizontal2 className="h-4 w-4" /></Tool>
      <Tool title="Flip vertical" onClick={() => ed.update(l.id, { flipY: !l.flipY })}><FlipVertical2 className="h-4 w-4" /></Tool>
      <Tool title="Border" active={!!l.border} onClick={() => ed.update(l.id, { border: l.border ? null : '#FFFFFF' })}><span className="h-4 w-4 rounded-sm border-2 border-current" /></Tool>
      <Tool title="Shadow" active={l.shadow} onClick={() => ed.update(l.id, { shadow: !l.shadow })}><span className="h-3.5 w-3.5 rounded-sm bg-current shadow-[2px_2px_0_rgba(0,0,0,.35)]" /></Tool>
      {common}
    </>);
  } else if (l.kind === 'wordmark') {
    body = (<>
      <Tool title="White or dark by the photo" active={l.autoColor} onClick={() => ed.update(l.id, { autoColor: !l.autoColor })}>Auto colour</Tool>
      {!l.autoColor && <ColourButton ed={ed} value={l.color} onChange={c => ed.update(l.id, { color: c }, 'color')} title="Colour" />}
      {ed.assets.marks.t && <Tool title="Switch mark" onClick={() => ed.update(l.id, x => { const m = x as MarkLayer; const next = m.mark === 't' ? 'wordmark' : 't'; return { ...m, mark: next, width: next === 't' ? Math.max(24, Math.round(m.width / 8)) : Math.min(1000, m.width * 8) }; })}>{l.mark === 't' ? 'taheri' : 't'}</Tool>}
      <Tool title="Flip" onClick={() => ed.update(l.id, { flipX: !l.flipX })}><FlipHorizontal2 className="h-4 w-4" /></Tool>
      {common}
    </>);
  } else {
    const s = l as ShapeLayer;
    const closed = s.kind === 'rect' || s.kind === 'circle' || s.kind === 'shape';
    body = (<>
      {closed && <ColourButton ed={ed} value={s.fill ?? '#FFFFFF'} onChange={c => ed.update(s.id, { fill: c }, 'fill')} title="Fill" />}
      <ColourButton ed={ed} value={s.color} onChange={c => ed.update(s.id, { color: c }, 'color')} title={closed ? 'Border' : 'Colour'} ring />
      <Popover>
        <PopoverTrigger asChild><button type="button" title="Line style" className="flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-muted"><span className="w-5 border-t-2 border-dashed border-current" /><span className="hidden sm:inline">Style</span></button></PopoverTrigger>
        <PopoverContent className={cn(Z, 'w-72 space-y-2')}>
          <Row label="Thickness"><Num value={s.stroke} min={0} max={40} onChange={v => ed.update(s.id, { stroke: v }, 'stroke')} /></Row>
          <Row label="Style"><Pills value={s.dash ?? 'solid'} options={[['solid', '——'], ['dash', '– – –'], ['dot', '• • •']]} onChange={v => ed.update(s.id, { dash: v as ShapeLayer['dash'] })} /></Row>
          {s.kind === 'rect' && <Row label="Corners"><Num value={s.radius} min={0} max={300} onChange={v => ed.update(s.id, { radius: v }, 'r')} /></Row>}
          {(s.kind === 'arrow' || s.kind === 'line') && <Row label="Bend"><Num value={s.curve} min={-300} max={300} step={5} onChange={v => ed.update(s.id, { curve: v }, 'curve')} /></Row>}
        </PopoverContent>
      </Popover>
      <Tool title="Flip" onClick={() => ed.update(s.id, { flipX: !s.flipX })}><FlipHorizontal2 className="h-4 w-4" /></Tool>
      <Tool title="All settings" active={ed.panel === 'edit'} onClick={() => openPanel('edit')}><SlidersHorizontal className="h-4 w-4" /></Tool>
      {common}
    </>);
  }
  return <div className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2">{body}</div>;
}

// ── The designer's rail ────────────────────────────────────────────────────

/** Small pictures of documents (the layouts, saved templates), redrawn when the words or photo change. */
function useThumbs(ed: Editor, docs: { id: string; doc: StoryDoc }[], px: number): Record<string, string> {
  const key = docs.map(d => d.id).join('|');
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const { id, doc } of docs) {
      try { out[id] = renderDocTo(reflow(doc, ed.fields, ed.assets), ed.fields, ed.assets, px).toDataURL('image/jpeg', 0.75); } catch { /* skipped */ }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ed.fields, ed.assets, ed.doc.bg, ed.ver, ed.p.palette, px]);
}

export function TemplatesPanel({ ed }: { ed: Editor }) {
  const { presets, previewPreset } = ed.p;
  const presetDocs = useMemo(() => (previewPreset ? presets.map(p => ({ id: `p:${p.id}`, doc: previewPreset(p.id) })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presets, previewPreset, ed.doc.bg, ed.fields]);
  const savedDocs = useMemo(() => ed.templates.map(t => ({ id: `t:${t.name}`, doc: ed.templateDoc(t) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ed.templates, ed.doc.bg]);
  const thumbs = useThumbs(ed, [...presetDocs, ...savedDocs], ed.square ? 150 : 132);
  const aspect = ed.square ? 'aspect-square' : 'aspect-[9/16]';
  return (
    <div className="space-y-4">
      <Section title={ed.square ? 'Square layouts' : 'The shop’s layouts'}>
        <div className="grid grid-cols-2 gap-2">
          {presets.map(p => (
            <button key={p.id} type="button" onClick={() => ed.preset(p.id)} className="group space-y-1 text-left">
              <span className={cn('block overflow-hidden rounded-md border bg-muted group-hover:ring-2 group-hover:ring-primary', aspect)}>
                {thumbs[`p:${p.id}`] ? <img src={thumbs[`p:${p.id}`]} alt="" className="h-full w-full object-cover" /> : null}
              </span>
              <span className="block text-[11px] text-muted-foreground">{p.label}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Saved on this device" right={<Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={ed.saveTemplate}><Save className="h-3.5 w-3.5 mr-1" /> Save this one</Button>}>
        {ed.templates.length === 0 ? <p className="text-xs text-muted-foreground">Save a design as a template and it appears here, to start the next one from.</p> : (
          <div className="grid grid-cols-2 gap-2">
            {ed.templates.map(t => (
              <div key={t.name} className="group relative space-y-1">
                <button type="button" onClick={() => ed.useTemplate(t)} className={cn('block w-full overflow-hidden rounded-md border bg-muted group-hover:ring-2 group-hover:ring-primary', aspect)}>
                  {thumbs[`t:${t.name}`] && <img src={thumbs[`t:${t.name}`]} alt="" className="h-full w-full object-cover" />}
                </button>
                <span className="flex items-center justify-between text-[11px] text-muted-foreground">{t.name}
                  <button type="button" title="Delete template" onClick={() => ed.dropTemplate(t.name)} className="hover:text-destructive"><Trash className="h-3 w-3" /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function ElementsPanel({ ed }: { ed: Editor }) {
  const { palette } = ed.p;
  const F = ed.F;
  const accent = palette.headline;
  const photoFor = ed.p.photos.find(p => p.id !== ed.doc.bg.photoId) ?? ed.p.photos[0];
  const cell = 'flex aspect-square items-center justify-center rounded-md border bg-muted/40 hover:border-primary hover:bg-muted';
  return (
    <div className="space-y-4">
      <Section title="Lines & arrows">
        <div className="grid grid-cols-4 gap-2">
          <button type="button" className={cell} title="Line" onClick={() => ed.add(newLineStyle('solid', accent, F))}><span className="w-8 border-t-2 border-current" /></button>
          <button type="button" className={cell} title="Dashed line" onClick={() => ed.add(newLineStyle('dash', accent, F))}><span className="w-8 border-t-2 border-dashed border-current" /></button>
          <button type="button" className={cell} title="Dotted line" onClick={() => ed.add(newLineStyle('dot', accent, F))}><span className="w-8 border-t-[3px] border-dotted border-current" /></button>
          <button type="button" className={cell} title="Arrow" onClick={() => ed.add(newShape('arrow', '#FFFFFF'))}><svg viewBox="0 0 40 40" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M30 8 Q 8 12 10 32" /><path d="M4 26 L10 32 L16 26" /></svg></button>
        </div>
      </Section>
      <Section title="Shapes">
        <div className="grid grid-cols-5 gap-2">
          <button type="button" className={cell} title="Box" onClick={() => ed.add({ ...newShape('rect', accent), fill: accent, stroke: 0 })}><span className="h-6 w-6 bg-current" /></button>
          <button type="button" className={cell} title="Rounded box" onClick={() => ed.add({ ...newShape('rect', accent), fill: accent, stroke: 0, radius: 48 })}><span className="h-6 w-6 rounded-md bg-current" /></button>
          <button type="button" className={cell} title="Circle" onClick={() => ed.add({ ...newShape('circle', accent), fill: accent, stroke: 0 })}><span className="h-6 w-6 rounded-full bg-current" /></button>
          <button type="button" className={cell} title="Ring" onClick={() => ed.add(newShape('circle', '#FFFFFF'))}><span className="h-6 w-6 rounded-full border-2 border-current" /></button>
          {SHAPE_PICKS.map(k => (
            <button key={k} type="button" className={cell} title={SHAPES[k].label} onClick={() => ed.add(newShapeOf(k, k === 'sparkle' ? '#FFFFFF' : accent, F))}><ShapeIcon path={SHAPES[k].path(40, 40)} size={26} /></button>
          ))}
        </div>
      </Section>
      <Section title="Frames">
        {!photoFor ? <p className="text-xs text-muted-foreground">Add a photo first; frames hold a photo cut to a shape.</p> : (
          <div className="grid grid-cols-5 gap-2">
            {MASK_PICKS.map(m => (
              <button key={m} type="button" className={cn(cell, 'text-muted-foreground')} title={`${SHAPES[m].label} frame`} onClick={() => ed.add(newFrame(m, photoFor.id, F))}>
                <ShapeIcon path={SHAPES[m].path(40, 40)} size={28} />
              </button>
            ))}
          </div>
        )}
      </Section>
      <Section title="Stickers">
        <div className="grid grid-cols-2 gap-2">
          {BADGES.map(b => <Button key={b.id} variant="outline" size="sm" className="justify-start" onClick={() => ed.add(b.make(accent, F))}><Shapes className="h-4 w-4 mr-1.5" /> {b.label}</Button>)}
          <Button variant="outline" size="sm" className="justify-start" onClick={() => ed.add(newLinkPill(ed.p.websiteLabel))}><Link2 className="h-4 w-4 mr-1.5" /> Link pill</Button>
        </div>
      </Section>
      <MarksSection ed={ed} />
    </div>
  );
}

function MarksSection({ ed }: { ed: Editor }) {
  const { palette } = ed.p;
  const ink = palette.dark ? '#FFFFFF' : '#111111';
  const { wordmark, t } = ed.assets.marks;
  if (!wordmark && !t) return null;
  return (
    <Section title="The shop’s marks">
      <div className="grid grid-cols-2 gap-2">
        {wordmark && <button type="button" className="flex h-16 items-center justify-center rounded-md border bg-neutral-800 p-3 hover:ring-2 hover:ring-primary" onClick={() => ed.add(ed.square ? newCornerMark('wordmark', ed.assets) : newWordmark(ink))}><img src={wordmark.src} alt="Wordmark" className="max-h-full max-w-full invert" /></button>}
        {t && <button type="button" className="flex h-16 items-center justify-center rounded-md border bg-neutral-800 p-3 hover:ring-2 hover:ring-primary" onClick={() => ed.add(ed.square ? newCornerMark('t', ed.assets) : newMonogram(ink))}><img src={t.src} alt="t mark" className="max-h-full max-w-full invert" /></button>}
      </div>
    </Section>
  );
}

export function TextPanel({ ed }: { ed: Editor }) {
  const colour = ed.p.palette.body;
  const F = ed.F;
  const bound = (b: Bind) => ed.view.layers.find(l => l.kind === 'text' && l.bind === b);
  const addField = (b: Bind, label: string) => {
    const have = bound(b);
    if (have) { ed.select(ed.withGroups([have.id])); return; }
    const sizes: Record<Bind, [number, FontKey]> = { headline: [180, 'condensed'], kicker: [54, 'regular'], weight: [92, 'light'], details: [40, 'regular'] };
    const [size, font] = sizes[b];
    ed.add({ ...newHeading(colour, F), id: `${b}-${Math.random().toString(36).slice(2, 8)}`, bind: b, text: '', size, font, name: label, fit: b === 'headline', width: F.w - 192 });
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <button type="button" onClick={() => ed.add(newHeading(ed.p.palette.headline, F))} className="w-full rounded-md border px-3 py-2 text-left hover:border-primary" style={faceStyle(ed, 'condensed', 30)}>Add a heading</button>
        <button type="button" onClick={() => ed.add(newSubheading(colour, F))} className="w-full rounded-md border px-3 py-2 text-left hover:border-primary" style={faceStyle(ed, 'bold', 18)}>Add a subheading</button>
        <button type="button" onClick={() => ed.add(newBody(colour, F))} className="w-full rounded-md border px-3 py-2 text-left hover:border-primary" style={faceStyle(ed, 'light', 13)}>Add a little bit of body text</button>
      </div>
      <Section title="The piece’s words">
        <p className="text-[11px] text-muted-foreground">These follow the form: change the headline or weight there and they change here.</p>
        <div className="grid grid-cols-2 gap-2">
          {([['headline', 'Headline'], ['kicker', 'Small line'], ['weight', 'Weight'], ['details', 'Details']] as [Bind, string][]).map(([b, label]) => (
            <Button key={b} variant="outline" size="sm" className="justify-start" onClick={() => addField(b, label)}>
              <Type className="h-3.5 w-3.5 mr-1.5" />{label}{bound(b) ? <span className="ml-auto text-[10px] text-muted-foreground">on it</span> : null}
            </Button>
          ))}
        </div>
      </Section>
      <Section title="Font combinations">
        <div className="grid grid-cols-2 gap-2">
          {TEXT_STYLES.map(s => (
            <button key={s.id} type="button" onClick={() => ed.add(s.make(s.id === 'sold' || s.id === 'dm' ? '#FFFFFF' : colour, F))}
              className="flex h-20 items-center justify-center overflow-hidden rounded-md border bg-neutral-800 px-2 text-center text-white hover:ring-2 hover:ring-primary">
              <span style={{ ...faceStyle(ed, s.preview.font, s.preview.font === 'script' ? 26 : 20), textTransform: s.preview.upper ? 'uppercase' : undefined }}>{s.preview.text}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function PhotosPanel({ ed }: { ed: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const F = ed.F;
  const [, rerender] = useState(0);
  return (
    <div className="space-y-4">
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) ed.uploadFiles(e.dataTransfer.files).then(() => rerender(n => n + 1)); }}
        className="rounded-lg border-2 border-dashed p-4 text-center space-y-2">
        <Button size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1.5" /> Upload an image</Button>
        <p className="text-[11px] text-muted-foreground">A logo, a certificate, a hand shot — PNG keeps its transparency. Or drop it here, or paste it (⌘V).</p>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" multiple hidden onChange={e => { if (e.target.files) ed.uploadFiles(e.target.files).then(() => rerender(n => n + 1)); e.target.value = ''; }} />
      </div>
      {sessionUploads.length > 0 && (
        <Section title="Uploaded">
          <div className="grid grid-cols-3 gap-2">
            {sessionUploads.map(src => (
              <button key={src.slice(-40)} type="button" className="aspect-square overflow-hidden rounded-md border bg-[conic-gradient(#ddd_25%,#fff_0_50%,#ddd_0_75%,#fff_0)] bg-[length:12px_12px] hover:ring-2 hover:ring-primary"
                onClick={() => { const img = uploadedImage(src); if (img) ed.add(newUploadLayer(src, img, F)); }}>
                <img src={src} alt="" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="The piece’s photos">
        {ed.p.photos.length === 0 ? <p className="text-xs text-muted-foreground">Add photos on the page first.</p> : (
          <div className="grid grid-cols-2 gap-2">
            {ed.p.photos.map(p => (
              <div key={p.id} className="space-y-1">
                <button type="button" onClick={() => ed.add(newImageLayer(p.id))} className="block aspect-square w-full overflow-hidden rounded-md border hover:ring-2 hover:ring-primary" title="Add on top">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                </button>
                <div className="flex gap-1">
                  <button type="button" className="flex-1 rounded border px-1 py-0.5 text-[10px] hover:bg-muted" onClick={() => ed.api.change(d => ({ ...d, bg: { ...d.bg, photoId: p.id } }))}>Background</button>
                  <button type="button" className="flex-1 rounded border px-1 py-0.5 text-[10px] hover:bg-muted" onClick={() => ed.add(newFrame('ellipse', p.id, F))}>In a frame</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function BrandPanel({ ed }: { ed: Editor }) {
  const F = ed.F;
  const colours = [...new Set([...PALETTES.flatMap(p => [p.headline, p.body]), ...SWATCHES].map(c => c.toUpperCase()))];
  /** A brand colour on whatever is selected, or behind everything when nothing is. */
  const paint = (c: string) => {
    if (!ed.selLayers.length) { ed.api.change(d => ({ ...d, bg: { ...d.bg, color: c } }), { key: 'bg:color' }); return; }
    ed.updateSel(l => l.kind === 'text' ? { ...l, color: c, autoColor: false }
      : l.kind === 'wordmark' ? { ...l, color: c, autoColor: false }
        : l.kind === 'image' ? { ...l, border: c }
          : (l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape') && l.fill ? { ...l, fill: c } : { ...l, color: c }, 'brand');
  };
  const fonts = Object.keys(FONT_LABEL) as FontKey[];
  // The designer's extra faces load when this list is seen, so the canvas can use them straight away.
  useEffect(() => { for (const f of fonts) document.fonts.load(fontCss(f, 40, ed.assets.fonts)).catch(() => undefined); }, [ed.assets.fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = ed.one?.kind === 'text' ? ed.one : null;
  return (
    <div className="space-y-4">
      <Section title="Brand colours">
        <p className="text-[11px] text-muted-foreground">{ed.selLayers.length ? 'Tap one to use it on what is selected.' : 'Tap one for the colour behind — or select something first.'}</p>
        <div className="flex flex-wrap gap-1.5">{colours.map(c => <button key={c} type="button" title={c} onClick={() => paint(c)} className="h-8 w-8 rounded-full border" style={{ background: c }} />)}</div>
      </Section>
      <Section title="Brand fonts">
        <p className="text-[11px] text-muted-foreground">{text ? 'Tap one to set the selected text in it.' : 'Tap one to add a line in it.'}</p>
        <div className="space-y-1">
          {fonts.map(f => (
            <button key={f} type="button" onClick={() => text ? ed.update(text.id, { font: f }) : ed.add(newInFont(f, ed.p.palette.body, F))}
              className={cn('flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left hover:border-primary', text?.font === f && 'border-primary')}>
              <span style={faceStyle(ed, f, f === 'script' ? 24 : 18)}>{FONT_LABEL[f].replace(/ \(.*\)$/, '')}</span>
              {text?.font === f && <span className="text-[10px] text-primary">in use</span>}
            </button>
          ))}
        </div>
      </Section>
      <MarksSection ed={ed} />
    </div>
  );
}

export function LayersPanel({ ed }: { ed: Editor }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = [...ed.view.layers].reverse(); // top first, as Canva lists them
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    ed.api.change(d => {
      const layers = d.layers.filter(l => l.id !== dragId);
      const moving = d.layers.find(l => l.id === dragId)!;
      const at = layers.findIndex(l => l.id === targetId);
      // Dropping on a row puts it just above that row (above = later in the stack).
      layers.splice(at + 1, 0, moving);
      return { ...d, layers };
    });
    setDragId(null);
  };
  const icon = (l: Layer) => l.kind === 'text' ? <Type className="h-3.5 w-3.5" /> : l.kind === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : l.kind === 'wordmark' ? <span className="text-[10px] font-bold">t</span> : <Shapes className="h-3.5 w-3.5" />;
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-xs text-muted-foreground">Nothing on the page yet — add text or elements from the rail.</p>}
      <p className="text-[11px] text-muted-foreground">Top of the list is on top. Drag to reorder; shift-tap to pick several; double-tap a name to rename.</p>
      <ul className="space-y-1">
        {list.map(l => {
          const on = ed.sel.includes(l.id);
          return (
            <li key={l.id} draggable onDragStart={() => setDragId(l.id)} onDragOver={e => e.preventDefault()} onDrop={() => drop(l.id)}
              onClick={e => ed.select(e.shiftKey ? (on ? ed.sel.filter(i => i !== l.id) : [...ed.sel, l.id]) : [l.id])}
              className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer', on ? 'border-primary bg-primary/5' : 'hover:bg-muted', dragId === l.id && 'opacity-50', l.group && 'ml-3')}>
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
              <span className="flex h-5 w-5 items-center justify-center text-muted-foreground">{icon(l)}</span>
              {renaming === l.id ? (
                <Input autoFocus defaultValue={ed.layerName(l)} className="h-6 text-xs" onClick={e => e.stopPropagation()}
                  onBlur={e => { ed.update(l.id, { name: e.target.value.trim() || undefined }); setRenaming(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }} />
              ) : (
                <span className={cn('flex-1 truncate', l.hidden && 'line-through opacity-50')} onDoubleClick={e => { e.stopPropagation(); setRenaming(l.id); }}>{ed.layerName(l)}</span>
              )}
              <button type="button" title={l.hidden ? 'Show' : 'Hide'} className="text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); ed.update(l.id, { hidden: !l.hidden }); }}>{l.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
              <button type="button" title={l.locked ? 'Unlock' : 'Lock'} className={cn('hover:text-foreground', l.locked ? 'text-foreground' : 'text-muted-foreground')} onClick={e => { e.stopPropagation(); ed.update(l.id, { locked: !l.locked }); }}>{l.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
            </li>
          );
        })}
      </ul>
      {ed.sel.length > 1 && (
        <Button size="sm" variant="outline" className="w-full" onClick={ed.grouped ? ed.ungroup : ed.group}>{ed.grouped ? <><Ungroup className="h-4 w-4 mr-1.5" /> Ungroup</> : <><Group className="h-4 w-4 mr-1.5" /> Group them</>}</Button>
      )}
    </div>
  );
}

export function PositionPanel({ ed }: { ed: Editor }) {
  if (!ed.selLayers.length) return <p className="text-sm text-muted-foreground">Select something to arrange it.</p>;
  const l = ed.one;
  const b = l ? ed.boxOf(l) : null;
  const numberBox = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{label}</span>
      <Input type="number" value={Math.round(value)} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} className="h-8 text-xs" />
    </label>
  );
  const widthOf = (x: Layer) => x.kind === 'text' ? x.width : x.kind === 'wordmark' ? x.width : x.kind === 'image' ? x.w : Math.abs(x.w);
  const setWidth = (x: Layer, v: number): Layer => x.kind === 'text' ? { ...x, width: v } : x.kind === 'wordmark' ? { ...x, width: v } : x.kind === 'image' ? { ...x, w: v, ...(x.h ? { h: Math.round(x.h * v / x.w) } : {}) } : { ...x, w: v };
  return (
    <div className="space-y-4">
      <Section title="Arrange">
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('forward')}><ArrowUp className="h-4 w-4 mr-1.5" /> Forward</Button>
          <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('backward')}><ArrowDown className="h-4 w-4 mr-1.5" /> Backward</Button>
          <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('front')}><ChevronsUp className="h-4 w-4 mr-1.5" /> To front</Button>
          <Button size="sm" variant="outline" className="h-8 justify-start text-xs" onClick={() => ed.reorder('back')}><ChevronsDown className="h-4 w-4 mr-1.5" /> To back</Button>
        </div>
      </Section>
      <Section title="Align"><AlignButtons ed={ed} /></Section>
      {l && b && (
        <Section title="Exactly">
          <div className="grid grid-cols-2 gap-2">
            {numberBox('X', b.x, v => ed.update(l.id, x => moveLayer(x, v - b.x, 0)))}
            {numberBox('Y', b.y, v => ed.update(l.id, x => moveLayer(x, 0, v - b.y)))}
            {numberBox(l.kind === 'text' ? 'Line width' : 'Width', widthOf(l), v => v > 4 && ed.update(l.id, x => setWidth(x, v)))}
            {(l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape' || (l.kind === 'image' && l.h))
              ? numberBox('Height', l.kind === 'image' ? l.h! : Math.abs((l as ShapeLayer).h), v => v > 4 && ed.update(l.id, { h: v } as Partial<Layer>))
              : numberBox('Height', b.h, () => undefined)}
            {numberBox('Turn °', l.rotate, v => ed.update(l.id, { rotate: Math.max(-180, Math.min(180, v)) }))}
            {l.kind === 'text' && numberBox('Size', l.size, v => v >= 8 && ed.update(l.id, { size: v } as Partial<Layer>))}
          </div>
          <p className="text-[11px] text-muted-foreground">In the {ed.square ? 'square’s 1080 × 1080' : 'story’s 1080 × 1920'} pixels.</p>
        </Section>
      )}
    </div>
  );
}

export function EffectsPanel({ ed, layer: l }: { ed: Editor; layer: TextLayer }) {
  const current = effectOf(l)?.kind ?? 'none';
  const tile = (kind: EffectKind | 'none'): React.CSSProperties => {
    const c = '#2a2a2a';
    switch (kind) {
      case 'shadow': return { color: c, textShadow: '3px 3px 4px rgba(0,0,0,.45)' };
      case 'lift': return { color: c, textShadow: '0 4px 8px rgba(0,0,0,.35)' };
      case 'hollow': return { color: 'transparent', WebkitTextStroke: `1.5px ${c}` };
      case 'outline': return { color: c, WebkitTextStroke: '1.5px #C9973F' };
      case 'splice': return { color: 'transparent', WebkitTextStroke: `1.5px ${c}`, textShadow: '3px 3px 0 #C9973F' };
      case 'echo': return { color: c, textShadow: '3px 3px 0 rgba(42,42,42,.5), 6px 6px 0 rgba(42,42,42,.25)' };
      case 'neon': return { color: '#fff', textShadow: '0 0 4px #ff5ec4, 0 0 10px #ff5ec4' };
      case 'glitch': return { color: c, textShadow: '-2px 0 #00E5FF, 2px 0 #FF2E88' };
      default: return { color: c };
    }
  };
  return (
    <div className="space-y-4">
      <Section title="Style">
        <div className="grid grid-cols-3 gap-2">
          {EFFECTS.map(e => (
            <button key={e.kind} type="button" onClick={() => ed.update(l.id, { effect: e.kind === 'none' ? null : effectDefaults(e.kind, l.color), shadow: false } as Partial<Layer>)} className="space-y-1 text-center">
              <span className={cn('flex h-16 items-center justify-center rounded-md border-2 bg-neutral-100 text-2xl font-bold', current === e.kind ? 'border-primary' : 'border-transparent hover:border-border', e.kind === 'neon' && 'bg-neutral-800')} style={tile(e.kind)}>Ag</span>
              <span className="block text-[11px] text-muted-foreground">{e.label}</span>
            </button>
          ))}
        </div>
        {effectOf(l) && <EffectControls ed={ed} l={l} />}
      </Section>
      <Section title="Shape">
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!l.curve} onCheckedChange={v => ed.update(l.id, { curve: v ? 40 : 0 } as Partial<Layer>)} /> Curve</label>
        {!!l.curve && <Row label="Curve"><Num value={l.curve} min={-100} max={100} onChange={v => ed.update(l.id, { curve: Math.abs(v) < 2 ? (v < 0 ? -2 : 2) : v } as Partial<Layer>, 'curve')} /></Row>}
        <p className="text-[11px] text-muted-foreground">Bent text runs on one line.</p>
      </Section>
      <Section title="Background">
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!l.box} onCheckedChange={v => ed.update(l.id, { box: v ? { color: '#FFFFFF', radius: 24, pad: 20 } : null } as Partial<Layer>)} /> A colour behind the words</label>
        {l.box && (<>
          <Row label="Colour"><ColourRow value={l.box.color} onChange={c => ed.update(l.id, x => ({ ...(x as TextLayer), box: { ...(x as TextLayer).box!, color: c } }), 'boxc')} extra={docColours(ed)} /></Row>
          <Row label="Roundness"><Num value={l.box.radius} min={0} max={120} onChange={v => ed.update(l.id, x => ({ ...(x as TextLayer), box: { ...(x as TextLayer).box!, radius: v } }), 'boxr')} /></Row>
          <Row label="Spread"><Num value={l.box.pad} min={0} max={120} onChange={v => ed.update(l.id, x => ({ ...(x as TextLayer), box: { ...(x as TextLayer).box!, pad: v } }), 'boxp')} /></Row>
        </>)}
      </Section>
    </div>
  );
}

export function PhotoEditPanel({ ed }: { ed: Editor }) {
  const l = ed.one?.kind === 'image' ? ed.one : null;
  if (l) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground">{l.src ? 'Your upload' : 'A photo on the design'} — filters change only this one.</p>
        <ImageControls ed={ed} l={l} />
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ed.update(l.id, { flipX: !l.flipX })}><FlipHorizontal2 className="h-3.5 w-3.5 mr-1" /> Flip</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ed.update(l.id, { flipY: !l.flipY })}><FlipVertical2 className="h-3.5 w-3.5 mr-1" /> Flip vertical</Button>
        </div>
      </div>
    );
  }
  const bg = ed.doc.bg;
  const photo = bg.photoId ? ed.assets.photos[bg.photoId] ?? null : null;
  if (!photo) return <p className="text-sm text-muted-foreground">There is no photo behind the design yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">The background photo{ed.square ? ' — the filter goes on every square' : ''}. Drag it on the page to move it; pinch or use Zoom in Background to crop.</p>
      <AdjustControls value={bg.adjust ?? NO_ADJUST} onChange={(a, key) => ed.api.change(d => ({ ...d, bg: { ...d.bg, adjust: isPlain(a) ? null : a } }), { key: key ? `bg:${key}` : undefined })} img={photo} />
    </div>
  );
}

// ── A phone's bottom bar and the sheets it opens ──────────────────────────
// Canva's app: with something selected, the bar along the bottom becomes that
// thing's tools; each opens a sheet over the lower part of the screen (the
// design shrinks to stay in view above it).

export function MobileToolbar({ ed }: { ed: Editor }) {
  const l = ed.one;
  const open = (p: SidePanel) => ed.setPanel(ed.panel === p ? null : p);
  const locked = ed.selLayers.every(x => x.locked);
  const Item = ({ icon, label, onClick, active, off }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; off?: boolean }) => (
    <button type="button" disabled={off} onClick={onClick}
      className={cn('flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 px-1.5 py-2 text-[10px] disabled:opacity-40', active ? 'text-primary' : 'text-foreground/80')}>
      {icon}<span className="whitespace-nowrap">{label}</span>
    </button>
  );
  const i = 'h-5 w-5';
  const tail = (<>
    <Item icon={<Move className={i} />} label="Position" active={ed.panel === 'position'} onClick={() => open('position')} />
    <Item icon={<Droplet className={i} />} label="Transparency" active={ed.panel === 'transparency'} onClick={() => open('transparency')} />
    <Item icon={<Copy className={i} />} label="Duplicate" onClick={() => ed.duplicate()} />
    {ed.p.sendTo && <Item icon={<ArrowRightLeft className={i} />} label={`To the ${ed.p.sendTo.name}`} onClick={() => ed.sendToOther()} />}
    <Item icon={locked ? <Unlock className={i} /> : <Lock className={i} />} label={locked ? 'Unlock' : 'Lock'} onClick={ed.toggleLock} />
    <Item icon={<Trash2 className={i} />} label="Delete" onClick={() => ed.remove()} off={locked} />
  </>);
  const more = <Item icon={<MoreHorizontal className={i} />} label="All settings" active={ed.panel === 'edit'} onClick={() => open('edit')} />;
  let items: React.ReactNode;
  if (!l) {
    items = (<>
      <Item icon={ed.grouped ? <Ungroup className={i} /> : <Group className={i} />} label={ed.grouped ? 'Ungroup' : 'Group'} onClick={ed.grouped ? ed.ungroup : ed.group} />
      <Item icon={<PaletteIcon className={i} />} label="Colour" active={ed.panel === 'colour'} onClick={() => open('colour')} />
      {tail}
    </>);
  } else if (l.kind === 'text') {
    items = (<>
      <Item icon={<Keyboard className={i} />} label="Type" onClick={() => ed.setEditing(l.id)} off={l.locked} />
      <Item icon={<Type className={i} />} label="Font" active={ed.panel === 'font'} onClick={() => open('font')} />
      <Item icon={<PaletteIcon className={i} />} label="Colour" active={ed.panel === 'colour'} onClick={() => open('colour')} />
      <Item icon={<Sparkles className={i} />} label="Effects" active={ed.panel === 'effects'} onClick={() => open('effects')} />
      {tail}{more}
    </>);
  } else if (l.kind === 'image') {
    items = (<>
      <Item icon={<Wand2 className={i} />} label="Filters" active={ed.panel === 'photo'} onClick={() => open('photo')} />
      <Item icon={<FrameIcon className={i} />} label="Frame" active={ed.panel === 'frame'} onClick={() => open('frame')} />
      <Item icon={<FlipHorizontal2 className={i} />} label="Flip" onClick={() => ed.update(l.id, { flipX: !l.flipX })} />
      {tail}{more}
    </>);
  } else {
    items = (<>
      <Item icon={<PaletteIcon className={i} />} label="Colour" active={ed.panel === 'colour'} onClick={() => open('colour')} />
      {l.kind !== 'wordmark' && <Item icon={<SlidersHorizontal className={i} />} label="Style" active={ed.panel === 'edit'} onClick={() => open('edit')} />}
      {tail}
    </>);
  }
  return (
    <div className="flex items-stretch">
      <button type="button" onClick={ed.clear} aria-label="Finished with this — deselect" title="Deselect" className="flex shrink-0 items-center justify-center border-r px-4 text-primary"><Check className="h-6 w-6" /></button>
      <div className="flex min-w-0 flex-1 overflow-x-auto">{items}</div>
    </div>
  );
}

/** Size, style and face — a phone's font sheet (and the designer's font panel). */
export function FontPanel({ ed, layer: l }: { ed: Editor; layer: TextLayer }) {
  const set = (patch: Partial<TextLayer>, key?: string) => ed.update(l.id, patch as Partial<Layer>, key);
  const bold = BOLD_OF[l.font], italic = ITALIC_OF[l.font];
  const fonts = Object.keys(FONT_LABEL) as FontKey[];
  useEffect(() => { for (const f of fonts) document.fonts.load(fontCss(f, 40, ed.assets.fonts)).catch(() => undefined); }, [ed.assets.fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d: number) => set({ size: Math.max(12, Math.min(800, Math.round(l.size + d * (l.size >= 100 ? 10 : 2)))) }, 'size');
  const T = ({ on, off, title, onClick, children }: { on?: boolean; off?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" title={title} aria-label={title} disabled={off} onClick={onClick}
      className={cn('flex h-10 flex-1 items-center justify-center rounded-md border disabled:opacity-30', on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>{children}</button>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => step(-1)} aria-label="Smaller"><Minus className="h-4 w-4" /></Button>
        <Slider value={[l.size]} min={12} max={400} step={1} onValueChange={([v]) => set({ size: v }, 'size')} className="flex-1" />
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => step(1)} aria-label="Bigger"><Plus className="h-4 w-4" /></Button>
        <span className="w-10 text-right text-sm tabular-nums">{Math.round(l.size)}</span>
      </div>
      <div className="flex gap-1.5">
        <T title="Bold" off={!bold} on={l.font === 'bold' || l.font === 'montserrat-bold'} onClick={() => bold && set({ font: bold })}><Bold className="h-4 w-4" /></T>
        <T title="Italic" off={!italic} on={l.font.endsWith('italic')} onClick={() => italic && set({ font: italic })}><Italic className="h-4 w-4" /></T>
        <T title="Underline" on={!!l.underline} onClick={() => set({ underline: !l.underline })}><Underline className="h-4 w-4" /></T>
        <T title="Capitals" on={l.upper} onClick={() => set({ upper: !l.upper })}><CaseUpper className="h-4 w-4" /></T>
        {(['left', 'center', 'right'] as const).map(a => (
          <T key={a} title={`Align ${a}`} on={l.align === a} onClick={() => ed.update(l.id, x => realign(x as TextLayer, a, ed.boxOf(x)))}>
            {a === 'left' ? <AlignLeft className="h-4 w-4" /> : a === 'center' ? <AlignCenter className="h-4 w-4" /> : <AlignRight className="h-4 w-4" />}
          </T>
        ))}
      </div>
      <div className="space-y-2">
        <Row label="Letters"><Num value={l.spacing} min={-0.05} max={0.5} step={0.01} onChange={v => set({ spacing: v }, 'spacing')} /></Row>
        <Row label="Lines"><Num value={l.lineHeight} min={0.7} max={2} step={0.05} onChange={v => set({ lineHeight: v }, 'lh')} /></Row>
        <Row label="Curve"><Num value={l.curve ?? 0} min={-100} max={100} onChange={v => set({ curve: Math.abs(v) < 2 ? 0 : v }, 'curve')} /></Row>
        <label className="flex items-center gap-2 text-xs"><Switch checked={l.fit} onCheckedChange={v => set({ fit: v })} /> Shrink to fit its width</label>
      </div>
      <div className="space-y-1">
        {fonts.map(f => (
          <button key={f} type="button" onClick={() => set({ font: f })}
            className={cn('flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left', l.font === f ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
            <span style={faceStyle(ed, f, f === 'script' ? 24 : 18)}>{FONT_LABEL[f].replace(/ \(.*\)$/, '')}</span>
            {l.font === f && <Check className="h-4 w-4 text-primary" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The colour of whatever is selected — the right colour for its kind (text, fill, border, mark). */
export function ColourPanel({ ed }: { ed: Editor }) {
  const doc = docColours(ed);
  const l = ed.one;
  const Big = ({ value, onChange }: { value: string; onChange: (c: string) => void }) => <ColourRow value={value} onChange={onChange} extra={doc} />;
  if (!ed.selLayers.length) return <p className="text-sm text-muted-foreground">Select something to colour it, or use Background for the colour behind.</p>;
  if (!l) {
    return (<Section title={`All ${ed.selLayers.length}`}><Big value="" onChange={c => ed.updateSel(x => x.kind === 'text' || x.kind === 'wordmark' ? { ...x, color: c, autoColor: false } : x.kind === 'image' ? { ...x, border: c } : (x.kind === 'rect' || x.kind === 'circle' || x.kind === 'shape') && x.fill ? { ...x, fill: c } : { ...x, color: c }, 'colour')} /></Section>);
  }
  const set = (patch: Partial<Layer>, key: string) => ed.update(l.id, patch, key);
  if (l.kind === 'text') {
    return (
      <div className="space-y-4">
        <Section title="Text"><label className="flex items-center gap-2 text-xs"><Switch checked={!!l.autoColor} onCheckedChange={v => set({ autoColor: v } as Partial<Layer>, 'auto')} /> Auto — white or dark by the photo</label>{!l.autoColor && <Big value={l.color} onChange={c => set({ color: c } as Partial<Layer>, 'color')} />}</Section>
        <Section title="Behind the words">
          <label className="flex items-center gap-2 text-xs"><Switch checked={!!l.box} onCheckedChange={v => set({ box: v ? { color: '#FFFFFF', radius: 24, pad: 20 } : null } as Partial<Layer>, 'box')} /> A colour behind them</label>
          {l.box && <Big value={l.box.color} onChange={c => ed.update(l.id, x => ({ ...(x as TextLayer), box: { ...(x as TextLayer).box!, color: c } }), 'boxc')} />}
        </Section>
      </div>
    );
  }
  if (l.kind === 'wordmark') {
    return (<Section title="Mark"><label className="flex items-center gap-2 text-xs"><Switch checked={l.autoColor} onCheckedChange={v => set({ autoColor: v } as Partial<Layer>, 'auto')} /> Auto — white or dark by the photo</label>{!l.autoColor && <Big value={l.color} onChange={c => set({ color: c } as Partial<Layer>, 'color')} />}</Section>);
  }
  if (l.kind === 'image') {
    return (<Section title="Border"><label className="flex items-center gap-2 text-xs"><Switch checked={!!l.border} onCheckedChange={v => set({ border: v ? '#FFFFFF' : null } as Partial<Layer>, 'border')} /> A border round it</label>{l.border && <Big value={l.border} onChange={c => set({ border: c } as Partial<Layer>, 'borderc')} />}</Section>);
  }
  const closed = l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape';
  return (
    <div className="space-y-4">
      {closed && (
        <Section title="Fill">
          <label className="flex items-center gap-2 text-xs"><Switch checked={!!l.fill} onCheckedChange={v => set({ fill: v ? '#FFFFFF' : null } as Partial<Layer>, 'filled')} /> Filled</label>
          {l.fill && <Big value={l.fill} onChange={c => set({ fill: c } as Partial<Layer>, 'fill')} />}
          {l.fill && <label className="flex items-center gap-2 text-xs"><Switch checked={!!l.fill2} onCheckedChange={v => set({ fill2: v ? '#C9973F' : null } as Partial<Layer>, 'grad')} /> Fade to a second colour</label>}
          {l.fill && l.fill2 && <Big value={l.fill2} onChange={c => set({ fill2: c } as Partial<Layer>, 'fill2')} />}
        </Section>
      )}
      <Section title={closed ? 'Border' : 'Colour'}><Big value={l.color} onChange={c => set({ color: c } as Partial<Layer>, 'color')} /></Section>
    </div>
  );
}

export function TransparencyPanel({ ed }: { ed: Editor }) {
  if (!ed.selLayers.length) return <p className="text-sm text-muted-foreground">Select something first.</p>;
  const v = Math.round((1 - (ed.selLayers[0]?.opacity ?? 1)) * 100);
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3"><Slider value={[v]} min={0} max={95} step={1} onValueChange={([x]) => ed.updateSel(l => ({ ...l, opacity: 1 - x / 100 }), 'op')} className="flex-1" /><span className="w-12 text-right text-sm tabular-nums">{v}%</span></div>
      <p className="text-[11px] text-muted-foreground">0% is solid; the higher, the more shows through.</p>
    </div>
  );
}

export function FramePanel({ ed, layer: l }: { ed: Editor; layer: ImageLayer }) {
  return (
    <div className="space-y-4">
      <Section title="Cut the photo to"><MaskPicker value={l.mask ?? null} onChange={m => ed.update(l.id, x => withMask(x as ImageLayer, m, ed))} /></Section>
      {l.h && (
        <Section title="What shows">
          <Row label="Across"><Num value={l.fx ?? 0.5} min={0} max={1} step={0.01} onChange={v => ed.update(l.id, { fx: v } as Partial<Layer>, 'fx')} /></Row>
          <Row label="Down"><Num value={l.fy ?? 0.5} min={0} max={1} step={0.01} onChange={v => ed.update(l.id, { fy: v } as Partial<Layer>, 'fy')} /></Row>
        </Section>
      )}
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1.5"><Switch checked={!!l.border} onCheckedChange={v => ed.update(l.id, { border: v ? '#FFFFFF' : null } as Partial<Layer>)} /> Border</label>
        <label className="flex items-center gap-1.5"><Switch checked={l.shadow} onCheckedChange={v => ed.update(l.id, { shadow: v } as Partial<Layer>)} /> Shadow</label>
      </div>
    </div>
  );
}
