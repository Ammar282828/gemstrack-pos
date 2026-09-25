"use client";

/**
 * Photograph a written bill, and get the cart filled in.
 *
 * Same discipline as the parchi scanner: nothing is created, the photo stays on screen
 * next to what was read off it, and the shopkeeper generates the invoice afterwards.
 *
 * What is different is that a bill has two kinds of line, and this screen never lets
 * them look alike. A line that showed its working is labelled as priced from the rate;
 * a line that showed only a figure is labelled as taken from the bill. The second kind
 * will not move when the rate moves, and somebody billing from it a week later should
 * be able to see that at a glance rather than discover it.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import type { Product } from '@/lib/store';
import { blankCartItem } from '@/components/cart/edit-cart-item-dialog';
import {
  resolveBill, hasBreakdown, writtenTotal, billLineToProduct,
  type BillDraft, type NameGuess, type RawBillDraft,
} from '@/lib/vision/bill-draft';
import { TOLA_G } from '@/lib/vision/order-draft';
import { STORE_CONFIG } from '@/lib/store-config';
import type { RankedName, RosterEntry } from '@/lib/voice/phonetics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Check, Loader2, TriangleAlert } from 'lucide-react';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { readablePhoto } from '@/lib/photo-file';
import { PhotoPick } from '@/components/shared/photo-pick';

/** Handwriting needs the pixels — see the same note on the parchi scanner. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

async function downscale(picked: File): Promise<{ dataUri: string; base64: string }> {
  // A HEIC from a Mac's Photos library comes back a JPEG first (lib/photo-file.ts).
  const bitmap = await createImageBitmap(await readablePhoto(picked));
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read that photo.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUri = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { dataUri, base64: dataUri.split(',')[1] ?? '' };
}

const money = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 0 });

export interface ScannedBill {
  items: Product[];
  customerId?: string;
  /** The figure at the foot of the bill, kept so the cart can check its own sum. */
  writtenTotal: number | null;
  amountPaid: number | null;
}

