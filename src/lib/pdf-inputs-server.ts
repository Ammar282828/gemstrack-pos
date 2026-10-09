/**
 * The pictures a document carries, made on the server (pdf-inputs.ts says why they are inputs):
 * the house's wordmark as the monthly report reads it (serverLogo), and the footer's codes drawn
 * here, to the same addresses the printing pages' <QRCode>s carry (lib/store-config.ts). Made once
 * per server: the addresses are the house's settings, not the record's.
 */

import QRCode from 'qrcode';
import { STORE_CONFIG, storeLinksUrl } from '@/lib/store-config';
import { serverLogo } from '@/lib/reports/monthly-server';
import type { PdfImages } from '@/lib/pdf-inputs';

/** As qrcode.react draws them on the pages: level L, no quiet zone, 128 px, black on white. */
const code = async (value: string): Promise<string | null> => {
  if (!value) return null;
  try {
    return await QRCode.toDataURL(value, { errorCorrectionLevel: 'L', margin: 0, width: 128, color: { dark: '#000000', light: '#ffffff' } });
  } catch (e) {
    // A document without a code is still a document (drawDocFooter goes without).
    console.warn('[pdf] could not draw a code for', value, e);
    return null;
  }
};

let pending: Promise<PdfImages> | null = null;

export function serverPdfImages(): Promise<PdfImages> {
  pending ??= (async () => {
    const [logo, linksQr, whatsappQr, instagramQr] = await Promise.all([
      serverLogo(),
      code(storeLinksUrl()),
      code(STORE_CONFIG.whatsappUrl),
      code(STORE_CONFIG.instagramUrl),
    ]);
    return { logo, linksQr, whatsappQr, instagramQr };
  })();
  return pending;
}
