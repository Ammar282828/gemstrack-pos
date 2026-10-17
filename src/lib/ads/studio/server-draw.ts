/**
 * The board drawn on the server (2026-10-15, owner: "i want the server to draw so i can edit without opening
 * the board"). Until now only the page could lay a design out and draw it — the photo, the fonts and a canvas
 * lived in the browser — so an agent's design sat "not laid out" and `view_design` showed nothing new until
 * someone opened the board. Here the same code (templates.ts's applyAdTemplate, editor.ts's reflow and
 * renderDocTo) runs on @napi-rs/canvas, Skia as in Chrome, with the house's own faces from server-fonts/
 * (src/fonts cut to fixed weights: this canvas does not move a variable font's weight axis).
 *
 * The renderer asks the DOM for scratch canvases (`document.createElement('canvas')`); a stand-in document is
 * put on globalThis only for the synchronous layout-and-draw, and taken away before anything else can run, so
 * no other server code ever sees a `document`. Pictures are fetched first, at the page's own size (1600 px),
 * and designs are drawn one at a time: the server has 1 GiB (docs/features/ad-studio.md#out-of-memory).
 *
 * The page keeps working as before: it draws only designs whose drawing is stale, so a design the server
 * drew is not drawn again when the board is opened. Server-only.
 */

import fs from 'fs';
import path from 'path';
import { createCanvas, DOMMatrix, GlobalFonts, ImageData, loadImage, Path2D, type Image } from '@napi-rs/canvas';
import { STORE_MONOGRAM_SVG, STORE_SITE_MARK_SVG } from '@/lib/store-config';
import { reflow, renderDocTo, type Assets, type FontFamilies, type StoryDoc } from '@/lib/social/editor';
import { applyAdTemplate, blankAd, PHOTO } from './templates';
import { assetImage } from './assets';
import { assetOfRef, extraIds } from './board-pictures';
import { changeBoard, getBoard, putView, viewRevs } from './board';
import type { Board, BoardFrame } from './board-shape';

export const VIEW_PX = 720;     // the page's size for the agent's copy
const PHOTO_PX = 1600;          // and for the pictures it draws from

const FONT_DIR = path.join(process.cwd(), 'src/lib/ads/studio/server-fonts');
/** [file stem, family, weights]: the families renderDocTo names through FontFamilies below. */
const FACES: [string, string, number[]][] = [
  ['figtree-latin', 'Figtree', [300, 400, 700]],
  ['bodoni-moda-normal-latin', 'Bodoni Moda', [500]],
  ['bodoni-moda-italic-latin', 'Bodoni Moda', [400]],
  ['sofia-sans-extra-condensed-latin', 'Sofia Sans Extra Condensed', [800]],
  ['montserrat-latin', 'Montserrat', [400, 700]],
  ['cormorant-garamond-normal-latin', 'Cormorant Garamond', [500]],
  ['cormorant-garamond-italic-latin', 'Cormorant Garamond', [500]],
  ['playfair-display-latin', 'Playfair Display', [700]],
  ['great-vibes-latin', 'Great Vibes', [400]],
  ['cinzel-latin', 'Cinzel', [500]],
  ['cormorant-infant-latin', 'Cormorant Infant', [500]],
  ['italiana-latin', 'Italiana', [400]],
  ['jost-latin', 'Jost', [400]],
  ['tenor-sans-latin', 'Tenor Sans', [400]],
  ['dm-serif-display-latin', 'DM Serif Display', [400]],
  ['marcellus-latin', 'Marcellus', [400]],
  ['futura-lt-light', 'Taheri Stamp', [300]],
];
export const SERVER_FONTS: FontFamilies = {
  headline: '"Sofia Sans Extra Condensed"', body: 'Figtree', serif: '"Bodoni Moda"',
  extra: {
    cormorant: '"Cormorant Garamond"', playfair: '"Playfair Display"', script: '"Great Vibes"', montserrat: 'Montserrat', cinzel: 'Cinzel',
    cormorantInfant: '"Cormorant Infant"', italiana: 'Italiana', jost: 'Jost', tenor: '"Tenor Sans"', dmSerif: '"DM Serif Display"', marcellus: 'Marcellus',
  },
};

let fontsDone = false;
function ensureFonts() {
  if (fontsDone) return;
  for (const [stem, family, weights] of FACES) for (const w of weights) {
    const file = path.join(FONT_DIR, `${stem}-${w}.ttf`);
    if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, family);
    else console.warn(`[server-draw] no face ${file}`);
  }
  fontsDone = true;
}

