/**
 * Writing a sale: a new invoice, or one edited and saved again. The one copy, run by the browser's
 * New sale (store.ts generateInvoice, the client SDK) and by the iPhone app's (/api/app/write
 * createInvoice, the Admin SDK), so a sale cannot price, number or book itself two ways.
 *
 * One commit. Everything it needs is read first and together (the settings' invoice counter, the
 * customer, the invoice being edited, the number this sale will most likely take, and an edit's
 * old ledger rows), and then, in the same transaction: the customer if one is to be made, each
 * piece moved from stock to sold, the counter, the invoice, and its ledger rows (an edit's old ones
 * out; what is still owed as one row; what was paid past the total as the customer's credit).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Customer, DeliveryInfo, Invoice, InvoiceItem, Payment, Product, SalePayment, Settings } from '@/lib/store';
import { _calculateProductCostsInternal } from '@/lib/pricing';
import { exchangeTotal, invoiceExchangeFields, type ExchangeEntry } from '@/lib/exchange';
import { canHoldCredit, creditDescription, inCredit } from '@/lib/invoice-credit';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';
import { newShareToken } from '@/lib/share-token';
import { normalizePhoneNumber } from '@/lib/utils';
import { shouldCreateCustomer } from '@/lib/walk-in';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';
const CUSTOMERS = 'customers';
const INVOICES = 'invoices';
const HISAAB = 'hisaab';
const PRODUCTS = 'products';
const SOLD = 'sold_products';

/** A piece in the sale as the sale screen holds it: the product, perhaps re-priced by hand. */
export type SaleLine = Product & { isCustomPrice?: boolean };

export interface SaleInput {
  cart: SaleLine[];
  customer: { id?: string; name: string; phone?: string };
  rates: Partial<Settings>;
  discountAmount: number;
  /** What the customer handed over, one row each (lib/exchange.ts). */
  exchanges?: ExchangeEntry[];
  /** Set when an invoice is being edited and saved again. */
  existingInvoiceId?: string;
  delivery?: DeliveryInfo;
  takenBy?: string;
  hideRates?: boolean;
  internalNote?: string;
  /** Payments taken as the invoice is written; added to any it already had. */
  payments?: SalePayment[];
  /** The 24k rate typed for the shop's margin (lib/margin.ts). */
  costRate24k?: number;
  /** The invoice counter this device last saw: its next number is read with the rest, saving a trip when right. */
  lastInvoiceNumber?: number;
}

export interface SaleSideEffects extends SideEffects {
  /** Now, as ISO (tests). */
  now?: () => string;
  /** A new customer's id (tests): stable across a retried transaction. */
  newCustomerId?: () => string;
}

/** What an invoice keeps about where it came from when it is edited and saved again. */
export const INVOICE_PROVENANCE = [
  'sourceOrderId', 'source', 'notes', 'acquisitionSource', 'shopifyFulfillment', 'shopifyFinancialStatus',
  'shopifyOrderName', 'shopifyOrderId', 'shopifyOrderNumber', 'shopifyDraftOrderId', 'shopifyCheckoutUrl',
  // Which of Shopify's payments are already on it: lose these and its next notice adds them again.
  'shopifyTransactionIds', 'shopifyCancelledAt', 'shopifySyncedAt',
  // A link already sent to the customer keeps working after the invoice is edited.
  'shareToken',
] as const;

export function pickDefined<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = obj[k];
  return out;
}

/** Firestore refuses undefined: every field left undefined is dropped, all the way down. */
export function cleanObject<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => cleanObject(item)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v !== null && typeof v === 'object' ? cleanObject(v) : v;
  }
  return out as T;
}

const invoiceNumber = (n: number) => `INV-${n.toString().padStart(6, '0')}`;

