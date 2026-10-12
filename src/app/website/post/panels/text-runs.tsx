'use client';

/**
 * Rich text (designer v2): pick words (tap them, or drag across them, or select on the canvas while typing) and style
 * just those: face, bold, italic, size, colour, gradient foil, capitals, underline. Under it, what applies to the
 * whole text: a gradient fill, bullets or numbers. Styles are stored as runs over the words as written
 * (TextLayer.runs), moved along by `shiftRuns` whenever the words are edited. Bent text ignores them.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bold, Italic, Underline, CaseUpper, Eraser } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BOLD_OF, FONT_KEYS, FONT_LABEL, ITALIC_OF, isCurved, setRunStyle, type FontKey, type TextLayer, type TextRun } from '@/lib/social/editor';
import type { Editor } from '../story-editor';
import { ColourRow, Num, Pills, Row, Section, Z, docColours, faceStyle, loadFaces } from './kit';
import { FOILS, GradientChip, GradientEditor, GradientToggle } from './gradient-editor';

type RunPatch = Partial<Omit<TextRun, 'from' | 'to'>>;
interface Tok { from: number; to: number; text: string; word: boolean }

/** The words and the gaps between them, with where each starts. */
export function tokenise(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/\S+|\s+/g)) out.push({ from: m.index!, to: m.index! + m[0].length, text: m[0], word: /\S/.test(m[0]) });
  return out;
}

const CLEAR: RunPatch = { font: undefined, color: undefined, size: undefined, upper: undefined, underline: undefined, gradient: undefined };

