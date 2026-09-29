'use client';

/**
 * What the Ad studio's sections share: the library's rows as the page gets them,
 * a picture that may need the owner's sign-in to fetch, the score badge, and the
 * one call every image fix makes.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssetAssessment, FixCode, Placement } from '@/lib/ads/studio/assessment';
import type { StudioAsset, DriveSummary } from '@/lib/ads/studio/assets';
import { authHeaders } from '../ads-kit';

export interface LibraryItem extends StudioAsset {
  assessment: AssetAssessment | null;
  assessedAt: string | null;
  usedInAds: boolean;
  adScore: number | null;
}

export interface LibraryResponse {
  placement: Placement;
  counts: { total: number; site: number; drive: number; assessed: number };
  collections: { name: string; count: number }[];
  drive: DriveSummary;
  siteError: string | null;
  total: number;
  items: LibraryItem[];
  unassessed?: string[];
}

/** The photo the maker and the fixes work from: the asset, and an edited copy when one was made. */
/** `asset` is null for a photo uploaded straight into the maker. */
export interface WorkPhoto {
  asset: LibraryItem | null; blob: Blob | null; note?: string;
  /** An AI edit that took the burned-in labels and marks off (clear labels, extend, new setting). */
  clean?: boolean;
}

export const imageUrl = (id: string, size: number) => `/api/ads/studio/image?id=${encodeURIComponent(id)}&size=${size}`;

/** A photograph from this server (which may ask for the owner's sign-in), as a blob. */
export async function fetchAsset(id: string, size: number): Promise<Blob> {
  const res = await fetch(imageUrl(id, size), { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
  return res.blob();
}

/**
 * A picture in the grid. Public addresses (the website's thumbnails) load as they are;
 * this server's (Drive photos) are fetched with the sign-in once the card scrolls near.
 */
export function AuthedImg({ src, alt, className, fit = 'cover' }: { src: string; alt: string; className?: string; fit?: 'cover' | 'contain' }) {
  const own = src.startsWith('/api/');
  const [url, setUrl] = useState<string | null>(own ? null : src);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!own) { setUrl(src); setFailed(false); return; }
    let alive = true, made: string | null = null;
    const el = box.current;
    const load = async () => {
      try {
        const res = await fetch(src, { headers: await authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        made = URL.createObjectURL(await res.blob());
        if (alive) setUrl(made); else URL.revokeObjectURL(made);
      } catch { if (alive) setFailed(true); }
    };
    if (!el || typeof IntersectionObserver === 'undefined') { load(); return () => { alive = false; if (made) URL.revokeObjectURL(made); }; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); if (made) URL.revokeObjectURL(made); };
  }, [src, own]);
  return (
    <div ref={box} className={cn('relative overflow-hidden bg-muted', className)}>
      {failed ? <div className="absolute inset-0 flex items-center justify-center text-muted-foreground"><ImageOff className="h-5 w-5" /></div>
        : url ? <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn('absolute inset-0 h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')} />
          : <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60"><Loader2 className="h-4 w-4 animate-spin" /></div>}
    </div>
  );
}

export const scoreTone = (n: number) => (n >= 80 ? 'bg-emerald-600 text-white' : n >= 65 ? 'bg-lime-600 text-white' : n >= 50 ? 'bg-amber-500 text-black' : 'bg-rose-600 text-white');
export const scoreWord = (n: number) => (n >= 85 ? 'Runs today' : n >= 70 ? 'Good after a small fix' : n >= 50 ? 'Needs real work' : 'Not for ads');

export function ScoreBadge({ n, className, title }: { n: number | null; className?: string; title?: string }) {
  if (n === null) return <span className={cn('rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground', className)}>Not assessed</span>;
  return <span title={title ?? scoreWord(n)} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', scoreTone(n), className)}>{Math.round(n)}</span>;
}

/** A 0–10 or 0–100 bar. */
export function Meter({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pctv = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{Math.round(value)}{max === 10 ? '/10' : ''}</span></div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn('h-full rounded-full', pctv >= 80 ? 'bg-emerald-600' : pctv >= 60 ? 'bg-lime-600' : pctv >= 45 ? 'bg-amber-500' : 'bg-rose-600')} style={{ width: `${pctv}%` }} /></div>
    </div>
  );
}

/** How each fix runs on the image AI route (the one Post a Piece and Edit a piece use). */
export const FIX_OPS: Record<Exclude<FixCode, 'crop-tighter'>, { op: string; params: Record<string, unknown>; secs: string }> = {
  'extend-portrait': { op: 'reframe', params: { aspect: '4:5', tidy: true }, secs: 'about a minute' },
  'extend-story': { op: 'reframe', params: { aspect: '9:16', tidy: true }, secs: 'about a minute' },
  'clear-labels': { op: 'enhance', params: { tidy: true }, secs: 'about a minute' },
  enhance: { op: 'enhance', params: { tidy: false }, secs: 'about a minute' },
  retouch: { op: 'retouch', params: {}, secs: 'about two minutes' },
  restage: { op: 'restage', params: { aspect: '4:5' }, secs: 'about a minute' },
};

export interface FixResult { blob: Blob; check: { samePiece: boolean; confidence: number; differences: string[] } | null }

/** Run one image op on a photo and get the new photo back. */
export async function runImageOp(photo: Blob, op: string, params: Record<string, unknown>): Promise<FixResult> {
  const form = new FormData();
  form.append('op', op);
  form.append('params', JSON.stringify(params));
  form.append('image', photo, 'photo.jpg');
  const res = await fetch('/api/website/post/ai', { method: 'POST', headers: await authHeaders(), body: form });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `The AI answered ${res.status}.`);
  const img = d.image as { data: string; mimeType: string } | undefined;
  if (!img?.data) throw new Error('The AI sent no image back.');
  const bin = atob(img.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: img.mimeType || 'image/jpeg' }), check: d.check ?? null };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const safeName = (s: string) => (s || 'taheri-ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'taheri-ad';
