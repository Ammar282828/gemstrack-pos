/**
 * The key in a customer's invoice link (lib/share-token.ts), for an invoice from before keys existed: Send on
 * WhatsApp gives it one as the link goes out (invoice-viewer.tsx `openWhatsAppWithLink`). The browser picks its
 * key inside the tap, since window.open must run there, and writes the same field; the iPhone app asks the
 * server for it first (/api/app/write `giveInvoiceShareKey`), then opens WhatsApp with the link.
 *
 * A key once given is never changed: a link already sent keeps working. One read in a transaction, so two
 * phones asking at once both get the one key.
 */

import type { DbPort } from '@/lib/db-port';
import { isShareToken, newShareToken } from '@/lib/share-token';

export async function giveInvoiceShareKey(db: DbPort, invoiceId: string, make: () => string = newShareToken): Promise<{ shareToken: string; given: boolean } | null> {
  return db.runTransaction(async tx => {
    const inv = await tx.get<{ shareToken?: unknown }>('invoices', invoiceId);
    if (!inv) return null;
    if (isShareToken(inv.shareToken)) return { shareToken: inv.shareToken, given: false };
    const shareToken = make();
    tx.update('invoices', invoiceId, { shareToken });
    return { shareToken, given: true };
  });
}