export function RichTextPanel({ ed, layer: l }: { ed: Editor; layer: TextLayer }) {
  const text = l.bind ? ed.fields[l.bind] : l.text;
  const len = text.length;
  const toks = useMemo(() => tokenise(text), [text]);
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: len });
  const anchor = useRef<number | null>(null);
  const [customGrad, setCustomGrad] = useState(false);

  // A selection made on the canvas while typing becomes the range here.
  const ts = ed.textSel;
  useEffect(() => { if (ts && ts.id === l.id && ts.to > ts.from) setRange({ from: ts.from, to: Math.min(ts.to, len) }); }, [ts?.id, ts?.from, ts?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  // A different layer starts with all of its words picked; edits that shorten the text keep the range inside it.
  useEffect(() => { setRange({ from: 0, to: len }); }, [l.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRange(r => (r.to > len || r.from > len ? { from: Math.min(r.from, len), to: Math.min(r.to, len) } : r)); }, [len]);
  useEffect(() => { loadFaces(ed); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const curved = isCurved(l);
  const eff = range.to > range.from ? range : { from: 0, to: len };
  const here = (l.runs ?? []).find(r => r.from <= eff.from && r.to > eff.from);
  const face = here?.font ?? l.font;
  const apply = (patch: RunPatch, key?: string) => {
    if (eff.to <= eff.from) return;
    ed.update(l.id, x => ({ ...(x as TextLayer), runs: setRunStyle((x as TextLayer).runs, eff.from, eff.to, patch, len) }), key);
  };
  const picked = (t: Tok) => t.word && t.from >= range.from && t.to <= range.to;
  const tokAt = (x: number, y: number): Tok | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-from]') as HTMLElement | null;
    return el ? toks.find(t => t.from === Number(el.dataset.from)) ?? null : null;
  };
  const extend = (t: Tok) => {
    const a = anchor.current;
    if (a === null) return;
    const aTok = toks.find(k => k.from === a);
    if (!aTok) return;
    setRange({ from: Math.min(aTok.from, t.from), to: Math.max(aTok.to, t.to) });
  };
  const boldOn = face === 'bold' || face === 'montserrat-bold';
  const italicOn = face.endsWith('italic');
  const bold = BOLD_OF[face], italic = ITALIC_OF[face];
  const T = ({ on, off, title, onClick, children }: { on?: boolean; off?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" title={title} aria-label={title} disabled={off} onClick={onClick}
      className={cn('flex h-10 flex-1 items-center justify-center rounded-md border disabled:opacity-30', on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>{children}</button>
  );
  const doc = docColours(ed);

  return (
    <div className="space-y-4" onMouseDown={e => { if (!(e.target as HTMLElement).closest('input,textarea,[role=slider],[role=combobox]')) e.preventDefault(); }}>
      {curved && (
        <p className="rounded-md bg-amber-500/10 p-2 text-[11px]">Bent text is drawn in one style. Set its Curve to 0 to style single words.</p>
      )}
      <Section title="Pick the words" right={<span className="flex gap-2 text-xs">
        <button type="button" className="text-primary" onClick={() => setRange({ from: 0, to: len })}>All</button>
        <button type="button" className="text-muted-foreground" onClick={() => setRange({ from: 0, to: 0 })}>None</button>
      </span>}>
        {len === 0 ? <p className="text-xs text-muted-foreground">Type some words first.</p> : (
          <div className="max-h-44 touch-none select-none overflow-y-auto rounded-md border bg-muted/30 p-2 text-base leading-9"
            onPointerMove={e => { if (anchor.current !== null) { const t = tokAt(e.clientX, e.clientY); if (t?.word) extend(t); } }}
            onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }}>
            {toks.map(t => t.word ? (
              <button key={t.from} type="button" data-from={t.from}
                onPointerDown={e => {
                  e.preventDefault();
                  if (e.shiftKey && range.to > range.from) { setRange({ from: Math.min(range.from, t.from), to: Math.max(range.to, t.to) }); anchor.current = null; return; }
                  anchor.current = t.from; setRange({ from: t.from, to: t.to });
                }}
                className={cn('mx-0.5 min-h-0 rounded px-1.5 py-0.5 leading-7', picked(t) ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>{t.text}</button>
            ) : t.text.includes('\n') ? <br key={t.from} /> : <span key={t.from}> </span>)}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Tap a word, or drag across several (shift-tap adds). {range.to > range.from ? `${text.slice(range.from, range.to).trim().split(/\s+/).length} picked.` : 'None picked: styles go on all of it.'}</p>
      </Section>

      <Section title="Style the picked words" right={<button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground" onClick={() => apply(CLEAR)}><Eraser className="h-3 w-3" /> Clear</button>}>
        <Row label="Face">
          <Select value={here?.font ?? '__base'} onValueChange={v => apply({ font: v === '__base' ? undefined : (v as FontKey) })} onOpenChange={o => o && loadFaces(ed)} recentsKey={false}>
            <SelectTrigger className="h-9 text-base md:h-8 md:text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className={Z}>
              <SelectItem value="__base">Same as the rest</SelectItem>
              {FONT_KEYS.map(f => <SelectItem key={f} value={f}><span style={faceStyle(ed, f, 15)}>{FONT_LABEL[f]}</span></SelectItem>)}
            </SelectContent>
          </Select>
        </Row>
        <div className="flex gap-1.5">
          <T title="Bold" off={!bold && !boldOn} on={boldOn} onClick={() => bold && apply({ font: bold === l.font ? undefined : bold })}><Bold className="h-4 w-4" /></T>
          <T title="Italic" off={!italic && !italicOn} on={italicOn} onClick={() => italic && apply({ font: italic === l.font ? undefined : italic })}><Italic className="h-4 w-4" /></T>
          <T title="Underline" on={!!here?.underline} onClick={() => apply({ underline: here?.underline ? undefined : true })}><Underline className="h-4 w-4" /></T>
          <T title="Capitals" on={!!here?.upper} onClick={() => apply({ upper: here?.upper ? undefined : true })}><CaseUpper className="h-4 w-4" /></T>
        </div>
        <Row label="Size ×"><Num value={here?.size ?? 1} min={0.4} max={3} step={0.05} onChange={v => apply({ size: Math.abs(v - 1) < 0.03 ? undefined : v }, 'run-size')} /></Row>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Colour</span>{here?.color && <button type="button" className="text-[11px] text-primary" onClick={() => apply({ color: undefined })}>Same as the rest</button>}</div>
          <ColourRow value={here?.color ?? l.color} onChange={c => apply({ color: c, gradient: undefined }, 'run-colour')} extra={doc} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Foil</span>{here?.gradient && <button type="button" className="text-[11px] text-primary" onClick={() => { apply({ gradient: undefined }); setCustomGrad(false); }}>Remove</button>}</div>
          <div className="flex flex-wrap gap-1.5">{FOILS.map(f => <GradientChip key={f.id} g={f.gradient} title={f.label} active={JSON.stringify(here?.gradient) === JSON.stringify(f.gradient)} onClick={() => apply({ gradient: f.gradient })} />)}
            <Button type="button" size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={() => setCustomGrad(c => !c)}>Custom</Button></div>
          {customGrad && here?.gradient && <GradientEditor value={here.gradient} onChange={(g, key) => apply({ gradient: g }, key ? `run-${key}` : undefined)} colours={doc} />}
          {customGrad && !here?.gradient && <p className="text-[11px] text-muted-foreground">Pick a foil first, then fine-tune it here.</p>}
        </div>
      </Section>

      <Section title="The whole text">
        <GradientToggle label="Gradient fill (gold foil text)" value={l.fillGradient} start={FOILS[0].gradient} colours={doc}
          onChange={(g, key) => ed.update(l.id, { fillGradient: g } as Partial<TextLayer>, key ? `fillg-${key}` : undefined)} />
        <Row label="List"><Pills value={l.list ?? 'none'} options={[['none', 'None'], ['bullet', '• Bullets'], ['number', '1. Numbers']]}
          onChange={v => ed.update(l.id, { list: v === 'none' ? null : (v as 'bullet' | 'number') } as Partial<TextLayer>)} /></Row>
        <p className="text-[11px] text-muted-foreground">A list puts a bullet or a number at every line break.</p>
      </Section>
    </div>
  );
}
