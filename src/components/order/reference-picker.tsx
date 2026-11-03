"use client";

/**
 * Print a piece's reference picture on the bill beside the logo (owner, 2026-11-03), and pick it from the
 * catalogue: only the piece's own category by default, a chip row to widen, a search box, a grid of lazy thumbnails.
 * Picking sets `referenceImage` and turns `printReference` on; a small preview with Remove.
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
import { pieceInCategory, pieceMatches, resolveCategoryId } from '@/lib/website/catalogue-category';

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
            <img src={image} alt="Reference" className="h-full w-full object-cover" loading="lazy" />
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
        onPick={p => { onChange({ referenceImage: p.image, printReference: true }); setOpen(false); }} />
    </div>
  );
}

function CataloguePickerDialog({ open, onOpenChange, category, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; category?: string; onPick: (p: CataloguePiece) => void;
}) {
  const own = resolveCategoryId(category);
  const [pieces, setPieces] = useState<CataloguePiece[] | null>(null);
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!open) return;
    setCat(own || ''); setQ(''); setShown(PAGE);
    let live = true;
    void loadCatalogue().then(p => { if (live) setPieces(p); });
    return () => { live = false; };
  }, [open, own]);
  useEffect(() => { setShown(PAGE); }, [cat, q]);

  const asPiece = (p: CataloguePiece) => ({ collection: p.category, id: p.id, name: p.title });
  const matching = useMemo(() => (pieces ?? []).filter(p => pieceInCategory(asPiece(p), cat) && pieceMatches(asPiece(p), q)), [pieces, cat, q]);
  // Chips for categories the catalogue has pieces in; the piece's own first.
  const chips = useMemo(() => {
    const have = staticCategories.filter(c => (pieces ?? []).some(p => pieceInCategory(asPiece(p), c.id)));
    return [...have.filter(c => c.id === own), ...have.filter(c => c.id !== own)];
  }, [pieces, own]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Pick a reference photo</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Search by name or number" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip active={!cat} onClick={() => setCat('')}>All</Chip>
          {chips.map(c => <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.title}</Chip>)}
        </div>
        <div className="max-h-[55vh] overflow-auto">
          {pieces === null && <p className="text-sm text-muted-foreground py-6 text-center">Loading the catalogue…</p>}
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
