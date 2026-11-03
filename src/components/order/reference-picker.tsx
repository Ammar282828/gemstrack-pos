"use client";

/**
 * Print a piece's reference picture on the bill beside the logo (owner, 2026-11-03), and pick it from the
 * catalogue: only the piece's own category by default, a chip row to widen, a search box, a grid of lazy thumbnails.
 * Picking sets `referenceImage` and leaves `printReference` as it was: off until the person turns it on (owner, 2026-11-03: "do not print the photo from catalogue by default"); a small preview with Remove.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Chip } from '@/components/order/describe-field';
import { staticCategories } from '@/lib/categories';
import { loadCatalogue, type CataloguePiece } from '@/lib/describe-client';
import { pieceInCategory, resolveCategoryId } from '@/lib/website/catalogue-category';
import { buildFacets, catalogueMatches, matchesFacets, pieceStones, pieceType } from '@/lib/website/catalogue-facets';
import { ThumbGridSkeleton } from '@/components/shared/skeletons';

const PAGE = 60;

export function ReferencePicker({ category, referenceImage, printReference, onChange }: {
  category?: string;
  referenceImage?: string;
  printReference?: boolean;
  onChange: (next: { referenceImage: string; printReference: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const image = referenceImage || '';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="print-reference" className="font-normal text-sm cursor-pointer">Print reference photo on the bill</Label>
        <Switch id="print-reference" checked={!!printReference} onCheckedChange={v => onChange({ referenceImage: image, printReference: v })} />
      </div>
      <div className="flex items-center gap-3">
        {image && (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img decoding="async" src={image} alt="Reference" className="h-full w-full object-cover" loading="lazy" />
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <ImageIcon className="mr-2 h-4 w-4" /> Pick from catalogue
        </Button>
        {image && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ referenceImage: '', printReference: !!printReference })}>
            <X className="mr-1 h-4 w-4" /> Remove
          </Button>
        )}
      </div>
      {printReference && !image && <p className="text-xs text-muted-foreground">Without a catalogue picture, the piece’s own first reference photo is printed.</p>}
      <CataloguePickerDialog open={open} onOpenChange={setOpen} category={category}
        onPick={p => { onChange({ referenceImage: p.image, printReference: !!printReference }); setOpen(false); }} />
    </div>
  );
}

function CataloguePickerDialog({ open, onOpenChange, category, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; category?: string; onPick: (p: CataloguePiece) => void;
}) {
  const own = resolveCategoryId(category);
  // Every category once, for the category chips; the chosen category's own set when it is not "All".
  const [all, setAll] = useState<CataloguePiece[] | null>(null);
  const [pieces, setPieces] = useState<CataloguePiece[] | null>(null);
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [stones, setStones] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!open) return;
    setCat(own || ''); setQ(''); setTypes([]); setStones([]); setShown(PAGE);
    let live = true;
    void loadCatalogue().then(p => { if (live) setAll(p); });
    return () => { live = false; };
  }, [open, own]);
  // Asked again only when the category changes; type, stone and words filter what is loaded.
  useEffect(() => {
    if (!open) return;
    setPieces(null); setTypes([]); setStones([]);
    let live = true;
    void loadCatalogue(cat).then(p => { if (live) setPieces(p); });
    return () => { live = false; };
  }, [open, cat]);
  useEffect(() => { setShown(PAGE); }, [cat, q, types, stones]);

  // Older servers send no type or stones: derive them here from the same words.
  const faceted = useMemo(() => (pieces ?? []).map(p => {
    const w = { collection: p.category, id: p.id, name: p.title };
    return { ...p, type: p.type ?? pieceType(w), stones: p.stones ?? pieceStones(w) };
  }), [pieces]);
  const facets = useMemo(() => buildFacets(faceted.map(p => ({ type: p.type, stones: p.stones }))), [faceted]);
  const asPiece = (p: (typeof faceted)[number]) => ({ collection: p.category, id: p.id, name: p.title, type: p.type, stones: p.stones });
  const matching = useMemo(
    () => faceted.filter(p => pieceInCategory(asPiece(p), cat) && matchesFacets(asPiece(p), types, stones) && catalogueMatches(asPiece(p), q)),
    [faceted, cat, types, stones, q],
  );
  // Chips for categories the catalogue has pieces in; the piece's own first.
  const chips = useMemo(() => {
    const have = staticCategories.filter(c => (all ?? []).some(p => pieceInCategory({ collection: p.category, id: p.id, name: p.title }, c.id)));
    return [...have.filter(c => c.id === own), ...have.filter(c => c.id !== own)];
  }, [all, own]);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Pick a reference photo</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Search by name, stone, type or number" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip active={!cat} onClick={() => setCat('')}>All</Chip>
          {chips.map(c => <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.title}</Chip>)}
        </div>
        {pieces !== null && facets.types.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Type">
            <span className="shrink-0 text-xs text-muted-foreground">Type</span>
            {facets.types.map(f => <Chip key={f.id} active={types.includes(f.id)} onClick={() => toggle(types, setTypes, f.id)}>{f.label} <span className="tabular-nums opacity-70">{f.count}</span></Chip>)}
          </div>
        )}
        {pieces !== null && facets.stones.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Stone">
            <span className="shrink-0 text-xs text-muted-foreground">Stone</span>
            {facets.stones.map(f => <Chip key={f.id} active={stones.includes(f.id)} onClick={() => toggle(stones, setStones, f.id)}>{f.label} <span className="tabular-nums opacity-70">{f.count}</span></Chip>)}
          </div>
        )}
        <div className="max-h-[50vh] overflow-auto">
          {pieces === null && <ThumbGridSkeleton count={10} className="grid-cols-3 sm:grid-cols-4 md:grid-cols-5" />}
          {pieces !== null && matching.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No photos{cat ? ' in this category' : ''} match.</p>}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {matching.slice(0, shown).map(p => (
              <button key={p.id} type="button" onClick={() => onPick(p)} title={p.title}
                className="group relative aspect-square overflow-hidden rounded-lg border bg-muted focus:outline-none focus:ring-2 focus:ring-primary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={p.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-1 py-0.5 text-[10px] opacity-0 group-hover:opacity-100">{p.title}</span>
              </button>
            ))}
          </div>
          {matching.length > shown && (
            <div className="py-3 text-center"><Button type="button" variant="outline" size="sm" onClick={() => setShown(s => s + PAGE)}>Show more ({matching.length - shown})</Button></div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