export function BillScanner({
  open, onOpenChange, onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAccept: (bill: ScannedBill) => void;
}) {
  const customers = useAppStore((s) => s.customers);

  const [photo, setPhoto] = useState<string | null>(null);
  const [draft, setDraft] = useState<BillDraft | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setPhoto(null); setDraft(null); setSkipped(new Set()); setError(null); };

  const scan = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setDraft(null);
    setSkipped(new Set());
    try {
      const { dataUri, base64 } = await downscale(file);
      setPhoto(dataUri);

      const res = await authedFetch('/api/vision/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: 'image/jpeg' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not read that bill.');

      const roster: RosterEntry[] = customers.map((c) => ({ id: c.id, name: c.name, kind: 'customer' }));
      setDraft(resolveBill(data as RawBillDraft, roster));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that bill.');
    } finally {
      setBusy(false);
    }
  }, [customers]);

  const lines = draft?.lines ?? [];
  const kept = useMemo(() => lines.filter((_, i) => !skipped.has(i)), [lines, skipped]);
  const bare = kept.filter((l) => !hasBreakdown(l)).length;

  const toggle = (i: number) => setSkipped((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const pick = (person: RankedName | null) =>
    setDraft((d) => (d && d.customer ? { ...d, customer: { ...d.customer, pinned: person } } : d));

  const accept = () => {
    if (!draft) return;
    const blank = blankCartItem();
    const items = kept.map((line, i) => {
      const p = billLineToProduct(line, blank as unknown as Record<string, unknown>, STORE_CONFIG.defaultMetal) as unknown as Product;
      // blankCartItem() stamps one sku from the clock; a bill of six lines needs six.
      return { ...p, sku: `BILL-${Date.now().toString(36).toUpperCase()}-${i + 1}` };
    });
    onAccept({
      items,
      customerId: draft.customer?.pinned?.id,
      writtenTotal: Number(draft.grandTotal) > 0 ? Number(draft.grandTotal)
        : Number(draft.subtotal) > 0 ? Number(draft.subtotal) : null,
      amountPaid: Number(draft.amountPaid) > 0 ? Number(draft.amountPaid) : null,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read a written bill</DialogTitle>
          <DialogDescription>
            A handwritten bill or estimate, with or without a breakdown. The lines land in
            the cart for you to check — nothing is invoiced here.
          </DialogDescription>
        </DialogHeader>

        {/* The camera for a bill on the counter; the Photos library for one already saved
            or sent on WhatsApp. */}
        {!photo && !busy && (
          <PhotoPick onFiles={(files) => void scan(files[0])} takeLabel="Take a photo of the bill"
            pickLabel="From Photos" pickHint="A bill already on this phone or computer" />
        )}

        {busy && (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Reading it…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not read that</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {photo && draft && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="The bill that was read" className="w-full rounded-lg border" />
              <PhotoPick variant="buttons" onFiles={(files) => void scan(files[0])} takeLabel="Retake" pickLabel="From Photos" />
            </div>

            <div className="space-y-4">
              {draft.unreadable && (
                <Alert>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertTitle>Could not make this out</AlertTitle>
                  <AlertDescription>{draft.unreadable}</AlertDescription>
                </Alert>
              )}

              <CustomerPick guess={draft.customer} onPick={pick} />

              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No lines could be read off this. You can still bill it by hand.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {kept.length} of {lines.length} line{lines.length === 1 ? '' : 's'}
                  </div>
                  {lines.map((l, i) => {
                    const priced = hasBreakdown(l);
                    const off = skipped.has(i);
                    return (
                      <div key={i} className={`flex gap-3 rounded-md border p-3 text-sm ${off ? 'opacity-45' : ''}`}>
                        <Checkbox checked={!off} onCheckedChange={() => toggle(i)} className="mt-1" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium">{l.description || 'Unnamed line'}</span>
                            {writtenTotal(l) > 0 && (
                              <span className="shrink-0 tabular-nums">{money(writtenTotal(l))}</span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {priced ? (
                              <>
                                <Badge variant="secondary" className="font-normal">priced from the rate</Badge>
                                {l.metalType && <span>{l.metalType}</span>}
                                {l.karat != null && <span>{l.karat}k</span>}
                                <span>
                                  {l.weightG} g
                                  {l.weightWasTola && ` (${(Number(l.weightG) / TOLA_G).toFixed(2)} tola written)`}
                                </span>
                                {Number(l.makingCharges) > 0 && <span>making {money(Number(l.makingCharges))}</span>}
                              </>
                            ) : (
                              <>
                                <Badge variant="outline" className="font-normal">as written on the bill</Badge>
                                <span>no breakdown — the figure is used as it stands</span>
                              </>
                            )}
                          </div>
                          {l.note && <div className="mt-1 text-xs text-muted-foreground">{l.note}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {(draft.grandTotal != null || draft.discount != null || draft.amountPaid != null || draft.date) && (
                <div className="space-y-1 rounded-md border p-3 text-sm">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Foot of the bill</div>
                  {Number(draft.discount) > 0 && <div>Discount {money(Number(draft.discount))}</div>}
                  {Number(draft.grandTotal) > 0 && <div>Total {money(Number(draft.grandTotal))}</div>}
                  {Number(draft.amountPaid) > 0 && <div>Paid {money(Number(draft.amountPaid))}</div>}
                  {draft.date && <div className="text-muted-foreground">Dated {draft.date}</div>}
                </div>
              )}

              {bare > 0 && (
                <p className="text-xs text-muted-foreground">
                  {bare} line{bare === 1 ? '' : 's'} came without a weight, so {bare === 1 ? 'it is' : 'they are'} billed
                  at the written figure and will not move if you change the rate.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button disabled={!draft || busy || kept.length === 0} onClick={accept}>
            <Check className="mr-2 h-4 w-4" />
            Add {kept.length || ''} to the cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The customer, offered rather than decided — see the note in bill-draft.ts. */
function CustomerPick({ guess, onPick }: { guess: NameGuess | null; onPick: (p: RankedName | null) => void }) {
  if (!guess) return null;
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Customer</span>
        <span className="truncate text-xs italic text-muted-foreground">written as “{guess.heard}”</span>
      </div>
      {guess.pinned ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm font-medium">{guess.pinned.name}</span>
          <Badge variant="secondary">matched</Badge>
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => onPick(null)}>Not them</Button>
        </div>
      ) : guess.candidates.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-muted-foreground">Which one?</p>
          {guess.candidates.map((c) => (
            <Button key={c.id} size="sm" variant="outline" className="w-full justify-start" onClick={() => onPick(c)}>
              {c.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Nobody in the book sounds like that — pick them on the bill.
        </p>
      )}
    </div>
  );
}
