import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalizes a phone number to E.164 format with country code.
 * Handles Pakistani local format (e.g. 03001234567 → +923001234567).
 * Strips leading 0 when a country code is inferred.
 */
/**
 * iOS Safari ignores the `download` attribute on blob/data URLs, so jsPDF's .save()
 * silently does nothing. Pre-open a blank window before any async work, then redirect
 * it to the blob URL on iOS. On other platforms fall back to .save() as normal.
 *
 * Usage:
 *   const iOSWin = openPDFWindowForIOS();
 *   // ... build pdf async ...
 *   savePDF(doc, 'name.pdf', iOSWin);
 */
export function openPDFWindowForIOS(): Window | null {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS ? window.open('', '_blank') : null;
}

export function savePDF(
  doc: { save: (name: string) => void; output: (type: 'bloburl') => string },
  filename: string,
  iOSWin: Window | null
) {
  if (iOSWin) {
    iOSWin.location.href = doc.output('bloburl');
  } else {
    doc.save(filename);
  }
}

export function normalizePhoneNumber(phone: string | undefined | null): string {
  if (!phone) return '';
  const clean = phone.replace(/[\s\-().]/g, '');
  if (clean.startsWith('+')) return clean;
  // Pakistani local: 03xxxxxxxxx (11 digits)
  if (clean.startsWith('0') && clean.length >= 10) return `+92${clean.slice(1)}`;
  // Pakistani without leading zero: 923xxxxxxxxx
  if (clean.startsWith('92') && clean.length >= 12) return `+${clean}`;
  return phone;
}
