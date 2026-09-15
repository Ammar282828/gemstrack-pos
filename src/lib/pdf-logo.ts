/**
 * The wordmark, ready for jsPDF, loaded once.
 *
 * Every printed document carries the logo, and four pages each fetched it, read it
 * into a data URL, and decoded it for its dimensions — three awaits, on every print,
 * inside the few seconds iOS gives a tap before navigator.share is refused. On a slow
 * connection that alone could push the share sheet past its window, and the person at
 * the counter got a fallback tab and no way to know why.
 *
 * So it is loaded once per session and memoised. The first print still pays; every
 * print after it awaits a settled promise. Pages that want the tap to be instant can
 * call warmPdfLogo() on mount and pay before anyone has pressed anything.
 *
 * A failed load is remembered as null rather than retried forever: a document without
 * a wordmark is a document, and drawDocHeader already draws the name in type when the
 * artwork is missing.
 */

import { STORE_LOGO_URL } from '@/lib/store-config';

export interface PdfLogo {
  dataUrl: string;
  /** What jsPDF's addImage needs to be told. */
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

let pending: Promise<PdfLogo | null> | null = null;

async function fetchLogo(): Promise<PdfLogo | null> {
  if (typeof window === 'undefined' || !STORE_LOGO_URL) return null;
  try {
    const url = STORE_LOGO_URL.startsWith('/')
      ? STORE_LOGO_URL
      : `/api/proxy-image?url=${encodeURIComponent(STORE_LOGO_URL)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const format: PdfLogo['format'] = /jpe?g/i.test(blob.type) ? 'JPEG' : 'PNG';

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = dataUrl;
    });

    return { dataUrl, format, width, height };
  } catch (e) {
    console.error('[pdf-logo] could not load the wordmark', e);
    return null;
  }
}

/** The logo, from cache after the first call. */
export function loadPdfLogo(): Promise<PdfLogo | null> {
  if (!pending) pending = fetchLogo();
  return pending;
}

/** Start the load now so the first print does not have to. Safe to call repeatedly. */
export function warmPdfLogo(): void {
  void loadPdfLogo();
}
