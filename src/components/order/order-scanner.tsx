"use client";

/**
 * Photograph a parchi, and get the order form filled in.
 *
 * It fills the form and stops. Nothing is created here — the draft appears beside the
 * photos it was read from, the names it could not pin are offered as a choice, and the
 * shopkeeper presses Create on the ordinary form afterwards.
 *
 * The photos stay on screen for exactly that reason. A figure read off handwriting is
 * worth checking against the handwriting, and the check is only free if both are in front
 * of you at once.
 *
 * A slip is often more than one photo — front and back, a second page, the piece itself
 * beside its parchi — and it often arrives on WhatsApp rather than across the counter, so
 * the camera roll is as good a source as the camera. Photos are sent together and read as
 * one order; adding one re-reads the set, because the second page changes what the first
 * page means.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  resolveDraft, reconcileSlip, exchangeValue, slipLinePrice, hasHisaab, TOLA_G,
  type NameGuess, type OrderDraft, type RawOrderDraft,
} from '@/lib/vision/order-draft';
import type { RankedName, RosterEntry } from '@/lib/voice/phonetics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Camera, Check, Images, Loader2, Plus, TriangleAlert, X } from 'lucide-react';
import { authedFetch } from '@/lib/voice/authed-fetch';

/**
 * Bigger than the sample-image limits elsewhere in the app, and deliberately so. Those
 * store a picture of a finished piece; this one has to survive somebody's biro. Below
 * about 1600px the digits on a hurried slip stop being legible at all.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
/** Mirrors the route's cap. Front, back, a second page, the piece — six is plenty. */
const MAX_PHOTOS = 6;

interface Photo { dataUri: string; base64: string }

