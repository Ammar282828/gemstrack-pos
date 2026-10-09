/**
 * Where a Workshop job's making details are kept, and what a sold piece looks like once they change.
 *
 * A job on the Workshop board is one of three things (lib/workshop.ts): a piece of an order, a piece of a
 * sale (an invoice line handed to a karigar, or an online sale still to be made), or a job typed by hand
 * (karigar_jobs). Only the last has a karigar_jobs document; the board's ids for the other two
 * ("invoice:INV-1:0") are its own. The Details dialog once wrote every non-order job to karigar_jobs by
 * that id, which made a new, stray job and left the sold piece as it was.
 */

import type { InvoiceItem } from './store';

export type DetailsTarget =
  | { kind: 'order'; orderId: string; itemIndex: number }
  | { kind: 'invoice'; invoiceId: string; itemIndex: number }
  | { kind: 'manual'; jobId: string };

export function detailsTarget(job: {
  id: string; source: 'order' | 'manual' | 'invoice'; orderId?: string; invoiceId?: string; itemIndex?: number;
}): DetailsTarget | null {
  if (job.source === 'order' && job.orderId && job.itemIndex !== undefined) {
    return { kind: 'order', orderId: job.orderId, itemIndex: job.itemIndex };
  }
  if (job.source === 'invoice' && job.invoiceId && job.itemIndex !== undefined) {
    return { kind: 'invoice', invoiceId: job.invoiceId, itemIndex: job.itemIndex };
  }
  if (job.source === 'manual' && job.id.startsWith('job:')) {
    return { kind: 'manual', jobId: job.id.slice('job:'.length) };
  }
  return null;
}

export type InvoiceItemDetails = {
  name?: string; size?: string; stoneDetails?: string; diamondDetails?: string; adminNote?: string;
};

/**
 * The invoice's pieces with one piece's details changed. The name prints on the customer's invoice, so it
 * changes when given and is never cleared; a blank size or note is removed. Nothing priced (weight, rates,
 * totals) is touched: the bill stays the bill.
 */
export function withItemDetails(items: InvoiceItem[], itemIndex: number, patch: InvoiceItemDetails): InvoiceItem[] {
  if (!items[itemIndex]) throw new Error('Item not found');
  return items.map((item, i) => {
    if (i !== itemIndex) return item;
    const next: InvoiceItem = { ...item };
    const setOrClear = (key: 'size' | 'stoneDetails' | 'diamondDetails' | 'adminNote', value?: string) => {
      const v = (value ?? '').trim();
      if (v) next[key] = v;
      else delete next[key];
    };
    if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
    if ('size' in patch) setOrClear('size', patch.size);
    if ('stoneDetails' in patch) setOrClear('stoneDetails', patch.stoneDetails);
    if ('diamondDetails' in patch) setOrClear('diamondDetails', patch.diamondDetails);
    if ('adminNote' in patch) setOrClear('adminNote', patch.adminNote);
    return next;
  });
}
