const RESTORED_ORDER_NOTES_MARKER = '[RESTORED FROM ACTIVITY LOG';

type InvoiceLike = {
  subtotal?: number | null;
  discountAmount?: number | null;
  exchangeAmount1?: number | null;
  exchangeAmount2?: number | null;
  adjustmentsAmount?: number | null;
};

type OrderLike = {
  notes?: string | null;
};

export function isRestoredPlaceholderOrder(order: OrderLike | null | undefined): boolean {
  const notes = order?.notes;
  return typeof notes === 'string' && notes.includes(RESTORED_ORDER_NOTES_MARKER);
}

export function getInvoiceExchangeTotal(invoice: InvoiceLike | null | undefined): number {
  return (invoice?.exchangeAmount1 || 0) + (invoice?.exchangeAmount2 || 0);
}

/** What the extra beyond the pieces is called: a Shopify sale's is its delivery (shipping), any other's "Adjustments". */
export function adjustmentsLabel(invoice: { source?: string | null; deliveryCharge?: number | null } | null | undefined): string {
  return Number(invoice?.deliveryCharge) > 0 || String(invoice?.source || '').startsWith('shopify') ? 'Delivery' : 'Adjustments';
}

export function getInvoiceAdjustmentsAmount(invoice: InvoiceLike | null | undefined): number {
  return invoice?.adjustmentsAmount || 0;
}

export function getInvoiceExpectedGrandTotal(invoice: InvoiceLike | null | undefined): number {
  if (!invoice) return 0;
  return (invoice.subtotal || 0)
    - (invoice.discountAmount || 0)
    - getInvoiceExchangeTotal(invoice)
    + getInvoiceAdjustmentsAmount(invoice);
}
