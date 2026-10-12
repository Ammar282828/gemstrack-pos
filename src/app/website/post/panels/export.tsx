'use client';

/**
 * The Export dialog (designer v2): PNG, JPG, WebP or PDF; 1×, 2× or 3×; a quality for the lossy ones; a see-through
 * background for PNG and WebP; one page or all of them (a zip, or one download each). PDF pages are sized from the
 * pixels at 300 dpi. The sums are in src/lib/social/export-plan.ts; this draws the dialog and does the saving.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Download, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderDocTo, type StoryDoc } from '@/lib/social/editor';
import {
  EXPORT_FORMATS, EXPORT_SCALES, canBeTransparent, exportSize, formatOf, pdfPageSize, planExport, zipStore,
  type ExportChoice, type ExportFormat, type ExportPlan,
} from '@/lib/social/export-plan';
import type { Editor } from '../story-editor';
import { Pills } from './kit';

/** A labelled row (a div, not a label: the format and page buttons are several controls, and a label would name only the first). */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span><span className="min-w-0 flex-1">{children}</span></div>
);

export interface ExportPage { key: string; label: string; ed: Editor; off?: boolean }

const KEY = 'designer_export';
const DEFAULTS: Omit<ExportChoice, 'pages'> = { format: 'png', scale: 2, quality: 92, transparent: false, bundle: 'zip' };
const readPrefs = (): Omit<ExportChoice, 'pages'> => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
};

/** The page drawn at `w` pixels; with `transparent`, without its colour, photo and shade (only the layers). */
export function renderPage(ed: Editor, w: number, transparent: boolean): HTMLCanvasElement {
  const view: StoryDoc = transparent
    ? { ...ed.view, bg: { ...ed.view.bg, photoId: null, color: 'rgba(0,0,0,0)', color2: null, fill: null, shade: null, gradient: 'none', dim: 0, adjust: null } }
    : ed.view;
  return renderDocTo(view, ed.fields, ed.assets, w, ed.p.lettered && !transparent ? { background: ed.p.lettered, hideBound: true } : {});
}

const toBlob = (c: HTMLCanvasElement, mime: string, q?: number) => new Promise<Blob | null>(res => c.toBlob(res, mime, q));

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Draw, encode and save what the plan says. Returns a note to show (for example that WebP fell back to PNG). */
export async function runExport(plan: ExportPlan, choice: ExportChoice, pages: ExportPage[], onStep?: (done: number, of: number) => void): Promise<string | null> {
  const fmt = formatOf(choice.format);
  let note: string | null = null;
  const files: { name: string; data: Uint8Array }[] = [];
  const pdfParts: { dataUrl: string; w: number; h: number }[] = [];
  let i = 0;
  for (const item of plan.items) {
    const page = pages.find(p => p.key === item.pageKey)!;
    const canvas = renderPage(page.ed, item.w, plan.transparent);
    if (choice.format === 'pdf') {
      // A PDF page cannot be see-through: flatten on white if the design has an empty corner (JPEG draws black otherwise).
      const flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      const fx = flat.getContext('2d')!;
      fx.fillStyle = '#ffffff'; fx.fillRect(0, 0, flat.width, flat.height); fx.drawImage(canvas, 0, 0);
      pdfParts.push({ dataUrl: flat.toDataURL('image/jpeg', 0.95), w: item.w, h: item.h });
    } else {
      let blob = await toBlob(canvas, fmt.mime, plan.quality);
      if (!blob) throw new Error('This browser could not make that picture. Try a smaller size.');
      if (blob.type && blob.type !== fmt.mime) {
        // Safari cannot encode WebP and hands back a PNG.
        note = `This browser can’t save ${fmt.label}; it made PNG files instead.`;
        item.name = item.name.replace(/\.[a-z0-9]+$/i, '.png');
      }
      if (plan.kind === 'zip') files.push({ name: item.name, data: new Uint8Array(await blob.arrayBuffer()) });
      else { save(blob, item.name); if (plan.kind === 'sequence' && i < plan.items.length - 1) await pause(450); }
    }
    onStep?.(++i, plan.items.length);
  }
  if (plan.kind === 'zip') save(new Blob([zipStore(files) as BlobPart], { type: 'application/zip' }), plan.files[0]);
  if (choice.format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const p of pdfParts) {
      const { mm, landscape } = pdfPageSize(p.w, p.h);
      if (!pdf) pdf = new jsPDF({ unit: 'mm', format: mm, orientation: landscape ? 'l' : 'p', compress: true });
      else pdf.addPage(mm, landscape ? 'l' : 'p');
      pdf.addImage(p.dataUrl, 'JPEG', 0, 0, mm[0], mm[1], undefined, 'FAST');
    }
    pdf?.save(plan.files[0]);
  }
  return note;
}

