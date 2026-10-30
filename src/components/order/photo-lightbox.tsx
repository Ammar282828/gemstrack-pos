"use client";

/**
 * Full-screen viewer for a piece's reference photos (owner, 2026-10-30: "I should be able to open the
 * reference images"). Arrows and ← → move between them, Esc or a tap outside closes, double-click (or a
 * double-tap) and the wheel zoom, a swipe sideways turns the page, "Save" downloads the picture and
 * "Share" hands it to the device's share sheet where there is one.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, Share2, X } from 'lucide-react';

async function asFile(src: string, name: string): Promise<File> {
  const blob = await (await fetch(src)).blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

export function PhotoLightbox({ photos, index, onIndex, onClose, title }: {
  photos: string[]; index: number; onIndex: (i: number) => void; onClose: () => void; title?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const last = photos.length - 1;
  const at = Math.min(Math.max(index, 0), last);
  const go = useCallback((d: number) => { setZoom(1); onIndex(Math.min(Math.max(at + d, 0), last)); }, [at, last, onIndex]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go, onClose]);

  if (typeof document === 'undefined' || !photos.length) return null;
  const src = photos[at];
  const name = `${(title || 'reference').replace(/[^\w-]+/g, '-')}-${at + 1}.jpg`;
  const share = async () => {
    try {
      const file = await asFile(src, name);
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: title || 'Reference photo' });
    } catch { /* cancelled */ }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/95 text-white" role="dialog" aria-modal="true" aria-label="Reference photos"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={e => {
        const s = touch.current; touch.current = null;
        if (!s || zoom > 1) return;
        const dx = e.changedTouches[0].clientX - s.x; const dy = e.changedTouches[0].clientY - s.y;
        if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}>
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="text-sm tabular-nums">{at + 1} / {photos.length}</span>
        <div className="flex items-center gap-1">
          {canShare && <button type="button" onClick={share} className="rounded-full p-2 hover:bg-white/15" aria-label="Share"><Share2 className="h-5 w-5" /></button>}
          <a href={src} download={name} className="rounded-full p-2 hover:bg-white/15" aria-label="Save"><Download className="h-5 w-5" /></a>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        onWheel={e => setZoom(z => Math.min(4, Math.max(1, z - e.deltaY / 400)))}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI */}
        <img src={src} alt={title ? `${title} ${at + 1}` : 'Reference'} draggable={false}
          onDoubleClick={() => setZoom(z => (z > 1 ? 1 : 2.5))}
          style={{ transform: `scale(${zoom})`, transition: 'transform 160ms ease' }}
          className="max-h-full max-w-full select-none object-contain" />
        {at > 0 && <button type="button" onClick={() => go(-1)} className="absolute left-2 rounded-full bg-black/50 p-2 hover:bg-black/70" aria-label="Previous"><ChevronLeft className="h-6 w-6" /></button>}
        {at < last && <button type="button" onClick={() => go(1)} className="absolute right-2 rounded-full bg-black/50 p-2 hover:bg-black/70" aria-label="Next"><ChevronRight className="h-6 w-6" /></button>}
      </div>
    </div>,
    document.body,
  );
}
