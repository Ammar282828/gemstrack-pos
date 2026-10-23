'use client';

/**
 * A piece's photos in the Posts hub (the owner, 2026-10-23: "the hub should allow me to send multiple pics of a
 * product together with one description, 1 to as many as i want"). The card's own photo — as the site shows it,
 * with the weight, or its design — leads; more come from the website (the same page's other photographs first,
 * then any piece) or from this device, in the order they go, each movable and removable. The one caption goes
 * with them all: under the first photo on WhatsApp, once on Instagram's carousel (lib/social/album.ts).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, ChevronRight, Globe, ImagePlus, Loader2, Search, Smartphone, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { canvasToJpeg, loadImage } from '@/lib/social/story';
import { ALBUM_MAX, IG_CAROUSEL_MAX, photosLabel } from '@/lib/social/album';
import { readImageFile } from '@/app/design/image-file';
import type { Piece } from './piece-card';

/** One photo of the piece, in the order it goes. `main` is the card's own (its design or weight decide it). */
export type AlbumPhoto =
  | { id: 'main'; kind: 'main' }
  | { id: string; kind: 'site'; pieceId: string; thumb: string; label: string }
  | { id: string; kind: 'device'; blob: Blob; url: string; label: string };

/** A photograph as WhatsApp and Instagram take it: JPEG, at most `edge` px on its long side. */
export async function jpegOf(blob: Blob, edge = 2048): Promise<Blob> {
  const img = await loadImage(blob);
  const scale = Math.min(1, edge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  if (scale === 1 && blob.type === 'image/jpeg') return blob;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.9);
}

export interface PiecePhotos {
  list: AlbumPhoto[];
  count: number;
  move: (id: string, by: -1 | 1) => void;
  remove: (id: string) => void;
  addSite: (p: Piece) => void;
  addFiles: (files: File[]) => Promise<void>;
  adding: boolean;
  /** Every photo, in order, as it goes. */
  blobs: () => Promise<Blob[]>;
  /** The first photo: what a one-photo place (the Instagram story) takes. */
  first: () => Promise<Blob>;
  /** A picture of the first photo for the page; null when it is the card's own. */
  firstPreview: () => string | null;
}