export function ExportDialog({ pages, currentKey, baseName, onClose }: { pages: ExportPage[]; currentKey: string; baseName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState(DEFAULTS);
  const live = pages.filter(p => !p.off);
  const [chosen, setChosen] = useState<string[]>([currentKey]);
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  useEffect(() => { setPrefs(readPrefs()); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [busy, onClose]);

  const choice: ExportChoice = { ...prefs, pages: chosen.filter(k => live.some(p => p.key === k)) };
  const plan = useMemo(() => planExport(baseName, live.map(p => ({ key: p.key, label: p.label, frame: p.ed.F })), choice), [baseName, live, choice.format, choice.scale, choice.quality, choice.transparent, choice.bundle, choice.pages.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<typeof prefs>) => setPrefs(p => { const n = { ...p, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const fmt = formatOf(prefs.format);
  const first = live.find(p => chosen.includes(p.key)) ?? live[0];
  const size = first ? exportSize(first.ed.F, prefs.scale) : null;

  const go = async () => {
    setBusy({ done: 0, of: plan.items.length });
    try {
      const note = await runExport(plan, choice, live, (done, of) => setBusy({ done, of }));
      toast({ title: plan.kind === 'sequence' ? `Saved ${plan.items.length} files` : 'Saved', description: note ?? plan.files.join(', ') });
      onClose();
    } catch (e) {
      toast({ title: 'Could not export', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      setBusy(null);
    }
  };

  return createPortal(
    <div className="glass-overlay fixed inset-0 z-[65] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onPointerDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-label="Export" className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-base font-semibold">Export</p>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} disabled={!!busy} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <Row label="Format">
            <div className="grid grid-cols-4 gap-1.5">
              {EXPORT_FORMATS.map(f => (
                <button key={f.id} type="button" onClick={() => set({ format: f.id as ExportFormat })}
                  className={cn('h-10 min-h-0 rounded-md border text-sm font-medium', prefs.format === f.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>{f.label}</button>
              ))}
            </div>
          </Row>
          <p className="-mt-2 pl-[92px] text-[11px] text-muted-foreground">{fmt.hint}.</p>
          <Row label="Size"><Pills value={String(prefs.scale)} options={EXPORT_SCALES.map(s => [String(s), `${s}×`])} onChange={s => set({ scale: Number(s) })} /></Row>
          {size && <p className="-mt-2 pl-[92px] text-[11px] tabular-nums text-muted-foreground">{size.w} × {size.h} px{prefs.format === 'pdf' ? ` · ${pdfPageSize(size.w, size.h).mm.join(' × ')} mm at 300 dpi` : ''}</p>}
          {fmt.lossy && (
            <Row label="Quality">
              <div className="flex items-center gap-2"><Slider value={[prefs.quality]} min={50} max={100} step={1} onValueChange={([q]) => set({ quality: q })} className="flex-1" /><span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{prefs.quality}</span></div>
            </Row>
          )}
          <label className={cn('flex items-center gap-2 text-sm', !canBeTransparent(prefs.format) && 'opacity-50')}>
            <Switch checked={prefs.transparent && canBeTransparent(prefs.format)} disabled={!canBeTransparent(prefs.format)} onCheckedChange={v => set({ transparent: v })} /> Transparent background
          </label>
          {prefs.transparent && canBeTransparent(prefs.format) && <p className="-mt-2 text-[11px] text-muted-foreground">Only the layers are saved; the colour, photo and shade behind them are left out.</p>}
          {!canBeTransparent(prefs.format) && <p className="-mt-2 text-[11px] text-muted-foreground">Only PNG and WebP can be see-through.</p>}

          {live.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pages</p>
              <div className="space-y-1.5">
                {live.map(p => (
                  <label key={p.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={chosen.includes(p.key)} onChange={e => setChosen(c => e.target.checked ? [...c, p.key] : c.filter(k => k !== p.key))} />
                    {p.label} <span className="text-xs text-muted-foreground">{p.ed.F.w} × {p.ed.F.h}</span>
                  </label>
                ))}
              </div>
              {prefs.format !== 'pdf' && chosen.length > 1 && <Row label="Files"><Pills value={prefs.bundle} options={[['zip', 'One zip'], ['each', 'One by one']]} onChange={b => set({ bundle: b as 'zip' | 'each' })} /></Row>}
              {prefs.format === 'pdf' && chosen.length > 1 && <p className="text-[11px] text-muted-foreground">One PDF with a page for each.</p>}
            </div>
          )}
          {plan.note && <p className="rounded-md bg-amber-500/10 p-2 text-[11px]">{plan.note}</p>}
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{plan.files.length === 1 ? plan.files[0] : plan.files.length ? `${plan.files.length} files` : 'Pick a page'}</p>
          <Button type="button" onClick={go} disabled={!!busy || plan.kind === 'none'} className="h-11 px-5 md:h-10">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {busy.done}/{busy.of}</> : <><Download className="mr-2 h-4 w-4" /> Export</>}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
