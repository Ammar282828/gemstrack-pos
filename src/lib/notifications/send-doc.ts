/**
 * Draws an AlertDoc (doc.ts) as its PDF and sends it to each number: the one way a WhatsApp
 * alert or report reaches the shop's own phones. No caption — the file's name is the headline
 * (docFileName), and it is all the owner asked for: "pdfs only". Server-only.
 */

import { sendWhatsAppFile } from '@/lib/whatsapp';
import { serverLogo } from '@/lib/reports/monthly-server';
import { docFileName, type AlertDoc } from './doc';
import { renderAlertPdf } from './doc-pdf';

export async function docPdf(d: AlertDoc): Promise<{ file: Blob; fileName: string; bytes: Uint8Array }> {
  const pdf = renderAlertPdf(d, await serverLogo());
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  return { file: new Blob([bytes], { type: 'application/pdf' }), fileName: docFileName(d), bytes };
}

const tail = (phone: string) => `…${String(phone).replace(/\D/g, '').slice(-4)}`;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** One file, sent to every number in turn. Reaching some counts: a retry would repeat it to the others. */
export async function sendFileToAll(phones: string[], file: Blob, fileName: string): Promise<{ sent: number; failed: string[] }> {
  const failed: string[] = [];
  let sent = 0;
  for (const phone of phones) {
    try { await sendWhatsAppFile(phone, file, fileName); sent++; }
    catch (e) { failed.push(`${tail(phone)}: ${why(e)}`); }
  }
  return { sent, failed };
}

export async function sendDoc(d: AlertDoc, phones: string[]): Promise<{ sent: number; failed: string[]; fileName: string }> {
  const { file, fileName } = await docPdf(d);
  return { ...(await sendFileToAll(phones, file, fileName)), fileName };
}