export async function createInvoice(db: DbPort, input: SaleInput, fx: SaleSideEffects = {}): Promise<Invoice> {
  const { cart, customer: customerInfo, rates: invoiceRates, discountAmount, exchanges, existingInvoiceId, delivery,
    takenBy, hideRates, internalNote, payments, costRate24k } = input;
  if (!cart.length) throw new Error('The sale has no pieces.');
  const now = fx.now ?? (() => new Date().toISOString());
  const before: { total: number | null } = { total: null };

  // An edit replaces the invoice's ledger rows: they are looked up while the transaction reads, and
  // swapped in the same commit. A failed lookup never stops the invoice: the old rows just stay.
  const oldHisaab = existingInvoiceId
    ? db.queryEquals(HISAAB, 'linkedInvoiceId', existingInvoiceId).catch(() => null)
    : Promise.resolve(null);
  // The number this invoice will most likely get, from the counter this device already has.
  const predictedId = existingInvoiceId || input.lastInvoiceNumber === undefined ? null : invoiceNumber((input.lastInvoiceNumber || 0) + 1);

  const result = await db.runTransaction<Invoice>(async (tx) => {
    // --- READS FIRST, AND TOGETHER ---
    const [currentSettings, customerDoc, existingInvoiceData, predictedDoc, oldRows] = await Promise.all([
      tx.get<Settings>(SETTINGS, GLOBAL),
      customerInfo.id ? tx.get<Customer>(CUSTOMERS, customerInfo.id) : Promise.resolve(null),
      existingInvoiceId ? tx.get<Omit<Invoice, 'id'>>(INVOICES, existingInvoiceId) : Promise.resolve(null),
      predictedId ? tx.get(INVOICES, predictedId) : Promise.resolve(null),
      oldHisaab,
    ]);
    if (!currentSettings) throw new Error('Global settings not found.');

    // Existing invoice: payment history and creation date must survive a re-save.
    const existingPaymentHistory: Payment[] = existingInvoiceData?.paymentHistory || [];
    const existingCreatedAt = existingInvoiceData?.createdAt;
    if (existingInvoiceData) before.total = Number(existingInvoiceData.grandTotal) || 0;

    // A new invoice's number, checked free before anything is written (reads after writes are refused).
    let nextInvoiceNumber: number | undefined;
    let newInvoiceId: string | undefined;
    if (!existingInvoiceId) {
      nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
      newInvoiceId = invoiceNumber(nextInvoiceNumber);
      const taken = newInvoiceId === predictedId ? predictedDoc : await tx.get(INVOICES, newInvoiceId);
      if (taken) {
        throw new Error(`Invoice ${newInvoiceId} already exists — the invoice counter (lastInvoiceNumber=${currentSettings.lastInvoiceNumber}) is stale. Please contact your administrator to recalibrate it.`);
      }
    }

    // --- WRITES SECOND ---
    let finalCustomerId = customerInfo.id;
    let finalCustomerName = customerInfo.name;
    // A walk-in ("Walk-in Customer", nobody named) is not a customer: the invoice goes out with no customerId.
    if (shouldCreateCustomer(customerInfo)) {
      const newCustId = fx.newCustomerId?.() ?? `cust-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newCustomerData: Omit<Customer, 'id'> = { name: customerInfo.name, phone: customerInfo.phone || '', address: '', email: '' };
      tx.set(CUSTOMERS, newCustId, newCustomerData as unknown as Record<string, unknown>);
      finalCustomerId = newCustId;
    } else if (customerDoc) {
      finalCustomerName = customerDoc.name;
    }

    const ratesForInvoice = {
      goldRatePerGram24k: invoiceRates.goldRatePerGram24k ?? 0,
      goldRatePerGram22k: invoiceRates.goldRatePerGram22k ?? 0,
      goldRatePerGram21k: invoiceRates.goldRatePerGram21k ?? 0,
      goldRatePerGram18k: invoiceRates.goldRatePerGram18k ?? 0,
      palladiumRatePerGram: invoiceRates.palladiumRatePerGram ?? 0,
      // The per-karat palladium rates the sale screen priced with: dropped here, an 18k or 12k
      // piece was saved at the flat rate while the screen had shown another (2026-10-04).
      ...(Number(invoiceRates.palladiumRatePerGram18k) > 0 && { palladiumRatePerGram18k: Number(invoiceRates.palladiumRatePerGram18k) }),
      ...(Number(invoiceRates.palladiumRatePerGram12k) > 0 && { palladiumRatePerGram12k: Number(invoiceRates.palladiumRatePerGram12k) }),
      platinumRatePerGram: invoiceRates.platinumRatePerGram ?? 0,
      silverRatePerGram: invoiceRates.silverRatePerGram ?? 0,
    };

    let subtotal = 0;
    const invoiceItems: InvoiceItem[] = [];
    for (const cartItem of cart) {
      const costs = _calculateProductCostsInternal(cartItem, ratesForInvoice);
      subtotal += costs.totalPrice;
      const itemToAdd: Partial<InvoiceItem> = {
        sku: cartItem.sku, name: cartItem.name, categoryId: cartItem.categoryId,
        metalType: cartItem.metalType, metalWeightG: cartItem.metalWeightG, stoneWeightG: cartItem.stoneWeightG,
        quantity: 1, unitPrice: costs.totalPrice, itemTotal: costs.totalPrice,
        metalCost: costs.metalCost, wastageCost: costs.wastageCost,
        wastagePercentage: cartItem.wastagePercentage, makingCharges: costs.makingCharges,
        diamondChargesIfAny: costs.diamondCharges, stoneChargesIfAny: costs.stoneCharges,
        miscChargesIfAny: costs.miscCharges,
      };
      if (cartItem.karat) itemToAdd.karat = cartItem.karat;
      if (cartItem.stoneDetails) itemToAdd.stoneDetails = cartItem.stoneDetails;
      if (cartItem.diamondDetails) itemToAdd.diamondDetails = cartItem.diamondDetails;
      if (cartItem.size) itemToAdd.size = cartItem.size;
      if (cartItem.isCustomPrice) {
        itemToAdd.isCustomPrice = true;
        // The price holds whatever is set in it: kept so the margin knows (lib/margin.ts).
        if (cartItem.hasDiamonds) itemToAdd.hasDiamonds = true;
        if (cartItem.hasStones) itemToAdd.hasStones = true;
      }
      if (cartItem.metalType === 'silver' && Number(cartItem.silverRatePerGram) > 0) itemToAdd.silverRatePerGram = Number(cartItem.silverRatePerGram);
      if (cartItem.platingType) itemToAdd.platingType = cartItem.platingType;
      if (cartItem.platingNote) itemToAdd.platingNote = cartItem.platingNote;
      // An edit rebuilds every line from the cart, which knows nothing of the Workshop: the karigar
      // given a Shopify sale's piece, its tick, its category. The line as saved keeps them.
      if (existingInvoiceData) {
        const lines = (Array.isArray(existingInvoiceData.items) ? existingInvoiceData.items : Object.values(existingInvoiceData.items || {})) as InvoiceItem[];
        const saved = lines.find((l) => l?.sku === cartItem.sku);
        if (saved) for (const k of ['karigarId', 'isCompleted', 'itemCategory', 'platingType', 'platingNote', 'silverRatePerGram'] as const) {
          if (saved[k] !== undefined && saved[k] !== null && (itemToAdd as Record<string, unknown>)[k] === undefined) (itemToAdd as Record<string, unknown>)[k] = saved[k];
        }
      }
      invoiceItems.push(cleanObject(itemToAdd as InvoiceItem));
      tx.set(SOLD, cartItem.sku, cleanObject(cartItem) as unknown as Record<string, unknown>);
      tx.delete(PRODUCTS, cartItem.sku);
    }

    const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
    const grandTotal = subtotal - calculatedDiscountAmount - exchangeTotal(exchanges);
    const existingAdjustmentsAmount = getInvoiceAdjustmentsAmount(existingInvoiceData);

    // An edit keeps its number, so a number is never used twice.
    let invoiceId: string;
    if (existingInvoiceId) {
      invoiceId = existingInvoiceId;
    } else {
      invoiceId = newInvoiceId!;
      tx.update(SETTINGS, GLOBAL, { lastInvoiceNumber: nextInvoiceNumber });
    }

    // Payments taken at the counter go into the same history, in the same shape, as a payment recorded
    // afterwards (writes/invoice-payment.ts). Paid is recomputed from the whole history.
    const paidAt = now();
    const takenNow: Payment[] = (payments || [])
      .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
      .map((p) => ({
        amount: p.amount, date: paidAt,
        notes: p.method ? `Payment received (${p.method})` : 'Payment received',
        ...(p.method && { method: p.method }),
        ...(p.reference?.trim() && { reference: p.reference.trim() }),
      }));
    const paymentHistory = [...existingPaymentHistory, ...takenNow];
    const amountPaid = paymentHistory.reduce((acc, p) => acc + (p.amount || 0), 0);
    // Over the total is credit for a named customer; nobody holds a walk-in's (lib/invoice-credit.ts).
    if (takenNow.length && amountPaid > grandTotal + 0.5 && !canHoldCredit(finalCustomerId)) {
      throw new Error(`The payments (PKR ${amountPaid.toLocaleString()}) come to more than the invoice (PKR ${grandTotal.toLocaleString()}). Name the customer to keep the rest as credit.`);
    }

    const newInvoiceData: Omit<Invoice, 'id'> = {
      items: invoiceItems, subtotal, discountAmount: calculatedDiscountAmount, grandTotal,
      amountPaid,
      balanceDue: grandTotal - amountPaid,
      createdAt: existingCreatedAt || now(),
      ratesApplied: ratesForInvoice,
      ...(takenBy ? { takenBy } : {}),
      ...(hideRates ? { hideRates: true } : {}),
      ...(Number(costRate24k) > 0 ? { costRate24k: Number(costRate24k) } : {}),
      ...(internalNote?.trim() ? { internalNote: internalNote.trim() } : {}),
      paymentHistory,
      customerName: finalCustomerName || 'Walk-in Customer',
      customerId: finalCustomerId,
      customerContact: customerInfo.phone ? normalizePhoneNumber(customerInfo.phone) : customerInfo.phone,
      ...(existingAdjustmentsAmount !== 0 && { adjustmentsAmount: existingAdjustmentsAmount }),
      ...invoiceExchangeFields(exchanges || []),
      // Re-saving keeps where it came from: the order, the Shopify order, the channel, the customer's link.
      shareToken: newShareToken(),
      ...(existingInvoiceData ? pickDefined(existingInvoiceData, INVOICE_PROVENANCE) : {}),
      // Recorded only when the piece is actually going out.
      ...(delivery?.required && delivery.address.trim() ? { delivery } : {}),
    } as Omit<Invoice, 'id'>;
    const clean = cleanObject(newInvoiceData as Invoice);
    tx.set(INVOICES, invoiceId, clean as unknown as Record<string, unknown>);

    // The ledger in the same commit: an edit's old rows go, and what is still owed is one row.
    (oldRows || []).forEach((r) => tx.delete(HISAAB, r.id));
    if (clean.balanceDue > 0) {
      tx.set(HISAAB, db.newId(HISAAB), {
        entityId: clean.customerId || 'walk-in',
        entityType: 'customer',
        entityName: clean.customerName || 'Walk-in Customer',
        date: clean.createdAt,
        description: `Outstanding balance for Invoice ${invoiceId}`,
        cashDebit: clean.balanceDue, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0,
        linkedInvoiceId: invoiceId,
      });
    }
    // Paid past the total for a named customer: the rest is their credit (lib/invoice-credit.ts).
    if (inCredit(clean.balanceDue) && canHoldCredit(clean.customerId)) {
      tx.set(HISAAB, db.newId(HISAAB), {
        entityId: clean.customerId,
        entityType: 'customer',
        entityName: clean.customerName || 'Customer',
        date: clean.createdAt,
        description: creditDescription(invoiceId),
        cashDebit: 0, cashCredit: -clean.balanceDue, goldDebitGrams: 0, goldCreditGrams: 0,
        linkedInvoiceId: invoiceId,
      });
    }

    const finalInvoice = { ...clean, id: invoiceId } as Invoice;
    if (finalInvoice.items && typeof finalInvoice.items === 'object' && !Array.isArray(finalInvoice.items)) {
      finalInvoice.items = Object.values(finalInvoice.items);
    }
    return finalInvoice;
  });

  // An edit is an update, not a second sale: logged as invoice.create it read as a new invoice and
  // carried the activity log's Revert, which deletes the whole invoice (found 2026-10-04).
  const total = Number(result.grandTotal || 0);
  const log = (a: string, t: string, d: string) => void Promise.resolve(fx.log?.(a, t, d, result.id)).catch(() => undefined);
  if (existingInvoiceId) {
    log('invoice.update', `Updated invoice ${result.id}`,
      `Customer: ${result.customerName || 'Walk-in'} | Total: ${before.total !== null && Math.abs(before.total - total) > 0.5 ? `${before.total.toLocaleString()} → ` : ''}${total.toLocaleString()}`);
  } else {
    log('invoice.create', `Created invoice ${result.id}`, `Customer: ${result.customerName || 'Walk-in'} | Total: ${total.toLocaleString()}`);
  }
  for (const p of (payments || []).filter((x) => Number.isFinite(x.amount) && x.amount > 0)) {
    log('invoice.payment', `Payment received for invoice ${result.id}`,
      `Amount: ${p.amount.toLocaleString()}${p.method ? ` (${p.method})` : ''} | Customer: ${result.customerName || 'Walk-in'} | taken with the invoice`);
  }
  fx.syncInvoiceShopify?.(result.id, 'upsert');
  // The WhatsApp alert for a brand-new invoice (not an edit): the sale as a PDF.
  if (!existingInvoiceId) fx.notify?.(result.id);
  return result;
}
