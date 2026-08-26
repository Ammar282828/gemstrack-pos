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

export async function savePDF(
  doc: { save: (name: string) => void; output: (type: string) => string | Blob },
  filename: string,
  iOSWin: Window | null,
  shareData?: { title?: string; text?: string }
) {
  if (iOSWin) {
    // Try Web Share API with file support first (iOS 15+, Android Chrome 86+).
    // This gives the native share sheet — user can pick WhatsApp, Print, Files, etc.
    // The PDF page size is preserved properly (fixes A4 whitespace issue when printing).
    try {
      const blob = doc.output('blob') as Blob;
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        iOSWin.close();
        await navigator.share({
          files: [file],
          title: shareData?.title ?? filename,
          ...(shareData?.text ? { text: shareData.text } : {}),
        });
        return;
      }
    } catch (e) {
      // AbortError = user dismissed share sheet — close window and stop
      if ((e as Error)?.name === 'AbortError') { iOSWin.close(); return; }
      console.warn('Web Share API failed, falling back to iframe:', e);
    }
    // Fallback: embed PDF in an iframe in the pre-opened window
    const blobUrl = doc.output('bloburl') as string;
    iOSWin.document.open();
    iOSWin.document.write(
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>' + filename + '</title>'
      + '<style>*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden}'
      + 'iframe{width:100%;height:100%;border:none;display:block;position:fixed;top:0;left:0}</style>'
      + '</head><body><iframe src="' + blobUrl + '"></iframe></body></html>'
    );
    iOSWin.document.close();
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

/**
 * Rows for work that is finished.
 *
 * Dimmed so a long list reads as "these are done", but deliberately not
 * disabled — the row still opens, and hover or keyboard focus brings it back
 * to full strength so it can be read properly without leaving the list.
 */
export const settledRowClass =
  'opacity-55 hover:opacity-100 focus-within:opacity-100 transition-opacity';

/**
 * Rows that touch Shopify.
 *
 * A tint plus a left edge, rather than colour alone — the row still has to be
 * findable if the green is hard to see. Deliberately faint: it marks where a
 * record came from, it is not a status.
 *
 * The two pages mean slightly different things by it. An invoice carries
 * `source: 'shopify'`, meaning the sale happened on the storefront. No order
 * has ever originated on Shopify; an order is marked when it has been mirrored
 * out as a draft order, which is the opposite direction.
 */
export const shopifyRowClass =
  // An inset shadow rather than a left border: shadcn's TableBody carries
  // `[&_tr:last-child]:border-0`, which zeroes every side, so the last row in
  // each section silently lost its edge.
  'bg-success/[0.07] hover:bg-success/[0.12] shadow-[inset_2px_0_0_0_hsl(var(--success))]';

/**
 * The same marker on a phone card.
 *
 * No left edge here. On a row among rows an edge is a useful marker; on a card
 * standing on its own it is just a green stripe down one side, and the card is
 * already carrying a Shopify badge two lines below it saying the same thing.
 * The tint alone is enough, and it is the part that survives a glance.
 */
export const shopifyCardClass = 'bg-success/[0.06]';
