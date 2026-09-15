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
 * Getting a PDF off the page on iOS.
 *
 * Safari on iOS ignores the `download` attribute on blob URLs, so jsPDF's .save() does
 * nothing there. Two exits exist instead, and which one a tap gets is decided BEFORE any
 * async work, because both depend on the tap's user activation and that is the whole
 * difficulty:
 *
 *   share   navigator.share({ files }) — the native sheet: AirDrop, Print, WhatsApp,
 *           Files. What the counter is used to. Needs transient activation, which iOS
 *           grants for a few seconds after the tap and REVOKES the moment another
 *           activation-consuming call spends it.
 *
 *   window  a blank tab opened synchronously in the tap and later pointed at the PDF.
 *           Needs activation too, but only at the instant it opens, which is why it is
 *           opened first and filled last.
 *
 * The old version did both: opened the window, then tried to share, then used the
 * window if sharing failed. That worked until it did not — window.open is itself an
 * activation-consuming call, and once Safari began treating it as one, the share that
 * followed was refused every time, silently, and every print landed in the fallback tab
 * instead of the sheet. A belt-and-braces that spends the belt buying the braces.
 *
 * So the two are exclusive now. If the device can share files, no window is opened and
 * nothing touches the activation until navigator.share does. If it cannot, the window
 * is opened in the tap as before. Both functions ask the same question so they cannot
 * disagree about which exit a tap is on.
 *
 * Usage, unchanged:
 *   const iOSWin = openPDFWindowForIOS();   // synchronously, in the click handler
 *   // ... build pdf async, and keep it short — see pdf-logo.ts ...
 *   savePDF(doc, 'name.pdf', iOSWin);
 */

const isIOS = (): boolean =>
  typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

/** Can this device put a PDF on the native share sheet? Asked with a stand-in file. */
function iosCanShareFiles(): boolean {
  if (!isIOS() || typeof File === 'undefined' || !navigator.canShare) return false;
  try {
    const probe = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'probe.pdf', { type: 'application/pdf' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Returns a pre-opened window ONLY when the share sheet is not available. When it is,
 * returns null on purpose: opening a window here would spend the activation the share
 * needs. savePDF makes the same determination and takes the share path.
 */
export function openPDFWindowForIOS(): Window | null {
  if (!isIOS()) return null;
  if (iosCanShareFiles()) return null;
  return window.open('', '_blank');
}

export async function savePDF(
  doc: { save: (name: string) => void; output: (type: string) => string | Blob },
  filename: string,
  iOSWin: Window | null,
  shareData?: { title?: string; text?: string }
) {
  if (isIOS() && iosCanShareFiles()) {
    const blob = doc.output('blob') as Blob;
    const file = new File([blob], filename, { type: 'application/pdf' });
    try {
      await navigator.share({
        files: [file],
        title: shareData?.title ?? filename,
        ...(shareData?.text ? { text: shareData.text } : {}),
      });
      return;
    } catch (e) {
      // The person closed the sheet. Nothing to recover from.
      if ((e as Error)?.name === 'AbortError') return;
      // Anything else means the activation was gone by the time we asked — the PDF took
      // too long, or something spent it first. There is no window to fall back to and
      // window.open would be refused for the same reason, so hand the file to the
      // browser's own download path, which on iOS opens it in the viewer.
      console.warn('[savePDF] share refused; handing the file to the browser instead', e);
      doc.save(filename);
      return;
    }
  }

  if (iOSWin) {
    // No share sheet on this device: the tab opened in the tap gets the PDF.
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
    return;
  }

  doc.save(filename);
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
