/**
 * The PDF drawers, loaded when someone presses Print, not with the page (docs/performance.md, 2026-11-03).
 *
 * jsPDF and the drawers are a few hundred KB the Orders, Invoices, Repairs and order pages parsed on every
 * visit. iOS only lets a window open straight from the tap, so each helper opens it FIRST (the same call the
 * drawers make) and hands it on; the drawers take it as their last argument.
 */
import type { Order, Settings, Repair } from '@/lib/store';
import { openPDFWindowForIOS } from '@/lib/utils';

export async function printOrderSlip(order: Order, settings?: Settings): Promise<void> {
  if (typeof window === 'undefined') return;
  const win = openPDFWindowForIOS();
  try {
    const { generateOrderSlipPDF } = await import('@/lib/order-slip-pdf');
    await generateOrderSlipPDF(order, settings, win);
  } catch (e) {
    win?.close();
    throw e;
  }
}

export async function printOrderPdf(order: Order): Promise<void> {
  if (typeof window === 'undefined') return;
  const win = openPDFWindowForIOS();
  try {
    const { saveOrderPdf } = await import('@/lib/order-pdf');
    await saveOrderPdf(order, win);
  } catch (e) {
    win?.close();
    throw e;
  }
}

export async function printRepairReceipt(repair: Repair): Promise<void> {
  if (typeof window === 'undefined') return;
  const win = openPDFWindowForIOS();
  try {
    const { saveRepairPdf } = await import('@/lib/repair-pdf');
    await saveRepairPdf(repair, win);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** The workshop slip as a document, for the print dialog (no window involved). */
export async function drawOrderSlipLazy(...args: Parameters<typeof import('@/lib/order-slip-pdf').drawOrderSlipPdf>) {
  const { drawOrderSlipPdf } = await import('@/lib/order-slip-pdf');
  return drawOrderSlipPdf(...args);
}