async function downscale(file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
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

const money = (n: number) => Math.round(n).toLocaleString('en-PK');

export function OrderScanner({
  open, onOpenChange, onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The draft, and every photo it was read from, in the order they were sent. */
  onAccept: (draft: OrderDraft, photoDataUris: string[]) => void;
}) {
  const customers = useAppStore((s) => s.customers);
  const karigars = useAppStore((s) => s.karigars);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPhotos([]); setDraft(null); setError(null); };

  /** Read the whole set. Called with the full list, so a removed photo is really gone. */
  const scan = useCallback(async (set: Photo[]) => {
    if (set.length === 0) { setDraft(null); return; }
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const res = await authedFetch('/api/vision/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: set.map((p) => ({ data: p.base64, mimeType: 'image/jpeg' })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not read that photo.');

      const customerRoster: RosterEntry[] = customers.map((c) => ({ id: c.id, name: c.name, kind: 'customer' }));
      const karigarRoster: RosterEntry[] = karigars.map((k) => ({ id: k.id, name: k.name, kind: 'karigar' }));
      setDraft(resolveDraft(data as RawOrderDraft, customerRoster, karigarRoster));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo.');
    } finally {
      setBusy(false);
    }
  }, [customers, karigars]);

  const addFiles = useCallback(async (picked: File[]) => {
    if (picked.length === 0) return;
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) throw new Error(`At most ${MAX_PHOTOS} photos at a time.`);
      const fresh = await Promise.all(picked.slice(0, room).map(downscale));
      const next = [...photos, ...fresh];
      setPhotos(next);
      if (picked.length > room) setError(`Only the first ${room} of those were added — ${MAX_PHOTOS} photos at most.`);
      await scan(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo.');
    }
  }, [photos, scan]);

  const remove = (i: number) => {
    const next = photos.filter((_, j) => j !== i);
    setPhotos(next);
    void scan(next);
  };

  const pick = (which: 'karigar' | 'customer', person: RankedName | null) => {
    setDraft((d) => (d ? { ...d, [which]: d[which] ? { ...d[which]!, pinned: person } : null } : d));
  };

  const items = draft?.items ?? [];
  const check = useMemo(() => (draft ? reconcileSlip(draft) : null), [draft]);
  const exchange = useMemo(() => exchangeValue(draft?.exchange), [draft]);
  const hasFoot = Boolean(draft && (
    draft.advancePayment != null || draft.exchange || draft.discount != null
    || draft.subtotal != null || draft.balanceDue != null || draft.expectedDate || draft.notes
  ));

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Same file twice in a row must re-fire change, so clear the value.
    e.target.value = '';
    void addFiles(picked);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read an order off a photo</DialogTitle>
          <DialogDescription>
            A parchi, front and back, or a picture of the piece. Nothing is created — this
            fills the form in and you check it against the photos.
          </DialogDescription>
        </DialogHeader>

        {/* Two inputs on purpose. `capture` makes a phone open the camera and hide the
            roll, which is right for a slip on the counter and wrong for one that came in
            on WhatsApp. The gallery input has no capture and takes several at once. */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFiles} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />

        {photos.length === 0 && !busy && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 hover:bg-accent/50"
            >
              <Camera className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm">Take a photo</span>
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 hover:bg-accent/50"
            >
              <Images className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm">Upload photos</span>
              <span className="text-xs text-muted-foreground">Front and back, or a few pages, together</span>
            </button>
          </div>
        )}

        {busy && (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Reading {photos.length > 1 ? `${photos.length} photos` : 'it'}…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not read that</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {photos.length > 0 && !busy && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* The photos stay up: a figure read off handwriting is worth checking against them. */}
            <div className="space-y-2">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUri} alt={`Photo ${i + 1} of the slip`} className="w-full rounded-lg border" />
                  {photos.length > 1 && (
                    <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium">
                      {i + 1}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-2 top-2 h-7 w-7"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
                    <Camera className="mr-2 h-4 w-4" /> Take another
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
                    <Plus className="mr-2 h-4 w-4" /> Add from photos
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                The photos are read together as one order. The first one is kept on the order
                as its reference picture.
              </p>
            </div>

            {draft && (
            <div className="space-y-4">
              {draft.unreadable && (
                <Alert>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertTitle>Could not make this out</AlertTitle>
                  <AlertDescription>{draft.unreadable}</AlertDescription>
                </Alert>
              )}

              {check && check.warnings.length > 0 && (
                <Alert>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertTitle>The slip does not add up as read</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {check.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                    <p className="mt-2">Nothing has been corrected — check the figures against the photo, and fix them on the form.</p>
                  </AlertDescription>
                </Alert>
              )}

              <NamePick label="Karigar" guess={draft.karigar} onPick={(p) => pick('karigar', p)} />
              <NamePick label="Customer" guess={draft.customer} onPick={(p) => pick('customer', p)} />

              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pieces could be read off this. You can still start the order by hand.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {items.length} piece{items.length === 1 ? '' : 's'}
                  </div>
                  {items.map((it, i) => {
                    const computed = slipLinePrice(it);
                    const written = Number(it.lineTotal) > 0 ? Number(it.lineTotal) : null;
                    const off = check?.itemsOff.includes(i);
                    return (
                    <div key={i} className={`rounded-md border p-3 text-sm ${off ? 'border-destructive/60' : ''}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{it.description || 'Unnamed piece'}</span>
                        {written != null && (
                          <span className={`shrink-0 tabular-nums ${off ? 'text-destructive' : ''}`}>{money(written)}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {hasHisaab(it) ? (
                          <Badge variant="secondary" className="font-normal">hisaab on the slip</Badge>
                        ) : written != null && !(Number(it.weightG) > 0) ? (
                          <Badge variant="outline" className="font-normal">figure only — fixed price</Badge>
                        ) : null}
                        {it.itemCategory && <span>{it.itemCategory}</span>}
                        {it.metalType && it.metalType !== 'gold' && <span>{it.metalType}</span>}
                        {it.karat != null && <span>{it.karat}k</span>}
                        {it.weightG != null && (
                          <span>
                            {it.weightG} g
                            {it.weightWasTola && ` (${(it.weightG / TOLA_G).toFixed(3)} tola on the slip)`}
                          </span>
                        )}
                        {Number(it.ratePerGram) > 0 && (
                          <span>
                            @ {money(Number(it.ratePerGram))}/g
                            {it.rateWasPerTola && ` (${money(Number(it.ratePerGram) * TOLA_G)}/tola on the slip)`}
                          </span>
                        )}
                        {Number(it.wastagePercent) > 0 && <span>wastage {it.wastagePercent}%</span>}
                        {Number(it.makingCharges) > 0 && (
                          <span>making {money(Number(it.makingCharges))}{it.makingWasPerGram && ' (written per gram)'}</span>
                        )}
                        {Number(it.stoneCharges) > 0 && <span>stones {money(Number(it.stoneCharges))}</span>}
                        {it.size && <span>Size {it.size}</span>}
                        {it.photoIndex != null && photos.length > 1 && <span>photo {it.photoIndex}</span>}
                      </div>
                      {computed != null && written == null && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Rate × weight comes to {money(computed)} — no amount was written against it.
                        </div>
                      )}
                      {it.note && <div className="mt-1 text-xs text-muted-foreground">{it.note}</div>}
                    </div>
                    );
                  })}
                </div>
              )}

              {hasFoot && (
                <div className="space-y-1 rounded-md border p-3 text-sm">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Foot of the slip</div>
                  {Number(draft.subtotal) > 0 && <Row label="Pieces" value={money(Number(draft.subtotal))} />}
                  {Number(draft.discount) > 0 && <Row label="Discount" value={`− ${money(Number(draft.discount))}`} />}
                  {Number(draft.advancePayment) > 0 && <Row label="Advance (cash)" value={`− ${money(Number(draft.advancePayment))}`} />}
                  {draft.exchange && (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        Taken in exchange
                        <span className="block text-xs text-muted-foreground">
                          {[
                            draft.exchange.description,
                            Number(draft.exchange.karat) > 0 ? `${draft.exchange.karat}k` : null,
                            Number(draft.exchange.weightG) > 0
                              ? `${draft.exchange.weightG} g${draft.exchange.weightWasTola ? ' (tola on the slip)' : ''}`
                              : null,
                            Number(draft.exchange.ratePerGram) > 0 ? `@ ${money(Number(draft.exchange.ratePerGram))}/g` : null,
                            exchange.from === 'computed' ? 'weight × rate off the slip' : null,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className={`shrink-0 tabular-nums ${exchange.from === 'none' ? 'text-destructive' : ''}`}>
                        {exchange.from === 'none' ? 'no figure' : `− ${money(exchange.value)}`}
                      </span>
                    </div>
                  )}
                  {Number(draft.balanceDue) > 0 && (
                    <Row label="Balance written" value={money(Number(draft.balanceDue))} strong />
                  )}
                  {check?.balance != null && Number(draft.balanceDue) <= 0 && (
                    <Row label="Balance, as the figures read" value={money(check.balance)} strong />
                  )}
                  {draft.expectedDate && <Row label="Wanted by" value={draft.expectedDate} />}
                  {draft.notes && <div className="text-muted-foreground">{draft.notes}</div>}
                </div>
              )}

              {items.some(hasHisaab) && (
                <p className="text-xs text-muted-foreground">
                  The rate on the slip goes into the order&apos;s rate box, so the form prices these
                  pieces the way the slip did. Change the rate on the form and they move with it.
                </p>
              )}
            </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button
            disabled={!draft || busy || photos.length === 0}
            onClick={() => {
              if (!draft || photos.length === 0) return;
              onAccept(draft, photos.map((p) => p.dataUri));
              reset();
              onOpenChange(false);
            }}
          >
            <Check className="mr-2 h-4 w-4" /> Fill the form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'font-medium' : ''}`}>
      <span>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/**
 * A name read off a slip, offered rather than decided.
 *
 * A clear winner is shown pinned, and can still be changed. Anything short of that is a
 * list — putting an order on the wrong karigar sends gold out of the shop in the wrong
 * direction, and that is not a mistake worth saving somebody one tap.
 */
function NamePick({
  label, guess, onPick,
}: { label: string; guess: NameGuess | null; onPick: (p: RankedName | null) => void }) {
  if (!guess) return null;
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="truncate text-xs italic text-muted-foreground">read as “{guess.heard}”</span>
      </div>
      {guess.pinned ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm font-medium">{guess.pinned.name}</span>
          <Badge variant="secondary">matched</Badge>
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => onPick(null)}>
            Not them
          </Button>
        </div>
      ) : guess.candidates.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-muted-foreground">Which one?</p>
          {guess.candidates.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={() => onPick(c)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Nobody in the book sounds like that — pick them on the form.
        </p>
      )}
    </div>
  );
}
