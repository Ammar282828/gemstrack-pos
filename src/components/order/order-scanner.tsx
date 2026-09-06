"use client";

/**
 * Photograph a parchi, and get the order form filled in.
 *
 * It fills the form and stops. Nothing is created here — the draft appears beside the
 * photo it was read from, the names it could not pin are offered as a choice, and the
 * shopkeeper presses Create on the ordinary form afterwards.
 *
 * The photo stays on screen for exactly that reason. A figure read off handwriting is
 * worth checking against the handwriting, and the check is only free if both are in front
 * of you at once.
 */

import React, { useCallback, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  resolveDraft, TOLA_G, type NameGuess, type OrderDraft, type RawOrderDraft,
} from '@/lib/vision/order-draft';
import type { RankedName, RosterEntry } from '@/lib/voice/phonetics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Camera, Check, Loader2, ScanLine, TriangleAlert } from 'lucide-react';
import { authedFetch } from '@/lib/voice/authed-fetch';

/**
 * Bigger than the sample-image limits elsewhere in the app, and deliberately so. Those
 * store a picture of a finished piece; this one has to survive somebody's biro. Below
 * about 1600px the digits on a hurried slip stop being legible at all.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

async function downscale(file: File): Promise<{ dataUri: string; base64: string }> {
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

export function OrderScanner({
  open, onOpenChange, onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAccept: (draft: OrderDraft, photoDataUri: string) => void;
}) {
  const customers = useAppStore((s) => s.customers);
  const karigars = useAppStore((s) => s.karigars);

  const [photo, setPhoto] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPhoto(null); setDraft(null); setError(null); };

  const scan = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const { dataUri, base64 } = await downscale(file);
      setPhoto(dataUri);

      const res = await authedFetch('/api/vision/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: 'image/jpeg' }),
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

  const pick = (which: 'karigar' | 'customer', person: RankedName | null) => {
    setDraft((d) => (d ? { ...d, [which]: d[which] ? { ...d[which]!, pinned: person } : null } : d));
  };

  const items = draft?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read an order off a photo</DialogTitle>
          <DialogDescription>
            A parchi, or a picture of the piece. Nothing is created — this fills the form in
            and you check it against the photo.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Same file twice in a row must re-fire change, so clear the value.
            e.target.value = '';
            if (f) void scan(f);
          }}
        />

        {!photo && !busy && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-3 rounded-lg border border-dashed p-10 hover:bg-accent/50"
          >
            <Camera className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm">Take a photo, or choose one</span>
          </button>
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
            {/* The photo stays up: a figure read off handwriting is worth checking against it. */}
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="The slip that was read" className="w-full rounded-lg border" />
              <Button variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
                <Camera className="mr-2 h-4 w-4" /> Another photo
              </Button>
            </div>

            <div className="space-y-4">
              {draft.unreadable && (
                <Alert>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertTitle>Could not make this out</AlertTitle>
                  <AlertDescription>{draft.unreadable}</AlertDescription>
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
                  {items.map((it, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{it.description || 'Unnamed piece'}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {it.itemCategory && <span>{it.itemCategory}</span>}
                        {it.karat != null && <span>{it.karat}k</span>}
                        {it.weightG != null && (
                          <span>
                            {it.weightG} g
                            {it.weightWasTola && ` (${(it.weightG / TOLA_G).toFixed(2)} tola on the slip)`}
                          </span>
                        )}
                        {it.size && <span>Size {it.size}</span>}
                        {it.makingCharges != null && <span>Making {it.makingCharges.toLocaleString()}</span>}
                      </div>
                      {it.note && <div className="mt-1 text-xs text-muted-foreground">{it.note}</div>}
                    </div>
                  ))}
                </div>
              )}

              {(draft.advancePayment != null || draft.expectedDate || draft.notes) && (
                <div className="space-y-1 rounded-md border p-3 text-sm">
                  {draft.advancePayment != null && <div>Advance: {draft.advancePayment.toLocaleString()}</div>}
                  {draft.expectedDate && <div>Wanted by: {draft.expectedDate}</div>}
                  {draft.notes && <div className="text-muted-foreground">{draft.notes}</div>}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button
            disabled={!draft || busy}
            onClick={() => {
              if (!draft || !photo) return;
              onAccept(draft, photo);
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
