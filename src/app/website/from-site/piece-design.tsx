'use client';

/**
 * From the website → Crop & design (the owner, 2026-09-27: "for post a piece from
 * the website, add an ability to crop the photo or redesign etc like the rest of
 * the space"). The chosen piece's photo in the square editor Edit a piece and
 * Post a Piece use: crop by drag or pinch, the house's layouts (the weight, the
 * mark, the name), filters, the full-screen designer. While a design is in use it
 * is the photo that goes — to the groups and the channel, and into the Instagram
 * story — always square, as WhatsApp only ever gets 1:1.
 *
 * taheri.shop's photos carry the house's marks already, so a design starts on the
 * photo as the site shows it with nothing added (or with the weight, when the page
 * was stamping it); the catalogue's starts from the photo before the catalogue
 * marked it, with the MINA mark put back, as Edit a piece does. Nothing is fetched
 * or drawn until the counter asks for it, and a new piece starts plain again.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Crop, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_BRAND, STORE_POST_METAL, STORE_SITE_MARK_INK } from '@/lib/store-config';
import { weightLabel } from '@/lib/social/caption';
import { PALETTES, canvasToJpeg, loadImage } from '@/lib/social/story';
import { applySquarePreset, emptySquare, reflow, renderDocTo, type Assets, type Bind, type Fields, type SquarePresetId, type StoryDoc } from '@/lib/social/editor';
import { showsWeight, siteDetailsLine, siteLayouts, siteStartLayout } from '@/lib/social/site-design';
import { SoloEditor, useStoryDoc } from '../post/story-editor';
import { FONTS, bodyFace, headlineFace } from '../post/fonts';
import { useSiteAssets } from '../post/site-assets';

export interface DesignPiece { id: string; name: string; url: string; collection: string; weightOnPhoto: boolean; photoSource: string | null; sourceMarked: boolean }

/** The id the photo goes under in the design. */
const PHOTO = 'site';
/** WhatsApp's squares, as Post a Piece sends them. */
const SEND_PX = 1600;
const MINA = STORE_BRAND === 'mina';
const blank = (): StoryDoc => ({ ...emptySquare(), bg: { ...emptySquare().bg, photoId: PHOTO } });
const draw = (d: StoryDoc, f: Fields, a: Assets, px: number, q: number) => canvasToJpeg(renderDocTo(reflow(d, f, a), f, a, px), q);

/**
 * The design's state for the page. `on` once there is a design to send; `jpeg()`
 * is it as it goes out, `preview` a small copy for the page to show.
 * `weight` and `onWeight` are the page's own weight box, which the design shares.
 */
