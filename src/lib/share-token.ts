/**
 * The key in a customer's invoice link (`/view-invoice/<id>?t=<key>`).
 *
 * Invoice numbers run in order (INV-000001, INV-000002 …), so a page that answered to the
 * number alone would hand anyone every customer's bill by counting. Each invoice carries a
 * random key instead, written with it (`Invoice.shareToken`), and the customer's page is
 * served only to a link that holds it (`/api/public/invoice/[id]`). 18 random bytes: not
 * guessable. Works in the browser and in Node.
 */

export function newShareToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isShareToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(t);

/** The link a customer is sent. */
export const invoiceShareUrl = (origin: string, id: string, token: string) =>
  `${origin.replace(/\/+$/, '')}/view-invoice/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;
