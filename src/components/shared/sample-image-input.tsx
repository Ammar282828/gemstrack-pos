"use client";

/**
 * Sample picture input — upload or camera, stored as a compressed data URI.
 *
 * Compression is not optional here: these images are written straight into the
 * order document, and Firestore caps a document at 1 MB. A raw phone photo
 * base64-encodes to several MB and makes the whole order fail to save, so every
 * image is downscaled and re-encoded until it comfortably fits.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Camera, X, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * Longest edge, in pixels, after downscaling.
 *
 * The photo renders at 96px on the order page and smaller on the bench, so
 * 1000px is already generous — it is there so a design detail survives being
 * zoomed into.
 */
const MAX_EDGE = 1000;
/**
 * A budget, not a document limit.
 *
 * This used to be 500KB, which is technically under Firestore's 1MB cap but
 * far too much to carry: the photo lives inside the order document, so every
 * page that reads orders — Orders, Invoices, Workshop, the dashboard,
 * analytics — downloads it. One 273KB photo was 56% of the entire orders
 * collection. Re-encoded at these settings it came to 54KB with no visible
 * loss.
 */
const MAX_BYTES = 120 * 1024;

async function compressToDataUri(source: HTMLImageElement | HTMLVideoElement, width: number, height: number): Promise<string> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(source, 0, 0, w, h);

  // Step the quality down until the encoded string fits.
  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    const uri = canvas.toDataURL('image/jpeg', quality);
    if (uri.length * 0.75 <= MAX_BYTES) return uri;
  }
  return canvas.toDataURL('image/jpeg', 0.35);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const SampleImageInput: React.FC<{
  value?: string;
  onChange: (dataUri: string) => void;
  onRemove: () => void;
  compact?: boolean;
}> = ({ value, onChange, onRemove, compact }) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Not an image', description: 'Pick a photo file.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const img = await loadImage(file);
      onChange(await compressToDataUri(img, img.naturalWidth, img.naturalHeight));
    } catch {
      toast({ title: 'Could not read that image', description: 'Try another photo.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (cameraOpen) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => {
          if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
          setStream(s);
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(() => {
          toast({ title: 'Camera unavailable', description: 'Check browser permissions.', variant: 'destructive' });
          setCameraOpen(false);
        });
    }
    return () => {
      cancelled = true;
      setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
    };
  }, [cameraOpen, toast]);

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try {
      onChange(await compressToDataUri(v, v.videoWidth, v.videoHeight));
      setCameraOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Sample" className={cn('rounded-md border object-contain bg-muted', compact ? 'h-24' : 'h-32')} loading="lazy" decoding="async" />
          <Button type="button" variant="destructive" size="icon"
            className="h-6 w-6 absolute -top-2 -right-2 rounded-full" onClick={onRemove}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setCameraOpen(true)}>
            <Camera className="mr-2 h-4 w-4" />Photo
          </Button>
          <Input type="file" ref={fileRef} onChange={handleFile} className="hidden" accept="image/*" />
        </div>
      )}

      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Take a photo</DialogTitle></DialogHeader>
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-md bg-black" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCameraOpen(false)}>Cancel</Button>
            <Button onClick={capture} disabled={busy || !stream}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}Capture
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