export function usePieceDesign(piece: DesignPiece | null, o: {
  weight: string; onWeight: (w: string) => void; stamped: boolean; token: () => Promise<Record<string, string>>; sitePhoto: (id: string) => Promise<Blob>;
}) {
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<{ id: string; img: HTMLImageElement; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<SquarePresetId>('clean');
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const doc = useStoryDoc(blank());
  const { marks, ready: assetsReady } = useSiteAssets(active);
  const sent = useRef<{ sig: string; blob: Blob } | null>(null);

  const cur = photo && piece && photo.id === piece.id ? photo : null;
  const on = active && ready && !!cur;
  const wLabel = weightLabel({ weight: o.weight, weightEach: false });
  // The line under the name carries the weight only when nothing else on the photo does.
  const weightStamped = doc.doc.layers.some(l => l.kind === 'text' && l.bind === 'weight' && !l.hidden);
  const collection = piece?.collection ?? '';
  const fields: Fields = useMemo(() => ({
    kicker: collection, headline: name, weight: wLabel, details: siteDetailsLine(collection, STORE_POST_METAL, weightStamped ? '' : wLabel),
  }), [collection, name, wLabel, weightStamped]);
  const assets: Assets = useMemo(() => ({ photos: cur ? { [PHOTO]: cur.img } : {} as Assets['photos'], marks, fonts: FONTS, ...(STORE_SITE_MARK_INK ? { ink: STORE_SITE_MARK_INK } : {}) }), [cur, marks]);
  const sig = JSON.stringify([cur?.id, doc.doc, fields]);

  // A new piece starts on its plain photo.
  useEffect(() => {
    setActive(false); setOpen(false); setReady(false); setError(null);
    setName(piece?.name ?? '');
    sent.current = null;
  }, [piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The photo, when a design is first asked for: the catalogue's from before it was marked, anything else as the site shows it.
  useEffect(() => {
    if (!active || !piece || cur) return;
    let alive = true;
    (async () => {
      try {
        let blob: Blob;
        if (MINA && piece.photoSource) {
          const res = await fetch(`/api/website/site-pieces/image?id=${encodeURIComponent(piece.id)}&original=1&size=3000`, { headers: await o.token() });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
          blob = await res.blob();
        } else {
          blob = await o.sitePhoto(piece.id);
        }
        const url = URL.createObjectURL(blob);
        const img = await loadImage(url);
        if (!alive) { URL.revokeObjectURL(url); return; }
        setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.url); return { id: piece.id, img, url }; });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [active, piece?.id, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  // The design starts on its layout once the photo, the fonts and the marks are in.
  useEffect(() => {
    if (!active || ready || !assetsReady || !cur) return;
    doc.reset(applySquarePreset(blank(), layout, fields, assets));
    setReady(true);
  }, [active, ready, assetsReady, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // A small copy for the page (the photo at the top, the send confirmation), a moment after it stops changing.
  useEffect(() => {
    if (!on) { setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const b = await draw(doc.doc, fields, assets, 720, 0.85);
        if (alive) { const url = URL.createObjectURL(b); setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return url; }); }
      } catch { /* the editor shows the design anyway */ }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [on, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const urls = useRef({ photo: '', preview: '' });
  urls.current = { photo: photo?.url ?? '', preview: preview ?? '' };
  useEffect(() => () => { Object.values(urls.current).forEach(u => u && URL.revokeObjectURL(u)); }, []);

  return {
    on, active, open, ready, error, photo: cur, layout, name, doc, fields, assets, preview, wLabel,
    /** The weight shows on the design: its own stamp, or in the line under the name. */
    weightOn: !!wLabel && doc.doc.layers.some(l => l.kind === 'text' && !l.hidden && (l.bind === 'weight' || l.bind === 'details')),
    layouts: siteLayouts(STORE_BRAND, !!marks.t),
    /** Open the editor; the first time, on the layout this piece starts with. */
    edit: () => {
      if (!piece) return;
      if (!active) setLayout(siteStartLayout(STORE_BRAND, piece, o.stamped));
      if (error) { setError(null); setTries(n => n + 1); }
      setActive(true); setOpen(true);
    },
    fold: () => setOpen(false),
    /** Back to the photo as the website has it: the design is dropped. */
    plain: () => { setActive(false); setOpen(false); setReady(false); setError(null); setName(piece?.name ?? ''); sent.current = null; },
    retry: () => { setError(null); setTries(n => n + 1); },
    chooseLayout: (id: SquarePresetId) => { setLayout(id); doc.change(d => applySquarePreset(d, id, fields, assets)); },
    onField: (b: Bind, v: string) => { if (b === 'headline') setName(v); else if (b === 'weight') o.onWeight(v.replace(/[^\d.]/g, '')); },
    /** The design as it goes out: WhatsApp's square, drawn once per change. */
    jpeg: async (): Promise<Blob> => {
      if (sent.current?.sig === sig) return sent.current.blob;
      const blob = await draw(doc.doc, fields, assets, SEND_PX, 0.92);
      sent.current = { sig, blob };
      return blob;
    },
  };
}
export type PieceDesign = ReturnType<typeof usePieceDesign>;

/** The editor, in place of the photo at the top of the piece's card. */
export function PieceDesignPanel({ d, piece, siteName }: { d: PieceDesign; piece: DesignPiece; siteName: string }) {
  const note = MINA && piece.photoSource
    ? piece.sourceMarked ? 'This photo carries the house’s mark already — add nothing more.' : 'The photo from before the catalogue put the MINA mark on — the mark goes back top right, as on every catalogue photo.'
    : piece.weightOnPhoto ? 'This photo already shows its weight and logo — a stamp would show them twice.' : '';
  return (
    <div className="p-3 space-y-3 border-b">
      {/* The editor's fonts, loaded for the canvas. */}
      <span aria-hidden className={cn(headlineFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(bodyFace.className, 'sr-only')}>.</span>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Crop className="h-4 w-4" /> Crop &amp; design</p>
        <Button size="sm" className="h-8" onClick={d.fold}><Check className="h-4 w-4 mr-1" /> Done</Button>
      </div>
      <div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {d.layouts.map(x => (
            <button key={x.id} type="button" disabled={!d.ready} onClick={() => d.chooseLayout(x.id)}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap', d.layout === x.id ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>{x.label}</button>
          ))}
        </div>
        {note && <p className="text-[11px] text-muted-foreground mt-1">{note}</p>}
        {showsWeight(d.layout) && !d.wLabel && <p className="text-[11px] text-amber-600 mt-1">Type the weight (below) to put it on.</p>}
      </div>
      {d.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{d.error} <button type="button" className="text-primary ml-1" onClick={d.retry}>Try again</button></p>
      ) : (
        <SoloEditor side={{
          label: 'The photo', sub: 'Square · WhatsApp and the story',
          placeholder: d.ready ? undefined : (
            <div className="mx-auto flex aspect-square w-[300px] sm:w-[340px] max-w-full items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching the photo…
            </div>
          ),
          bottom: <p className="text-[11px] text-muted-foreground">Drag or pinch the photo to crop it; the corner of anything on it to size it.</p>,
          props: {
            api: d.doc, square: true, fields: d.fields, assets: d.assets,
            photos: d.photo ? [{ id: PHOTO, url: d.photo.url, label: 'The website’s photo' }] : [],
            palette: PALETTES[0], onPalette: () => undefined, lettered: null, weightOwnLine: true, websiteLabel: siteName,
            onField: d.onField,
            presets: d.layouts, onPreset: id => d.chooseLayout(id as SquarePresetId), previewPreset: id => applySquarePreset(d.doc.doc, id as SquarePresetId, d.fields, d.assets),
            fileName: piece.url.split('/').filter(Boolean).pop() || 'piece',
            photoNote: 'The website’s photo. Drag or pinch it to choose what shows.',
          },
        }} />
      )}
      <button type="button" onClick={d.plain} className="w-full text-center text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1">
        <RotateCcw className="h-3 w-3" /> Use the photo as it is
      </button>
    </div>
  );
}
