"use client";

/**
 * "Take a photo" and "From Photos", side by side — the pair every photo action offers (the
 * owner, 2026-09-25: a parchi, a bill or a piece that came in on WhatsApp is already in the
 * Photos app).
 *
 * Two inputs on purpose: `capture` makes a phone open the camera and hide the library, which
 * is right for a slip on the counter and wrong for one that is already saved. The library
 * input has no capture, so an iPhone offers Photo Library, Take Photo and Choose File.
 * Files come back as picked; run them through readablePhoto (lib/photo-file.ts) before
 * drawing them, for the HEIC a Mac hands over.
 *
 * `paper` (a bill, a parchi, an order slip): in the iPhone app, "Take a photo" opens Apple's
 * document scanner instead of the camera. It finds the page's edges, squares the page and evens
 * the light, which the readers need and a photo of paper on a counter never is. The choice is made
 * before the tap: a file input opened after an asynchronous call has lost the tap, and iOS refuses it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Camera, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { appFeatures, scanPaperFromApp } from '@/lib/native-app';

export function PhotoPick({
  onFiles, multiple = false, variant = 'tiles', disabled = false,
  takeLabel = 'Take a photo', pickLabel = 'From Photos', pickHint, className, paper = false,
}: {
  /** Paper to be read: the app's document scanner instead of the camera, where there is one. */
  paper?: boolean;
  onFiles: (files: File[]) => void;
  /** Let the library pick several at once (the camera always takes one). */
  multiple?: boolean;
  /** Two big dashed tiles (an empty dialog), or two small buttons (another photo). */
  variant?: 'tiles' | 'buttons';
  disabled?: boolean;
  takeLabel?: string;
  pickLabel?: string;
  pickHint?: string;
  className?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [scanner, setScanner] = useState(false);
  useEffect(() => {
    if (!paper) return;
    let live = true;
    void appFeatures().then((f) => { if (live) setScanner(f.includes('scan')); });
    return () => { live = false; };
  }, [paper]);
  const take = () => {
    if (!scanner) { cameraRef.current?.click(); return; }
    // The scanner can return several pages; a single-photo reader takes the first.
    void scanPaperFromApp().then((files) => { if (files.length) onFiles(multiple ? files : files.slice(0, 1)); })
      .catch(() => cameraRef.current?.click());
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // The same file twice in a row must fire change again.
    e.target.value = '';
    if (picked.length) onFiles(picked);
  };

  return (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onChange} />
      <input ref={libraryRef} type="file" accept="image/*,.heic,.heif" multiple={multiple} className="hidden" onChange={onChange} />
      {variant === 'tiles' ? (
        <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
          <button type="button" disabled={disabled} onClick={take}
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 hover:bg-accent/50 disabled:opacity-50">
            <Camera className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm">{takeLabel}</span>
          </button>
          <button type="button" disabled={disabled} onClick={() => libraryRef.current?.click()}
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 hover:bg-accent/50 disabled:opacity-50">
            <Images className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm">{pickLabel}</span>
            {pickHint && <span className="text-xs text-muted-foreground">{pickHint}</span>}
          </button>
        </div>
      ) : (
        <div className={cn('grid grid-cols-2 gap-2', className)}>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={take}>
            <Camera className="mr-2 h-4 w-4" /> {takeLabel}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => libraryRef.current?.click()}>
            <Images className="mr-2 h-4 w-4" /> {pickLabel}
          </Button>
        </div>
      )}
    </>
  );
}
