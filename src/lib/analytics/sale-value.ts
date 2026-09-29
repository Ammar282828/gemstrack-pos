/**
 * What a sale was worth, for every revenue figure.
 *
 * An invoice's `grandTotal` is what is left to settle after the discount *and the exchange*
 * (subtotal − discount − exchange), so summing it counted a sale paid in old gold at only its cash
 * part — and one paid wholly in old gold at nothing (Taheri, 2026-09-29: five such sales, 1.47M,
 * and 5.1M of exchange across 18 invoices, missing from Analytics). Exchange gold is payment
 * like cash (the owner, 2026-09-25; Cash In already counts it so), so the sale is worth its total
 * with the exchange added back: subtotal − discount.
 *
 * An older invoice made from an order kept its exchange inside a lumped "Advance from Order"
 * payment and has no exchange field; its grandTotal already includes it, and nothing is added.
 */

import { exchangeTotal, invoiceExchanges } from '@/lib/exchange';
import type { Invoice } from '@/lib/store';

type SaleLike = Pick<Invoice, 'grandTotal'> & Parameters<typeof invoiceExchanges>[0];

export function invoiceSaleValue(inv: SaleLike | null | undefined): number {
  if (!inv) return 0;
  return (Number(inv.grandTotal) || 0) + exchangeTotal(invoiceExchanges(inv));
}
