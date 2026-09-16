/**
 * Which SKUs are real.
 *
 * A piece described at the counter for one bill gets a key so the cart can tell
 * its lines apart — NEW-MU2TCCJ0, BILL-MU2X1A-3 — but that key is not a stock
 * number and nobody will ever look it up. It was being printed on invoices and
 * shown on screen as if it were one.
 */

export const ONE_OFF_SKU_PREFIXES = ['NEW-', 'BILL-'] as const;

export function isOneOffSku(sku: string | null | undefined): boolean {
  return !!sku && ONE_OFF_SKU_PREFIXES.some(p => sku.startsWith(p));
}

/** The SKU worth showing a person, or nothing. */
export function stockSku(sku: string | null | undefined): string | undefined {
  return sku && !isOneOffSku(sku) ? sku : undefined;
}