export function usePiecePhotos(main: () => Promise<Blob>, sitePhoto: (id: string) => Promise<Blob>): PiecePhotos {
  const { toast } = useToast();
  const [list, setList] = useState<AlbumPhoto[]>([{ id: 'main', kind: 'main' }]);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);
  const urls = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  const full = (more: number) => {
    if (list.length + more <= ALBUM_MAX) return false;
    toast({ title: `${ALBUM_MAX} photos at most`, description: 'Take some out first — or send this piece twice.' });
    return true;
  };
  const move = (id: string, by: -1 | 1) => setList(l => {
    const i = l.findIndex(x => x.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const next = [...l];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (id: string) => setList(l => {
    if (l.length <= 1 || id === 'main') return l;
    const gone = l.find(x => x.id === id);
    if (gone?.kind === 'device') { URL.revokeObjectURL(gone.url); urls.current.delete(gone.url); }
    return l.filter(x => x.id !== id);
  });
  const addSite = (p: Piece) => {
    if (list.some(x => x.kind === 'site' && x.pieceId === p.id)) { setList(l => l.filter(x => !(x.kind === 'site' && x.pieceId === p.id))); return; }
    if (full(1)) return;
    setList(l => [...l, { id: `s${++seq.current}`, kind: 'site', pieceId: p.id, thumb: p.thumb, label: p.name }]);
  };
  const addFiles = async (files: File[]) => {
    const images = files.filter(f => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!images.length || full(images.length)) return;
    setAdding(true);
    const added: AlbumPhoto[] = [];
    const failed: string[] = [];
    for (const f of images) {
      try {
        const { blob } = await readImageFile(f);
        const jpeg = await jpegOf(blob);
        const url = URL.createObjectURL(jpeg);
        urls.current.add(url);
        added.push({ id: `d${++seq.current}`, kind: 'device', blob: jpeg, url, label: f.name });
      } catch { failed.push(f.name); }
    }
    setList(l => [...l, ...added]);
    setAdding(false);
    if (failed.length) toast({ title: `Couldn’t read ${photosLabel(failed.length)}`, description: failed.join(', '), variant: 'destructive' });
  };
  const blobOf = (x: AlbumPhoto): Promise<Blob> => (x.kind === 'main' ? main() : x.kind === 'site' ? sitePhoto(x.pieceId).then(b => jpegOf(b)) : Promise.resolve(x.blob));
  return {
    list, count: list.length, move, remove, addSite, addFiles, adding,
    blobs: async () => { const out: Blob[] = []; for (const x of list) out.push(await blobOf(x)); return out; },
    first: () => blobOf(list[0]),
    firstPreview: () => (list[0].kind === 'site' ? list[0].thumb : list[0].kind === 'device' ? list[0].url : null),
  };
}

/** The strip on the card: the photos in order, with ‹ › to move one, × to take it out, and + to add more. */
export function PiecePhotosStrip({ photos, piece, pieces, mainThumb, siteName, igPost, locked }: {
  photos: PiecePhotos;
  piece: Piece;
  /** Every piece on the website, for adding another's photograph. */
  pieces: Piece[];
  /** The card's own photo as it goes now (its design, its weight). */
  mainThumb: string;
  siteName: string;
  /** "Instagram post" is chosen in the hub: say when more than ten won't all go. */
  igPost: boolean;
  locked: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const n = photos.count;
  const picked = new Set(photos.list.flatMap(x => (x.kind === 'site' ? [x.pieceId] : [])));
  // The same page's other photographs first (taheri.shop lists each photograph of a piece on its own), then the rest.
  const samePage = useMemo(() => pieces.filter(x => x.id !== piece.id && x.url === piece.url), [pieces, piece.id, piece.url]);
  const others = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return pieces.filter(x => x.id !== piece.id && x.url !== piece.url
      && words.every(w => `${x.name} ${x.collection} ${x.facts.join(' ')}`.toLowerCase().includes(w))).slice(0, 60);
  }, [pieces, piece.id, piece.url, q]);

  const thumbOf = (x: AlbumPhoto) => (x.kind === 'main' ? mainThumb : x.kind === 'site' ? x.thumb : x.url);
  const tile = (x: Piece) => (
    <button key={x.id} type="button" onClick={() => photos.addSite(x)} title={x.name}
      className={cn('relative aspect-square overflow-hidden rounded-lg border', picked.has(x.id) ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/60')}>
      <img src={x.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
      {picked.has(x.id) && <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{photos.list.findIndex(p => p.kind === 'site' && p.pieceId === x.id) + 1}</span>}
    </button>
  );

  return (
    <div className="rounded-lg border px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Photos{n > 1 ? <span className="ml-1 font-normal text-muted-foreground">· {n}</span> : null}</span>
        <div className="flex items-center gap-1">
          <button type="button" disabled={locked || photos.adding} onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Globe className="h-3 w-3" /> From {siteName}
          </button>
          <button type="button" disabled={locked || photos.adding} onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
            {photos.adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Smartphone className="h-3 w-3" />} This device
          </button>
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden
            onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; photos.addFiles(fs); }} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {photos.list.map((x, i) => (
          <div key={x.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
            <img src={thumbOf(x)} alt="" className="h-full w-full object-cover" />
            <span className="absolute left-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[10px] leading-4 text-white">{i + 1}</span>
            {n > 1 && !locked && (<>
              {/* The card's own photo stays: its weight and design are made above. */}
              {x.kind !== 'main' && <button type="button" aria-label="Take this photo out" onClick={() => photos.remove(x.id)} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-3 w-3" /></button>}
              <span className="absolute inset-x-0 bottom-0 flex justify-between bg-black/40">
                <button type="button" aria-label="Earlier" disabled={i === 0} onClick={() => photos.move(x.id, -1)} className="flex h-5 w-6 items-center justify-center text-white disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Later" disabled={i === n - 1} onClick={() => photos.move(x.id, 1)} className="flex h-5 w-6 items-center justify-center text-white disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
              </span>
            </>)}
          </div>
        ))}
        {n < ALBUM_MAX && (
          <button type="button" disabled={locked || photos.adding} onClick={() => setPicking(true)} aria-label="Add photos"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ImagePlus className="h-5 w-5" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {n === 1 ? 'Add more photos of this piece to send them together, with the one caption.'
          : <>{photosLabel(n)}, one caption: on WhatsApp the caption goes under the first; on Instagram they go as one post. The story uses the first photo.</>}
      </p>
      {igPost && n > IG_CAROUSEL_MAX && (
        <p className="text-[11px] font-medium text-tone-owed-ink">Instagram takes {IG_CAROUSEL_MAX} photos in a post: the first {IG_CAROUSEL_MAX} go there, all {n} to WhatsApp.</p>
      )}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add photos</DialogTitle>
            <DialogDescription>Tap to add, tap again to take out. They go after the photos already there.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            <button type="button" disabled={photos.adding} onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/50 disabled:opacity-40">
              {photos.adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4 text-primary" />} From this device
            </button>
            {samePage.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">This piece’s other photos on {siteName}</p>
                <div className="grid grid-cols-4 gap-1.5">{samePage.map(tile)}</div>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium">From {siteName}</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — ruby, kara, jhumka…" className="h-10 pl-9" />
              </div>
              <div className="grid grid-cols-4 gap-1.5">{others.map(tile)}</div>
              {!others.length && <p className="text-xs text-muted-foreground">Nothing matches.</p>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