/** The house's marks (the site mark and, where there is one, the t), read from public/ as the page loads them. */
let marksOnce: Promise<Assets['marks']> | null = null;
function houseMarks(): Promise<Assets['marks']> {
  const read = async (p: string): Promise<Image | null> => {
    if (!p || !p.startsWith('/')) return null;
    try { return await loadImage(fs.readFileSync(path.join(process.cwd(), 'public', p))); } catch { return null; }
  };
  return (marksOnce ??= (async () => {
    const [wordmark, t] = await Promise.all([read(STORE_SITE_MARK_SVG), STORE_MONOGRAM_SVG ? read(STORE_MONOGRAM_SVG) : Promise.resolve(null)]);
    return { ...(wordmark ? { wordmark } : {}), ...(t ? { t } : {}) } as unknown as Assets['marks'];
  })());
}

async function picture(id: string, alpha: boolean): Promise<Image> {
  const { data } = await assetImage(id, PHOTO_PX, { keepAlpha: alpha });
  return loadImage(data);
}

/** Everything the design draws: its photo, the library pictures laid on it, the marks and the faces. */
export async function assetsOf(f: Pick<BoardFrame, 'assetId' | 'doc'>): Promise<Assets> {
  ensureFonts();
  const ids = extraIds(f.doc);
  const [main, marks, ...extras] = await Promise.all([
    f.assetId ? picture(f.assetId, false) : Promise.resolve(null),
    houseMarks(),
    ...ids.map(id => picture(assetOfRef(id)!, true).catch(() => null)),
  ]);
  const photos: Record<string, Image> = {};
  if (main) photos[PHOTO] = main;
  ids.forEach((id, i) => { if (extras[i]) photos[id] = extras[i]!; });
  return { photos: photos as unknown as Assets['photos'], marks, fonts: SERVER_FONTS };
}

/**
 * Run the renderer's synchronous work with the browser globals it reaches for — a `document` that makes Skia
 * canvases, Path2D (masks and shapes), ImageData, DOMMatrix — all gone again before any await.
 */
const STAND_INS: Record<string, unknown> = {
  document: { createElement: (tag: string) => { if (tag !== 'canvas') throw new Error(`server-draw: no <${tag}>`); return createCanvas(1, 1); } },
  Path2D, ImageData, DOMMatrix,
};
function withCanvasDocument<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = Object.keys(STAND_INS).map(k => [k, k in g, g[k]] as const);
  for (const [k] of saved) if (k === 'document' || !(k in g)) g[k] = STAND_INS[k];
  try { return fn(); } finally { for (const [k, had, before] of saved) { if (had) g[k] = before; else delete g[k]; } }
}

/** A layout for a design that has none: what the page does for a new design (its template on a blank ad). */
export function layOut(f: Pick<BoardFrame, 'format' | 'template' | 'fields' | 'marked'>, a: Assets): StoryDoc {
  return withCanvasDocument(() => applyAdTemplate(blankAd(f.format), f.template, f.fields, a, { photoMarked: f.marked }));
}

/** The design as a JPEG `px` wide, drawn exactly as the page draws it. */
export function drawJpeg(doc: StoryDoc, f: Pick<BoardFrame, 'fields'>, a: Assets, px = VIEW_PX): Buffer {
  return withCanvasDocument(() => {
    const c = renderDocTo(reflow(doc, f.fields, a), f.fields, a, px) as unknown as import('@napi-rs/canvas').Canvas;
    return c.toBuffer('image/jpeg', 85);
  });
}

// One design at a time across the instance, whoever asks.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => { const run = queue.then(job, job); queue = run.catch(() => undefined); return run; };

export interface Settled { id: string; laidOut: boolean; drawn: boolean; rev: number; error?: string }

/**
 * Bring a board's designs up to date on the server: lay out every design without a layout (saved as the
 * page would save it), then draw every design whose drawing is missing or older than the design. `ids`
 * limits it to those designs. `by` is who the board records for a layout it saves.
 */
export function settleBoard(boardId: string, o: { ids?: string[]; by?: string; max?: number } = {}): Promise<Settled[]> {
  return serial(async () => {
    const out: Settled[] = [];
    let board: Board | null = await getBoard(boardId);
    if (!board) throw Object.assign(new Error('That board is gone.'), { status: 404 });
    const drawn = await viewRevs(boardId);
    const todo = board.frames.filter(f => (!o.ids || o.ids.includes(f.id)) && (!f.doc || drawn[f.id] !== f.rev)).slice(0, o.max ?? 60);
    for (const start of todo) {
      let f: BoardFrame = start;
      try {
        let a = await assetsOf(f);
        let laidOut = false;
        if (!f.doc) {
          const doc = layOut(f, a);
          ({ board } = await changeBoard(boardId, [{ op: 'put', id: f.id, patch: { doc } }], o.by ?? 'server'));
          f = board.frames.find(x => x.id === start.id)!;
          laidOut = true;
          if (extraIds(f.doc).length) a = await assetsOf(f);
        }
        const jpeg = drawJpeg(f.doc!, f, a);
        await putView(boardId, f.id, f.rev, jpeg);
        out.push({ id: f.id, laidOut, drawn: true, rev: f.rev });
      } catch (e) {
        out.push({ id: f.id, laidOut: false, drawn: false, rev: f.rev, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  });
}
