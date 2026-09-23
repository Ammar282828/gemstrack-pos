import { STORE_TAKEN_BY } from './store-config';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { staticCategories, categoryTitle, categorySingular, type Category } from './categories';
import type { MetalType, KaratValue } from './materials';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc, query, orderBy, where, onSnapshot, addDoc, runTransaction, getDocsFromCache, updateDoc, deleteField, Timestamp, serverTimestamp } from 'firebase/firestore';
import { phoneticKey } from '@/lib/voice/phonetics';
import { db, auth, firebaseConfig } from '@/lib/firebase';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';
import { normalizePhoneNumber } from '@/lib/utils';
import { auth as firebaseAuth } from '@/lib/firebase';


// --- Firestore Collection Names ---
export { staticCategories, categoryTitle, categorySingular };
export type { Category };

const FIRESTORE_COLLECTIONS = {
  SETTINGS: "app_settings",
  PRODUCTS: "products",
  SOLD_PRODUCTS: "sold_products",
  CUSTOMERS: "customers",
  KARIGARS: "karigars",
  INVOICES: "invoices",
  ORDERS: "orders",
  CATEGORIES: "categories",
  HISAAB: "hisaab",
  EXPENSES: "expenses",
  ADDITIONAL_REVENUE: "additional_revenue",
  KARIGAR_BATCHES: "karigar_batches",
  ACTIVITY_LOG: "activity_log",
  GIVEN_ITEMS: "given_items",
  SILVER_TRANSACTIONS: "silver_transactions",
  VOICE_ALIASES: "voice_aliases",
  KARIGAR_JOBS: "karigar_jobs",
  REPAIRS: "repairs",
};
const GLOBAL_SETTINGS_DOC_ID = "global";


// --- Helper Functions and Constants ---
// Both moved to ./pricing with the maths that uses them.
const MENS_RING_CATEGORY_ID_INTERNAL = 'cat018';

/**
 * Outbound POS → Shopify sync, OFF.
 *
 * With this false, nothing you do in the POS creates or updates a record on
 * the storefront: no draft order per POS order, no Shopify order per invoice,
 * no customer push. Shopify → POS import is unaffected and still runs from
 * Settings.
 *
 * Retractions (`cancel` / `refund`) deliberately still fire. They only close
 * out orders that were pushed to Shopify previously; blocking them would leave
 * a refunded sale sitting live on the storefront with no way to take it down
 * from here.
 *
 * Flip to true to restore two-way behaviour.
 */
const PUSH_TO_SHOPIFY = false;

/**
 * Fire-and-forget Shopify sync. Idempotent on the server; safe to call from
 * any invoice mutation. Skipped for SHOPIFY-originated docs and during SSR.
 */
function syncInvoiceShopify(invoiceId: string | undefined | null, action: 'upsert' | 'cancel' | 'refund' = 'upsert') {
  if (!invoiceId) return;
  if (typeof window === 'undefined') return;
  if (invoiceId.startsWith('SHOPIFY-')) return;
  if (!PUSH_TO_SHOPIFY && action === 'upsert') return;
  fetch('/api/shopify/sync/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId, action }),
  }).catch(() => { /* fire-and-forget */ });
}

/** Fire-and-forget Shopify sync targeting a Shopify order id directly. Used
 * when there is no live invoice doc (e.g. order was reverted before refund). */
function syncShopifyOrderById(shopifyOrderId: string | undefined | null, action: 'cancel' | 'refund') {
  if (!shopifyOrderId) return;
  if (typeof window === 'undefined') return;
  fetch('/api/shopify/sync/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopifyOrderId, action }),
  }).catch(() => { /* fire-and-forget */ });
}

/**
 * Fire-and-forget draft-order sync for an in-progress POS order. Idempotent
 * server-side. Skipped during SSR.
 */
function syncOrderShopify(orderId: string | undefined | null, action: 'upsert' | 'cancel' = 'upsert') {
  if (!orderId) return;
  if (typeof window === 'undefined') return;
  if (!PUSH_TO_SHOPIFY && action === 'upsert') return;
  fetch('/api/shopify/sync/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, action }),
  }).catch(() => { /* fire-and-forget */ });
}


/**
 * Fire-and-forget WhatsApp notification to all configured recipients.
 * No-op during SSR, when notifications are disabled, or when no phones set.
 * `enabled` lets callers gate on a per-event toggle (e.g. settings.notifNewInvoice).
 */
function notifyWhatsApp(
  settings: { notifEnabled?: boolean; notifPhones?: string[] } | undefined,
  message: string,
  enabled: boolean = true,
) {
  if (typeof window === 'undefined') return;
  if (!settings?.notifEnabled || !enabled) return;
  const phones = settings.notifPhones || [];
  if (!phones.length) return;
  // The endpoint is no longer open, so the caller has to prove who it is.
  // Fire-and-forget: a notification must never block or fail a sale.
  (async () => {
    let token = '';
    try { token = (await firebaseAuth?.currentUser?.getIdToken()) || ''; } catch { /* signed out */ }
    for (const phone of phones) {
      fetch('/api/notifications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ to: phone, message }),
      }).catch(e => console.warn('[notif] send failed:', e));
    }
  })();
}

async function deleteCollection(collectionName: string) {
  if (!db || typeof db.app === 'undefined') {
    console.error(`Firestore instance is not available. Cannot delete collection ${collectionName}.`);
    return;
  }
  const collectionRef = collection(db, collectionName);
  const snapshot = await getDocs(collectionRef);
  
  if (snapshot.empty) {
    console.log(`Collection '${collectionName}' is already empty.`);
    return;
  }

  // Firestore allows a maximum of 500 operations in a single batch.
  const batchSize = 500;
  const batches = [];
  for (let i = 0; i < snapshot.docs.length; i += batchSize) {
    const batch = writeBatch(db);
    snapshot.docs.slice(i, i + batchSize).forEach(doc => {
      batch.delete(doc.ref);
    });
    batches.push(batch);
  }

  await Promise.all(batches.map(b => b.commit()));
  console.log(`All documents in collection '${collectionName}' have been deleted.`);
}


// Pricing lives in ./pricing so the server can use it too; re-exported here
// because every existing caller imports it from the store.
export { calculateProductPrice } from './pricing';
import { _calculateProductCostsInternal, GOLD_COIN_CATEGORY_ID_INTERNAL, DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL } from './pricing';

// --- Type Definitions ---
export type { MetalType, KaratValue } from './materials';
import type { OverheadItem, OverheadPlan } from '@/lib/overheads';
import { roleForEmail, isStaffCollection } from '@/lib/roles';
import { devRole, DEV_ROLE_HEADER } from '@/lib/dev-role';

/** The role the app should behave as: a dev preview wins over the real one. */
function effectiveRole(): 'owner' | 'staff' | 'none' {
  return devRole() ?? roleForEmail(auth?.currentUser?.email);
}
import { clientPort } from '@/lib/db-client-port';
import { recordInvoicePayment } from '@/lib/writes/invoice-payment';
import { createOrder } from '@/lib/writes/create-order';
import { STORE_CONFIG } from '@/lib/store-config';
export type { OverheadItem, OverheadPlan };

export { METAL_TYPES, KARAT_VALUES, metalLabel, karatLabel, describeMetal } from './materials';
/** Retired colour options are kept in the union so settings documents written
 *  before they were removed still typecheck; only AVAILABLE_THEMES is offered. */
export type RetiredThemeKey = 'forest' | 'ocean' | 'sunset' | 'amethyst' | 'quartz' | 'slate' | 'latte' | 'mint' | 'gold' | 'red';
export type ThemeKey = 'default' | 'taheri' | RetiredThemeKey;

export interface Theme {
  key: ThemeKey;
  name: string;
  primaryColorHsl: string;
}

export const AVAILABLE_THEMES: Theme[] = [
    { key: 'default', name: 'Light', primaryColorHsl: '220.9 39.3% 11%' },
    // The house's own dark palette — which house, globals.css decides by brand.
    { key: 'taheri', name: 'Dark', primaryColorHsl: '34 36% 60%' },
];

/** Anything stored outside this set is a retired colour option — 'red' included,
 *  which is what shops already have written in Firestore. They all render as the
 *  Taheri dark palette, so the picker shows that rather than a blank, and nobody
 *  needs a settings migration to stop wearing the other shop's maroon. */
export const normalizeTheme = (t: string | undefined | null): 'default' | 'taheri' =>
    t === 'default' ? 'default' : 'taheri';

export interface FirebaseConfigStub {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
}

export type GoldRates = {
    goldRatePerGram24k: number;
    goldRatePerGram22k: number;
    goldRatePerGram21k: number;
    goldRatePerGram18k: number;
};

export interface PaymentMethod {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban?: string;
}

export interface Settings extends GoldRates {
  /**
   * Palladium, flat. Kept because every existing product, order and invoice was priced
   * from it, and it remains the fallback when a piece carries no karat.
   */
  palladiumRatePerGram: number;
  /** Palladium is sold at 12k and 18k here, each at its own rate. */
  palladiumRatePerGram18k: number;
  palladiumRatePerGram12k: number;
  platinumRatePerGram: number;
  silverRatePerGram: number;
  shopName: string;
  shopAddress: string;
  shopContact: string;
  shopLogoUrl?: string;
  shopLogoUrlBlack?: string;
  lastInvoiceNumber: number;
  lastOrderNumber: number;
  /** REP-000001 onwards. Missing until the first repair is written. */
  lastRepairNumber?: number;
  allowedDeviceIds: string[];
  weprintApiSkus: string[];
  paymentMethods: PaymentMethod[];
  theme: ThemeKey;
  databaseLocked?: boolean; // New kill switch flag
  firebaseConfig?: FirebaseConfigStub;
  shopifyStoreDomain?: string;
  shopifyAccessToken?: string;
  shopifyLastSyncedAt?: string;
  shopifyGrantedScopes?: string;
  goldRatesLastFetchedAt?: string; // ISO string – when rates were last auto-fetched from gold.pk
  /** Keep unfinished orders and invoices on this device and offer them back.
   *  Defaults on — losing a half-entered order is worse than an occasional prompt. */
  autoDraftForms?: boolean;
  /** The monthly overhead benchmark, versioned so editing the sheet today does
   *  not rewrite the target months already scored against — see
   *  lib/overheads.ts. Absent until the shop first saves. */
  overheadPlans?: OverheadPlan[];
  /** The first shape of the above, kept so an early save is not lost. */
  monthlyOverheads?: OverheadItem[];
  // WhatsApp Notifications
  notifEnabled?: boolean;
  notifPhones?: string[]; // recipient numbers in international format, no +, e.g. ["923262275554"]
  notifNewOrder?: boolean;
  notifOrderCompleted?: boolean;
  notifOrderCancelled?: boolean;
  notifNewInvoice?: boolean;       // real-time: a new invoice/sale was created
  notifPaymentReceived?: boolean;  // real-time: a payment was recorded on an invoice
  notifDailyReport?: boolean;      // 9 PM daily orders + invoices summary
  notifDailyChecklist?: boolean;
  notifEndOfDay?: boolean;
  notifWeeklyReport?: boolean;
  notifOrderOverdue?: boolean; // daily check: orders Pending/In Progress for 7+ days
  notifGivenItems?: boolean;   // daily check: given items unreturned for 7+ days
  notifKarigarPayment?: boolean; // weekly check: unpaid karigar batches
  notifDailyChecklistTime?: string; // "HH:MM", default "09:00"
  notifEndOfDayTime?: string;       // "HH:MM", default "19:00"
}


// Where a customer/sale came from — used for acquisition analytics.
export const CUSTOMER_SOURCES = ['taheri_spillover', 'referral', 'walkin', 'social_media', 'website', 'other'] as const;
export type CustomerSource = typeof CUSTOMER_SOURCES[number];
export const CUSTOMER_SOURCE_LABELS: Record<CustomerSource, string> = {
  taheri_spillover: 'Taheri Spillover',
  referral: 'Referral',
  walkin: 'Walk-in',
  // Instagram, WhatsApp statuses, a forwarded reel — anything that arrived through a feed.
  social_media: 'Social media',
  website: 'Website',
  other: 'Other',
};

export interface Customer {
  id: string; // Firestore document ID
  name: string;
  phone?: string;
  /**
   * A second number, for the customer who answers on one phone and sends photos from
   * another. Never overwritten by an import — it is the spare slot a half-matched contact
   * lands in, so the number already in the book keeps its place.
   */
  altPhone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  source?: CustomerSource; // Acquisition channel (Taheri spillover, referral, walk-in, other)
  shopifyCustomerId?: string;

  /**
   * What the shop needs to know about a body before it can make anything for it.
   *
   * Kept as free text rather than numbers on purpose: a ring size is quoted as "12",
   * "12.5", "US 6" or "Fatema's usual" depending on who is asking, and forcing that into a
   * number loses the only version anyone at the counter recognises.
   */
  ringSize?: string;
  bangleSize?: string;
  braceletSize?: string;
  chainLength?: string;

  /** ISO yyyy-mm-dd. */
  birthday?: string;
  anniversary?: string;

  /** What they like, in the shop's own words — "no rose gold", "prefers heavier sets". */
  preference?: string;
  /** Free tags carried over from the phone book: tj, hom, tc. */
  tags?: string[];
  notes?: string;

  /**
   * Removal hides a customer; it does not destroy them. Their ledger, orders and invoices
   * stay exactly where they are, and Settings > Recently removed puts them back.
   * Undefined means present.
   */
  deletedAt?: string;
}

export interface Product {
  sku: string; // Firestore document ID (use SKU as ID)
  name: string;
  categoryId: string;
  // Primary Metal
  metalType: MetalType;
  karat?: KaratValue;
  metalWeightG: number;
  // Secondary Metal (optional)
  secondaryMetalType?: MetalType;
  secondaryMetalKarat?: KaratValue;
  secondaryMetalWeightG?: number;
  // Other details
  hasStones: boolean;
  stoneWeightG: number;
  wastagePercentage: number;
  makingCharges: number;
  hasDiamonds: boolean;
  diamondCharges: number;
  stoneCharges: number;
  miscCharges: number;
  qrCodeDataUrl?: string;
  imageUrl?: string;
  stoneDetails?: string;
  diamondDetails?: string;
  // Manual Price Override fields
  isCustomPrice?: boolean;
  customPrice?: number;
  description?: string;
  size?: string; // Optional ring/bracelet size (e.g. "10 Indian / 5 US"); free text
  platingType?: string;  // 925 silver only
  platingNote?: string;
  nickelFree?: boolean;
  silverRatePerGram?: number;
  shopifyProductId?: string;
  shopifyVariantId?: string;
}

export interface InvoiceItem {
  sku: string;
  name: string;
  categoryId: string;
  metalType: MetalType;
  karat?: KaratValue;
  metalWeightG: number;
  stoneWeightG: number;
  quantity: number; // Will always be 1 in new model, but kept for schema consistency
  unitPrice: number;
  itemTotal: number;
  metalCost: number;
  wastageCost: number;
  wastagePercentage: number;
  makingCharges: number;
  diamondChargesIfAny: number;
  stoneChargesIfAny: number;
  miscChargesIfAny: number;
  stoneDetails?: string;
  diamondDetails?: string;
  isCustomPrice?: boolean;
  isManualPrice?: boolean;
  itemCategory?: string;
  size?: string; // Optional ring/bracelet size carried from product or order
  platingType?: string;  // 925 silver only
  platingNote?: string;
  nickelFree?: boolean;
  adminNote?: string; // Internal-only note; never printed on estimates/invoices
  // Workshop fields — a sold piece can still need bench work (resizing,
  // replating, a repair), and Shopify orders arrive here as invoices rather
  // than orders, so they need somewhere to be assigned from.
  karigarId?: string;
  isCompleted?: boolean;
  /** See OrderItem.givenAt. */
  givenAt?: string;
}

/** How the money actually arrived. Cash is the default because most of the
 *  counter trade is cash; the rest matter for reconciling against a bank. */
export const PAYMENT_TYPES = ['Cash', 'Card', 'Bank Transfer', 'Cheque'] as const;
export type PaymentType = typeof PAYMENT_TYPES[number];

export interface Payment {
  amount: number;
  date: string; // ISO string
  notes?: string;
  /** Undefined on records written before payment types existed. */
  method?: PaymentType;
  /** Cheque number, last four of the card, transfer reference. */
  reference?: string;
}

/**
 * Where a piece is going, when it is not being handed over at the counter.
 * Shared by orders and invoices so a piece ordered for delivery keeps the same
 * address when it is finally invoiced.
 */
export interface DeliveryInfo {
  required: boolean;
  address: string;
  city?: string;
  /** Only when the person receiving is not the customer on the bill. */
  contactName?: string;
  contactPhone?: string;
  /** Instructions for whoever drops it — gate code, timing, landmark. */
  notes?: string;
  /** ISO date the customer expects it. */
  expectedDate?: string;
  /** Charged to the customer; 0 when delivery is free. */
  charge?: number;
}

export interface Invoice {
  id: string; // Firestore document ID
  delivery?: DeliveryInfo;
  customerId?: string;
  customerName: string;
  customerContact?: string;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  exchangeDescription?: string;
  exchangeAmount1?: number;
  exchangeAmount2?: number;
  adjustmentsAmount?: number; // Shipping, taxes, or other adjustments beyond line items
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  createdAt: string; // ISO string
  ratesApplied: Partial<Settings>;
  /**
   * Print the bill without the per-gram rates. The rates are still applied and still
   * stored -- the arithmetic is unchanged -- they are just not written on the paper.
   * Some customers are quoted a piece, not a gold price, and a rate line on the slip
   * invites a conversation the counter has already had.
   */
  hideRates?: boolean;
  /** Who wrote it. See TAKEN_BY. */
  takenBy?: TakenBy;
  /**
   * For the shop, about this sale — a resize still to do, a stone to swap, an
   * arrangement about the balance. Never printed, never sent to the customer.
   */
  internalNote?: string;
  paymentHistory: Payment[];
  sourceOrderId?: string; // Set when invoice is created from an order
  source?: string; // 'shopify_import' | 'shopify' for imported/synced orders
  notes?: string;  // import provenance / fulfilment status for Shopify orders
  shopifyFulfillment?: string;      // 'fulfilled' | 'unfulfilled' | ''
  shopifyFinancialStatus?: string;  // 'paid' | 'pending' | 'voided' | …
  shopifyOrderName?: string;
  shopifyOrderId?: string;
  shopifyOrderNumber?: number;
  shopifyDraftOrderId?: string;
  shopifyCheckoutUrl?: string;
  status?: 'Refunded'; // Set when invoice has been refunded
  refundedAt?: string; // ISO string of refund time
  acquisitionSource?: CustomerSource; // Acquisition channel for this sale (carried from order/customer). Named distinctly from the Shopify `source` above.
}

export interface Karigar {
  id: string; // Firestore document ID
  name: string;
  contact?: string;
  altPhone?: string;
  /** What he actually makes — setting, polish, chain, meena. */
  specialty?: string;
  workshop?: string;
  address?: string;
  city?: string;
  country?: string;
  notes?: string;
  /** Google account this karigar signs in with. Grants access to their own
   *  work list + hisaab ONLY, served through /api/karigar/* (never direct
   *  Firestore access — see firestore.rules). */
  email?: string;
  /** See Customer.deletedAt — removal hides, it does not destroy. */
  deletedAt?: string;
}

/**
 * What a speaker's pronunciation actually sounded like, once corrected.
 *
 * This is how the software learns one household's accents rather than guessing forever.
 * When the assistant picks the wrong Alifya and is told which one was meant, the sound of
 * what was said is written down against the right row — and from then on that sound is the
 * one signal in the matcher that is not a guess.
 */
export interface VoiceAlias {
  id: string;
  /** The name as it was heard, kept for display so the shop can see what it learned. */
  heard: string;
  /** phoneticKey(heard).join(' ') — what the matcher actually looks up. */
  heardKey: string;
  kind: HisaabEntityType;
  refId: string;
  /** The name it now resolves to, denormalised so the list reads without a join. */
  refName: string;
  uses: number;
  createdAt: string;
}

/**
 * Who took the order or wrote the invoice.
 *
 * A name off a fixed list rather than free text, because this is a filter as much as a
 * record: five people at one counter, and "Ammar" typed three ways cannot be counted.
 * Kept separate from the app's sign-in accounts on purpose — whoever is standing at the
 * screen is often not whose Google session it is.
 */
export const TAKEN_BY: readonly string[] = STORE_TAKEN_BY;
export type TakenBy = string;

export const ORDER_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled', 'Refunded'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export interface OrderItem {
  itemCategory?: string;
  description: string;
  karat?: KaratValue;
  estimatedWeightG: number;
  stoneWeightG: number;
  hasStones: boolean;
  wastagePercentage: number;
  makingCharges: number;
  diamondCharges: number;
  stoneCharges: number;
  sampleImageDataUri?: string;
  referenceSku?: string;
  sampleGiven: boolean;
  isCompleted: boolean;
  /**
   * When the piece physically went to the karigar — ISO, set from the Workshop's
   * "Given" box. Deliberately separate from karigarId: a job is assigned in the app
   * the moment somebody picks a name, and handed over when the gold actually leaves
   * the shop, and the gap between those two is exactly what the counter needs to see.
   */
  givenAt?: string;
  hasDiamonds: boolean;
  stoneDetails?: string;
  diamondDetails?: string;
  metalCost?: number;
  wastageCost?: number;
  totalEstimate?: number;
  metalType: MetalType;
  karigarId?: string;
  isManualPrice?: boolean;
  manualPrice?: number;
  size?: string; // Optional ring/bracelet size (e.g. "10 Indian / 5 US"); free text
  platingType?: string;  // 925 silver only — White Rhodium, 21K Gold Plating, …
  platingNote?: string;  // free text when platingType is "Other"
  nickelFree?: boolean;  // nickel-free finish requested
  adminNote?: string; // Internal-only note; never printed on estimates/invoices
}

export interface Order {
  delivery?: DeliveryInfo;
  id: string; // Firestore document ID, e.g., ORD-000001
  createdAt: string; // ISO string
  /** The date the piece was promised to the customer, as a plain yyyy-MM-dd.
   *  Deliberately separate from delivery.expectedDate, which only exists when
   *  the order is being shipped — most pieces are collected from the shop and
   *  had no promised date anywhere before this. Optional because every order
   *  written before it existed has none; see promiseState() for the fallback. */
  promisedDate?: string;
  status: OrderStatus;
  items: OrderItem[];
  ratesApplied: Partial<Settings>; // Store all rates at time of order
  /** See Invoice.hideRates. Carried onto the invoice when the order is finalised. */
  hideRates?: boolean;
  /** Who took it at the counter. See TAKEN_BY. */
  takenBy?: TakenBy;
  subtotal: number;
  /** Agreed at order time and carried into the invoice when it is finalised,
   *  so a price settled with the customer does not have to be re-entered. */
  discountAmount?: number;
  advancePayment: number;
  advanceGoldDetails?: string;
  grandTotal: number;
  summary?: string;
  customerId?: string;
  customerName?: string;
  customerContact?: string;
  source?: CustomerSource; // Per-order acquisition channel override (defaults to the customer's source)
  advanceInExchangeDescription?: string; // For gold/diamonds given by customer
  advanceInExchangeValue?: number; // Estimated value of the exchange
  invoiceId?: string; // Set when order is finalized into an invoice
  tcsConsignmentNo?: string; // TCS Envio courier consignment number
  /** Set only on orders placed from taheri.shop — see lib/website/types.ts. */
  website?: import('@/lib/website/types').WebsiteOrderMeta;
  leopards?: import('@/lib/website/types').LeopardsMeta;
  notes?: string;
  shopifyOrderId?: string; // Carried forward from invoice during edit/revert so the next finalize re-links the same Shopify order
  shopifyOrderNumber?: number;
  shopifyDraftOrderId?: string; // Set while the order is in-progress (pre-invoice) and mirrored to Shopify as a draft order
  shopifyDraftOrderName?: string; // Shopify-assigned draft name (e.g. #D1)
}

/**
 * Revenue-recognition date for an invoice. Sales are recognized on the date the
 * underlying ORDER was created — NOT the date it happened to be invoiced — so an
 * old order that is invoiced later doesn't inflate the later period's revenue.
 * Falls back to the invoice's own createdAt for direct invoices (walk-in sales
 * with no source order). Pass a Map of order id -> order for O(1) lookup.
 */
export function getInvoiceRevenueDate(
  invoice: Pick<Invoice, 'createdAt' | 'sourceOrderId'>,
  ordersById: Map<string, Pick<Order, 'createdAt'>>
): string {
  if (invoice.sourceOrderId) {
    const order = ordersById.get(invoice.sourceOrderId);
    if (order?.createdAt) return order.createdAt;
  }
  return invoice.createdAt;
}

export type HisaabEntityType = 'customer' | 'karigar';

export interface HisaabEntry {
  id: string;
  entityId: string; // Customer or Karigar ID
  entityType: HisaabEntityType;
  entityName: string;
  date: string; // ISO string
  description: string;
  // Amount customer/karigar owes us.
  // This increases when we give them goods/services on credit (e.g. invoice).
  cashDebit: number;
  // Amount we owe customer/karigar.
  // This increases when they pay us, give us goods.
  cashCredit: number;
  goldDebitGrams: number; // Gold we gave them
  goldCreditGrams: number; // Gold they gave us
  linkedInvoiceId?: string; // Set for auto-managed outstanding balance entries
}

export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Utilities', 'Marketing', 'Supplies', 
  'Repairs & Maintenance', 'Taxes', 'Travel', 'Making Charges',
  // Money a shareholder takes out. Kept out of the partnership P&L — see
  // the note in lib/partnership.ts — but it is real cash leaving the till,
  // so it belongs in the expense list.
  'Partner Drawings',
  // A partner paying themselves for work. A real business cost, so unlike a
  // drawing this one does count against profit.
  'Partner Salary',
  'Other'
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export type PaidBy = 'business' | 'ammar' | 'mina';

export interface Expense {
  id: string;
  date: string; // ISO String
  category: ExpenseCategory | string; // Allow 'Other' as custom string
  description: string;
  amount: number;
  karigarId?: string; // Links this expense to a karigar payment
  batchId?: string;   // Links this expense to a karigar hisaab batch
  paidBy?: PaidBy;    // Who fronted the cash; defaults to 'business'
  shareholderId?: string; // Set on partner salary rows — which partner it paid
  ledgerEntryId?: string; // Auto-created entry on {paidBy}_ledger when paidBy !== 'business'
}

export interface KarigarBatch {
  id: string;
  karigarId: string;
  label: string;       // e.g., "March 2026"
  startDate: string;   // ISO
  closedDate?: string; // ISO — undefined means open/current
  totalPaid?: number;  // Stored when closed for quick display
}

export const KARIGAR_JOB_STATUSES = ['pending', 'in-progress', 'completed'] as const;
export type KarigarJobStatus = typeof KARIGAR_JOB_STATUSES[number];

/**
 * A standalone piece of work assigned to a karigar that does NOT come from a
 * customer order — e.g. stock pieces, repairs, samples, re-polish jobs.
 * Order-sourced work is derived from OrderItem.karigarId instead; the Workshop
 * dashboard merges both into one view (see src/lib/workshop.ts).
 */
export interface KarigarJob {
  id: string;
  karigarId: string;
  karigarName: string;
  description: string;
  itemCategory?: string;
  metalType?: MetalType;
  karat?: KaratValue;
  weightG?: number;
  quantity?: number;
  size?: string;
  status: KarigarJobStatus;
  assignedDate: string;    // ISO — when the work was handed over
  /** See OrderItem.givenAt. assignedDate is when it was written up; this is when it left. */
  givenAt?: string;
  completedDate?: string;  // ISO — set when marked completed
  agreedCost?: number;     // making charges agreed with the karigar
  notes?: string;
}

export interface SilverTransaction {
  id: string;
  karigarId: string;
  karigarName: string;
  date: string;        // ISO
  silverGrams: number;
  surchargePerGram: number;
  totalSurcharge: number;
  description?: string;
}

export interface AdditionalRevenue {
  id: string;
  date: string; // ISO String
  description: string;
  amount: number;
  /** Set when the money was taken for a repair — see Repair.payments. */
  repairId?: string;
}

// --- Repairs ---------------------------------------------------------------
/**
 * A customer's own piece, left at the counter to be mended.
 *
 * Not an order (nothing is being made or sold) and not a given item (it is the
 * customer's, not the shop's). It is weighed when it comes in and again when it
 * goes back, because for gold that is the question a customer asks. Money taken
 * for a repair — an advance, the balance — is written to Extra Revenue in the
 * same transaction as the repair, so the dashboard and analytics count it
 * without knowing repairs exist.
 */
export const REPAIR_STATUSES = ['received', 'in_progress', 'ready', 'collected', 'cancelled'] as const;
export type RepairStatus = typeof REPAIR_STATUSES[number];
export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  received: 'In the shop',
  in_progress: 'Being worked on',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled',
};
/** What is usually asked for. Free text in `details` says exactly what. */
export const REPAIR_WORK = [
  'Resize', 'Polish', 'Replate', 'Solder / join', 'Stone reset', 'Stone replace',
  'Clasp / lock', 'Chain repair', 'Earring post / back', 'Rhodium', 'Clean', 'Other',
] as const;

export interface RepairPayment {
  amount: number;
  date: string;              // ISO
  method?: PaymentType;
  /** The Extra Revenue row this payment wrote. */
  revenueId?: string;
  note?: string;
}

export interface Repair {
  id: string;                // REP-000001
  customerId?: string;
  customerName: string;
  customerContact?: string;
  item: string;              // "Gold ring with a ruby"
  metalType?: MetalType;
  karat?: KaratValue;
  /** Weighed at the counter when it came in, and again when it went back. */
  weightInG?: number;
  weightOutG?: number;
  work: string[];            // from REPAIR_WORK
  details?: string;          // "size 12 to 14; the left stone is missing"
  estimate?: number;         // what the customer was quoted
  charge?: number;           // the final figure, set when it is ready
  payments: RepairPayment[];
  karigarId?: string;
  karigarName?: string;
  karigarCost?: number;      // what the karigar is paid for it
  status: RepairStatus;
  receivedAt: string;        // ISO
  promisedDate?: string;     // yyyy-MM-dd
  readyAt?: string;
  collectedAt?: string;
  takenBy?: TakenBy;
  /** For the shop only. Never printed, never sent. */
  internalNote?: string;
}

/** What the customer still owes: the charge (or the estimate, until there is one) less what has been paid. */
export function repairBalance(r: Pick<Repair, 'charge' | 'estimate' | 'payments'>): number {
  const due = r.charge ?? r.estimate ?? 0;
  const paid = (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return Math.max(0, Math.round((due - paid) * 100) / 100);
}
export const repairPaid = (r: Pick<Repair, 'payments'>): number =>
  (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

export type GivenItemStatus = 'out' | 'returned';
export type GivenItemRecipientType = 'karigar' | 'customer' | 'other';

export interface GivenItem {
  id: string;
  date: string;           // ISO – date given
  description: string;    // what was given (e.g. "gold ring sample", "repair bangle")
  recipientType: GivenItemRecipientType;
  recipientName: string;  // free-text or resolved name
  recipientId?: string;   // karigarId or customerId if linked
  notes?: string;
  status: GivenItemStatus;
  returnedDate?: string;  // ISO – when it came back
}

// --- Product Tag Format Definitions ---
export interface ProductTagFormat {
  id: string;
  name: string;
  widthMillimeters: number;
  heightMillimeters: number;
  layoutType: 'dumbbell' | 'rectangle';
  // Future enhancements:
  // includePrice?: boolean;
  // includeLogo?: boolean; // Can be inferred if shopLogoUrl exists and space permits
  // qrCodeSize?: number; // Could be a proportion of tag size
}

export const DEFAULT_TAG_FORMAT_ID = 'dumbbell-20x50';

export const AVAILABLE_TAG_FORMATS: ProductTagFormat[] = [
  {
    id: 'dumbbell-20x50',
    name: 'Dumbbell Tag (20mm x 50mm)',
    widthMillimeters: 20,
    heightMillimeters: 50,
    layoutType: 'dumbbell',
  },
  {
    id: 'rectangle-25x15',
    name: 'Small Rectangular Label (25mm x 15mm)',
    widthMillimeters: 25,
    heightMillimeters: 15,
    layoutType: 'rectangle',
  },
  {
    id: 'rectangle-30x20',
    name: 'Medium Rectangular Label (30mm x 20mm)',
    widthMillimeters: 30,
    heightMillimeters: 20,
    layoutType: 'rectangle',
  },
];


// --- SKU Prefixes ---
const CATEGORY_SKU_PREFIXES: Record<string, string> = {
  'cat001': 'RIN', 'cat002': 'TOP', 'cat003': 'BAL', 'cat004': 'LCK',
  'cat005': 'BRC', 'cat006': 'BRS', 'cat007': 'BNG', 'cat008': 'CHN',
  'cat009': 'BND', 'cat010': 'LSW', 'cat011': 'LSB', 'cat012': 'STR',
  'cat013': 'SNX', 'cat014': 'SNB', 'cat015': 'GNX', 'cat016': 'GNW',
  'cat017': 'GCN', 'cat018': 'MRN', 'cat019': 'LBR',
};

// --- Initial Data Definitions (For reference or one-time seeding, not for store initial state) ---
const initialSettingsData: Settings = {
  goldRatePerGram24k: 240000, goldRatePerGram22k: 220000, goldRatePerGram21k: 210000, goldRatePerGram18k: 180000,
  palladiumRatePerGram: 22000, palladiumRatePerGram18k: 0, palladiumRatePerGram12k: 0,
  platinumRatePerGram: 25000, silverRatePerGram: 250,
  // Falls back to this shop's own name, not the other one's. Settings normally come
  // from Firestore; this is what shows in the moment before they arrive, or if the
  // read is denied — and it read "MINA" on Taheri's dashboard for exactly that long.
  shopName: STORE_CONFIG.name, shopAddress: "",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "", shopLogoUrlBlack: "", lastInvoiceNumber: 0,
  lastOrderNumber: 0,
  allowedDeviceIds: ["device-1761585988934-qghkiup"],
  weprintApiSkus: [],
  paymentMethods: [],
  theme: 'slate',
  databaseLocked: false,
  // On by default: losing a half-entered custom order costs more than an
  // occasional prompt offering it back.
  autoDraftForms: true,
  notifEnabled: false,
  notifPhones: [],
  notifNewOrder: true,
  notifOrderCompleted: true,
  notifOrderCancelled: true,
  notifNewInvoice: true,
  notifPaymentReceived: true,
  notifDailyReport: true,
  notifDailyChecklist: true,
  notifEndOfDay: false,
  notifWeeklyReport: true,
  notifOrderOverdue: true,
  notifGivenItems: true,
  notifKarigarPayment: true,
  notifDailyChecklistTime: '09:00',
  notifEndOfDayTime: '19:00',
  firebaseConfig: {
    projectId: "gemstrack-pos",
  }
};


// ─── Size scales ─────────────────────────────────────────────────────────────
// Pre-canned size options per category so users pick from a standard list
// instead of free-typing. Each scale also drives the field label shown.

const RING_SIZES_INDIAN: string[] = Array.from({ length: 51 }, (_, i) => {
  // 0, 0.5, 1, 1.5, ... 25  (51 values total)
  const v = i / 2;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
});
const BRACELET_BANGLE_SIZES: string[] = (() => {
  const out: string[] = [];
  for (let i = 11; i <= 30; i++) out.push((i / 10).toFixed(1)); // 1.1 .. 3.0
  return out;
})();
const LOOSE_BRACELET_SIZES: string[] = (() => {
  const out: string[] = [];
  // 5.75" to 9.0" in 0.25" steps → 14 values
  for (let q = 23; q <= 36; q++) out.push(`${(q / 4).toFixed(2)}"`);
  return out;
})();
const NECKLACE_SIZES: string[] = ['14"', '16"', '18"', '20"', '22"', '24"', '26"', '28"', '30"'];

export type SizeScalePart = {
  key: string;       // 'ring' | 'bangle' | etc — used as the prefix in the combined string
  label: string;
  options: string[];
};

export type SizeScale =
  | { label: string; options: string[] }                  // single-dropdown
  | { label: string; parts: SizeScalePart[]; legacyPartKey?: string };            // multi-part (e.g. ring + bangle)

/** Per-category size scale. If a category isn't in this map, the size input
 * falls back to a free-text field (when SIZE_ELIGIBLE_CATEGORY_IDS includes it). */
export const SIZE_SCALES: Record<string, SizeScale> = {
  'cat001': { label: 'Indian ring size (0–25, 0.5 steps)',      options: RING_SIZES_INDIAN },
  'cat018': { label: 'Indian ring size (0–25, 0.5 steps)',      options: RING_SIZES_INDIAN },
  'cat009': { label: 'Band size (Indian 0–25, 0.5 steps)',      options: RING_SIZES_INDIAN },
  'cat010': { label: 'Ring size (Indian 0–25, 0.5 steps)',      options: RING_SIZES_INDIAN },
  'cat005': { label: 'Bracelet size (1.1–3.0)',                 options: BRACELET_BANGLE_SIZES },
  'cat006': {
    label: 'Ring + Bracelet size',
    legacyPartKey: 'Bracelet',
    parts: [
      { key: 'Ring',     label: 'Ring size (Indian 0–25, 0.5 steps)', options: RING_SIZES_INDIAN },
      { key: 'Bracelet', label: 'Bracelet size (1.1–3.0)',            options: BRACELET_BANGLE_SIZES },
    ],
  },
  'cat007': { label: 'Bangle size (1.1–3.0)',                   options: BRACELET_BANGLE_SIZES },
  'cat014': {
    label: 'Ring + Bracelet size',
    legacyPartKey: 'Bracelet',
    parts: [
      { key: 'Ring',     label: 'Ring size (Indian 0–25, 0.5 steps)', options: RING_SIZES_INDIAN },
      { key: 'Bracelet', label: 'Bracelet size (1.1–3.0)',            options: BRACELET_BANGLE_SIZES },
    ],
  },
  'cat015': {
    label: 'Ring + Bracelet size',
    legacyPartKey: 'Bracelet',
    parts: [
      { key: 'Ring',     label: 'Ring size (Indian 0–25, 0.5 steps)', options: RING_SIZES_INDIAN },
      { key: 'Bracelet', label: 'Bracelet size (1.1–3.0)',            options: BRACELET_BANGLE_SIZES },
    ],
  },
  // Necklace sets without bracelets can still include a ring.
  'cat013': { label: 'Ring size (Indian 0–25, 0.5 steps)',      options: RING_SIZES_INDIAN },
  'cat016': { label: 'Ring size (Indian 0–25, 0.5 steps)',      options: RING_SIZES_INDIAN },
  'cat019': { label: 'Loose bracelet (inches)',                 options: LOOSE_BRACELET_SIZES },
  'cat012': { label: 'String length (inches)',                  options: NECKLACE_SIZES },
  'cat011': {
    label: 'Ring + Bangle size',
    parts: [
      { key: 'Ring',   label: 'Ring size (Indian 0–25, 0.5 steps)', options: RING_SIZES_INDIAN },
      { key: 'Bangle', label: 'Bangle size (1.1–3.0)',              options: BRACELET_BANGLE_SIZES },
    ],
  },
};

export function isMultiPartScale(s: SizeScale | undefined): s is { label: string; parts: SizeScalePart[]; legacyPartKey?: string } {
  return !!s && 'parts' in s;
}

/** Which part a pre-multi-part size string belonged to, e.g. "2.2" on a
 *  Bracelet-and-Ring set was always the bracelet. */
export function legacyPartKeyFor(s: SizeScale | undefined): string | undefined {
  return isMultiPartScale(s) ? (s as { legacyPartKey?: string }).legacyPartKey : undefined;
}

/** Compose a combined size string from a multi-part scale's values.
 *  e.g. { Ring: "10", Bangle: "2.4" } → "Ring: 10 · Bangle: 2.4" */
export function composeMultiSize(values: Record<string, string>): string {
  const filled = Object.entries(values).filter(([_, v]) => v && v.trim());
  return filled.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

/** Parse "Ring: 10 · Bangle: 2.4" → { Ring: "10", Bangle: "2.4" } */
export function parseMultiSize(value: string | undefined, legacyKey?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const chunk of value.split('·')) {
    const m = chunk.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  // Sizes saved before a category gained a second part are stored bare
  // ("2.2" rather than "Bracelet: 2.2") — keep them attached to their part
  // instead of silently dropping them from the form.
  if (Object.keys(out).length === 0 && legacyKey && value.trim()) {
    out[legacyKey] = value.trim();
  }
  return out;
}

/**
 * Categories whose products have a wearable size. Auto-derived from
 * SIZE_SCALES so adding a new scale entry automatically enables the field.
 */
export const SIZE_ELIGIBLE_CATEGORY_IDS: ReadonlySet<string> = new Set(Object.keys(SIZE_SCALES));

/**
 * Finishes applied to 925 sterling silver. Only offered when the metal is
 * silver — plating is meaningless on a solid gold piece.
 */
export const PLATING_TYPES = [
  'White Rhodium',
  '21K Gold Plating',
  '18K Gold Plating',
  'Chandi White Plating',
  'Other',
] as const;
export type PlatingType = typeof PLATING_TYPES[number];

/** Plating only applies to silver. */
export function metalSupportsPlating(metalType?: string): boolean {
  return metalType === 'silver';
}

export function categoryNeedsSize(categoryId?: string): boolean {
  return !!categoryId && SIZE_ELIGIBLE_CATEGORY_IDS.has(categoryId);
}

export function sizeScaleFor(categoryId?: string): SizeScale | undefined {
  return categoryId ? SIZE_SCALES[categoryId] : undefined;
}

export const LOG_EVENT_TYPES = ['product', 'customer', 'karigar', 'invoice', 'order', 'expense', 'repair'] as const;
export type LogEventType = 
  | 'product.create' | 'product.update' | 'product.delete'
  | 'customer.create' | 'customer.update' | 'customer.delete'
  | 'karigar.create' | 'karigar.update' | 'karigar.delete'
  | 'invoice.create' | 'invoice.update' | 'invoice.payment' | 'invoice.refund' | 'invoice.delete'
  | 'order.create' | 'order.update' | 'order.delete' | 'order.revert' | 'order.refund'
  | 'expense.create' | 'expense.update' | 'expense.delete'
  | 'revenue.create' | 'revenue.update' | 'revenue.delete'
  | 'given.create' | 'given.update' | 'given.delete' | 'given.returned'
  | 'job.create' | 'job.update' | 'job.delete'
  | 'repair.create' | 'repair.update' | 'repair.status' | 'repair.payment' | 'repair.delete';

export interface ActivityLog {
    id: string;
    timestamp: string; // ISO string
    eventType: LogEventType;
    description: string; // e.g., "Created new product: RIN-000001"
    details: string; // e.g., "Product: Gold Ring | By: Murtaza"
    entityId: string; // ID of the product, customer, etc.
}

export interface PrintHistoryEntry {
  sku: string;
  timestamp: string; // ISO string
}

// NOTE: activity logging must stay OUTSIDE runTransaction. addActivityLog is a
// plain addDoc, not a transactional write, and Firestore re-runs a transaction
// callback on contention — so logging inside it writes one log per attempt
// while the document is written once. That is how INV-000319 ended up with six
// "Created invoice" lines against a single invoice.
async function addActivityLog(
  eventType: LogEventType,
  description: string,
  details: string,
  entityId: string
) {
    try {
        const logEntry: Omit<ActivityLog, 'id'> = {
            timestamp: new Date().toISOString(),
            eventType,
            description,
            details,
            entityId,
        };
        await addDoc(collection(db, FIRESTORE_COLLECTIONS.ACTIVITY_LOG), logEntry);
    } catch (error) {
        console.error("Failed to add activity log:", error);
    }
}


// --- Store State and Actions ---
type ProductDataForAdd = Omit<Product, 'sku' | 'qrCodeDataUrl'>;
type OrderDataForAdd = Omit<Order, 'id' | 'createdAt' | 'status'>;
type FinalizedOrderItemData = {
    description: string; // Added to help identify item
    metalType: MetalType;
    karat?: KaratValue;
    finalWeightG: number;
    finalMakingCharges: number;
    finalDiamondCharges: number;
    finalStoneCharges: number;
    isManualPrice?: boolean;
    finalManualPrice?: number;
};


export interface CartItem extends Product {
  // A cart item is a full, editable copy of a product.
  // It includes all product fields.
  quantity: 1; // Quantity is always 1 for this POS model.
}

export interface AppState {
  settings: Settings;
  categories: Category[]; // Still local for now
  products: Product[];
  customers: Customer[];
  /** Removed but recoverable — Settings > Recently removed. */
  removedCustomers: Customer[];
  cart: CartItem[]; // This will be persisted
  generatedInvoices: Invoice[];
  karigars: Karigar[];
  removedKarigars: Karigar[];
  voiceAliases: VoiceAlias[];
  karigarBatches: KarigarBatch[];
  silverTransactions: SilverTransaction[];
  orders: Order[];
  hisaabEntries: HisaabEntry[];
  expenses: Expense[];
  additionalRevenues: AdditionalRevenue[];
  givenItems: GivenItem[];
  repairs: Repair[];
  karigarJobs: KarigarJob[];
  soldProducts: Product[];
  activityLog: ActivityLog[];
  printHistory: PrintHistoryEntry[];

  // Loading states
  isSettingsLoading: boolean;
  isProductsLoading: boolean;
  isSoldProductsLoading: boolean;
  isCustomersLoading: boolean;
  isKarigarsLoading: boolean;
  isKarigarBatchesLoading: boolean;
  isSilverTransactionsLoading: boolean;
  isInvoicesLoading: boolean;
  isOrdersLoading: boolean;
  isHisaabLoading: boolean;
  isExpensesLoading: boolean;
  isAdditionalRevenueLoading: boolean;
  isGivenItemsLoading: boolean;
  isRepairsLoading: boolean;
  isKarigarJobsLoading: boolean;
  isActivityLogLoading: boolean;
  
  // Data loaded flags
  hasSettingsLoaded: boolean;
  hasProductsLoaded: boolean;
  hasSoldProductsLoaded: boolean;
  hasCustomersLoaded: boolean;
  hasKarigarsLoaded: boolean;
  hasKarigarBatchesLoaded: boolean;
  hasSilverTransactionsLoaded: boolean;
  hasInvoicesLoaded: boolean;
  hasOrdersLoaded: boolean;
  hasHisaabLoaded: boolean;
  hasExpensesLoaded: boolean;
  hasAdditionalRevenueLoaded: boolean;
  hasGivenItemsLoaded: boolean;
  hasRepairsLoaded: boolean;
  hasKarigarJobsLoaded: boolean;
  hasActivityLogLoaded: boolean;

  // Error states
  settingsError: string | null;
  productsError: string | null;
  soldProductsError: string | null;
  customersError: string | null;
  invoicesError: string | null;
  ordersError: string | null;
  karigarsError: string | null;
  karigarBatchesError: string | null;
  silverTransactionsError: string | null;
  hisaabError: string | null;
  expensesError: string | null;
  additionalRevenueError: string | null;
  givenItemsError: string | null;
  repairsError: string | null;
  karigarJobsError: string | null;
  activityLogError: string | null;


  // Zustand specific hydration state
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  // Actions
  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<Pick<Settings, keyof Settings>>) => Promise<void>;

  addCategory: (title: string) => void; // Local category management
  updateCategory: (id: string, title: string) => void;
  deleteCategory: (id: string) => void;

  loadProducts: () => void;
  loadSoldProducts: () => void;
  reAddSoldProductToInventory: (soldProduct: Product) => Promise<Product | null>;
  addProduct: (productData: ProductDataForAdd) => Promise<Product | null>;
  updateProduct: (sku: string, updatedProductData: Partial<Omit<Product, 'sku'>>) => Promise<void>;
  deleteProduct: (sku: string) => Promise<void>;
  deleteLatestProducts: (count: number) => Promise<number>;
  setProductQrCode: (sku: string, qrCodeDataUrl: string) => Promise<void>; // Will update Firestore then local

  loadCustomers: () => void;
  addCustomer: (customerData: Omit<Customer, 'id'>) => Promise<Customer | null>;
  updateCustomer: (id: string, updatedCustomerData: Partial<Omit<Customer, 'id'>>) => Promise<void>;
  /** Hides the customer. Their history is untouched. */
  deleteCustomer: (id: string) => Promise<void>;
  restoreCustomer: (id: string) => Promise<void>;
  mergeCustomers: (keepId: string, deleteId: string) => Promise<{ updatedDocs: number }>;
  normalizeCustomerPhones: () => Promise<number>;


  loadKarigars: () => void;
  addKarigar: (karigarData: Omit<Karigar, 'id'>) => Promise<Karigar | null>;
  updateKarigar: (id: string, updatedKarigarData: Partial<Omit<Karigar, 'id'>>) => Promise<void>;
  deleteKarigar: (id: string) => Promise<void>;
  restoreKarigar: (id: string) => Promise<void>;
  /**
   * The only thing in the app that actually destroys a record. Removes every soft-deleted
   * customer and karigar for good; their ledger entries and orders are orphaned.
   */
  purgeRemoved: () => Promise<{ customers: number; karigars: number }>;

  loadVoiceAliases: () => void;
  /** Write down that `heard` means this person. Being told once should be enough. */
  teachVoiceAlias: (heard: string, kind: HisaabEntityType, refId: string, refName: string) => Promise<void>;
  forgetVoiceAlias: (id: string) => Promise<void>;
  loadKarigarBatches: () => void;
  createKarigarBatch: (data: Omit<KarigarBatch, 'id'>) => Promise<KarigarBatch | null>;
  closeKarigarBatch: (batchId: string, closedDate: string, totalPaid: number) => Promise<void>;
  deleteKarigarBatch: (batchId: string) => Promise<void>;

  loadSilverTransactions: () => void;
  addSilverTransaction: (data: Omit<SilverTransaction, 'id'>) => Promise<SilverTransaction | null>;
  deleteSilverTransaction: (id: string) => Promise<void>;

  addToCart: (sku: string) => void;
  addProductToCart: (product: Product) => void;
  removeFromCart: (sku: string) => void;
  updateCartItem: (sku: string, updatedProductData: Partial<Product>) => void;
  clearCart: () => void;
  loadCartFromInvoice: (invoice: Invoice) => void;


  loadGeneratedInvoices: () => void;
  generateInvoice: (
    customerInfo: { id?: string; name: string; phone?: string },
    invoiceRates: Partial<Settings>,
    discountAmount: number,
    exchangeInfo?: { description: string; amount1: number; amount2: number },
    existingInvoiceId?: string,
    delivery?: DeliveryInfo,
    takenBy?: TakenBy,
    hideRates?: boolean,
    internalNote?: string
  ) => Promise<Invoice | null>;
  updateInvoicePayment: (invoiceId: string, paymentAmount: number, paymentDate: string, method?: PaymentType, reference?: string) => Promise<Invoice | null>;
  refundInvoicePartial: (invoiceId: string, refundAmount: number, reason?: string) => Promise<Invoice | null>;
  updateInvoiceDiscount: (invoiceId: string, newDiscountAmount: number) => Promise<Invoice | null>;
  syncHisaabOutstandingBalances: () => Promise<void>;
  deleteInvoice: (invoiceId: string, isEditing?: boolean, syncShopify?: boolean) => Promise<void>;
  
  loadOrders: () => void;
  addOrder: (orderData: OrderDataForAdd) => Promise<Order | null>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  updateOrderItemStatus: (orderId: string, itemIndex: number, isCompleted: boolean) => Promise<void>;
  updateOrderItemKarigar: (orderId: string, itemIndex: number, karigarId: string) => Promise<void>;
  updateInvoiceItemKarigar: (invoiceId: string, itemIndex: number, karigarId: string) => Promise<void>;
  updateInvoiceItemStatus: (invoiceId: string, itemIndex: number, isCompleted: boolean) => Promise<void>;
  /** Record (or take back) that the piece has physically gone to its karigar. null clears it. */
  updateOrderItemGiven: (orderId: string, itemIndex: number, givenAt: string | null) => Promise<void>;
  updateInvoiceItemGiven: (invoiceId: string, itemIndex: number, givenAt: string | null) => Promise<void>;
  setKarigarJobGiven: (id: string, givenAt: string | null) => Promise<void>;
  updateOrderItemDetails: (orderId: string, itemIndex: number, patch: {
    description?: string; size?: string; stoneDetails?: string; diamondDetails?: string;
    adminNote?: string; referenceSku?: string; estimatedWeightG?: number; sampleImageDataUri?: string;
  }) => Promise<void>;
  assignOrderItemsToKarigar: (orderId: string, karigarId: string, onlyUnassigned?: boolean) => Promise<void>;
  /** Internal: the status a Pending order should take once every piece is assigned. */
  _statusAfterAssign: (order: Order, items: OrderItem[]) => OrderStatus | null;
  removeItemFromOrder: (orderId: string, itemIndex: number) => Promise<void>;
  updateOrder: (orderId: string, updatedOrderData: Partial<Order>) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  generateInvoiceFromOrder: (
    order: Order,
    finalizedItems: FinalizedOrderItemData[],
    additionalDiscount: number
  ) => Promise<Invoice | null>;
  revertOrderFromInvoice: (orderId: string, invoiceId: string) => Promise<void>;
  refundOrder: (orderId: string) => Promise<void>;
  recordOrderAdvance: (orderId: string, amount: number, notes: string) => Promise<Order | null>;

  loadHisaab: () => void;
  addHisaabEntry: (entryData: Omit<HisaabEntry, 'id'>) => Promise<HisaabEntry | null>;
  deleteHisaabEntry: (entryId: string) => Promise<void>;
  
  loadExpenses: () => void;
  addExpense: (expenseData: Omit<Expense, 'id'>) => Promise<Expense | null>;
  updateExpense: (id: string, updatedExpenseData: Partial<Omit<Expense, 'id'>>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;

  loadAdditionalRevenues: () => void;
  addAdditionalRevenue: (data: Omit<AdditionalRevenue, 'id'>) => Promise<AdditionalRevenue | null>;
  updateAdditionalRevenue: (id: string, data: Partial<Omit<AdditionalRevenue, 'id'>>) => Promise<void>;
  deleteAdditionalRevenue: (id: string) => Promise<void>;

  loadKarigarJobs: () => void;
  addKarigarJob: (data: Omit<KarigarJob, 'id'>) => Promise<KarigarJob | null>;
  updateKarigarJob: (id: string, data: Partial<Omit<KarigarJob, 'id'>>) => Promise<void>;
  deleteKarigarJob: (id: string) => Promise<void>;
  setKarigarJobStatus: (id: string, status: KarigarJobStatus) => Promise<void>;
  loadGivenItems: () => void;
  addGivenItem: (data: Omit<GivenItem, 'id'>) => Promise<GivenItem | null>;
  updateGivenItem: (id: string, data: Partial<Omit<GivenItem, 'id'>>) => Promise<void>;
  deleteGivenItem: (id: string) => Promise<void>;
  markGivenItemReturned: (id: string, returnedDate: string) => Promise<void>;
  loadRepairs: () => void;
  /** Writes the repair, and its advance (if any) to Extra Revenue, in one transaction. */
  addRepair: (data: Omit<Repair, 'id' | 'payments' | 'status'> & { advance?: number; advanceMethod?: PaymentType }) => Promise<Repair>;
  updateRepair: (id: string, data: Partial<Omit<Repair, 'id' | 'payments'>>) => Promise<void>;
  setRepairStatus: (id: string, status: RepairStatus, extra?: Partial<Pick<Repair, 'charge' | 'weightOutG' | 'karigarId' | 'karigarName' | 'karigarCost'>>) => Promise<void>;
  recordRepairPayment: (id: string, payment: Omit<RepairPayment, 'revenueId'>) => Promise<void>;
  /** Deletes the repair and the Extra Revenue rows its payments wrote. */
  deleteRepair: (id: string) => Promise<void>;

  loadActivityLog: () => void;
  addPrintHistory: (sku: string) => void;
}

export type EnrichedCartItem = Product & {
  quantity: number; // Always 1
  totalPrice: number; // Price for one unit at current store rates
  lineItemTotal: number; // totalPrice * quantity
};

const ssrDummyStorage: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, };

// Helper function to recursively remove undefined values from an object
function cleanObject<T extends object>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // If it's an array, map over it and clean each item
  if (Array.isArray(obj)) {
    // @ts-ignore
    return obj.map(item => cleanObject(item));
  }
  
  const newObj: { [key: string]: any } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== undefined) {
        newObj[key] = (typeof value === 'object' && value !== null) ? cleanObject(value) : value;
      }
    }
  }
  return newObj as T;
}

const createDataLoader = <T, K extends keyof AppState>(
  collectionName: string,
  stateKey: K,
  loadingKey: 'isProductsLoading' | 'isCustomersLoading' | 'isKarigarsLoading' | 'isKarigarBatchesLoading' | 'isSilverTransactionsLoading' | 'isInvoicesLoading' | 'isOrdersLoading' | 'isHisaabLoading' | 'isExpensesLoading' | 'isAdditionalRevenueLoading' | 'isGivenItemsLoading' | 'isRepairsLoading' | 'isKarigarJobsLoading' | 'isSoldProductsLoading' | 'isActivityLogLoading',
  errorKey: 'productsError' | 'customersError' | 'karigarsError' | 'karigarBatchesError' | 'silverTransactionsError' | 'invoicesError' | 'ordersError' | 'hisaabError' | 'expensesError' | 'additionalRevenueError' | 'givenItemsError' | 'repairsError' | 'karigarJobsError' | 'soldProductsError' | 'activityLogError',
  loadedKey: 'hasProductsLoaded' | 'hasCustomersLoaded' | 'hasKarigarsLoaded' | 'hasKarigarBatchesLoaded' | 'hasSilverTransactionsLoaded' | 'hasInvoicesLoaded' | 'hasOrdersLoaded' | 'hasHisaabLoaded' | 'hasExpensesLoaded' | 'hasAdditionalRevenueLoaded' | 'hasGivenItemsLoaded' | 'hasRepairsLoaded' | 'hasKarigarJobsLoaded' | 'hasSoldProductsLoaded' | 'hasActivityLogLoaded',
  orderByField: string = "name",
  orderByDirection: "asc" | "desc" = "asc",
  onData?: (list: T[], get: () => AppState) => void,
  /**
   * Derive extra state from the raw collection, and optionally narrow what lands in
   * stateKey. Used by customers and karigars to keep removed rows out of every list in the
   * app without each list having to remember to filter them.
   */
  transform?: (list: T[]) => Partial<AppState>
) => {
  return (set: (fn: Partial<AppState> | ((state: AppState) => void)) => void, get: () => AppState) => {
    if (get()[loadedKey]) return;

    set({ [loadingKey]: true, [errorKey]: null } as unknown as Partial<AppState>);

    // Shop-floor staff have no Firestore access at all (firestore.rules), so
    // for them this collection is filled from /api/staff/*, which strips the
    // cost side server-side. Polled rather than live: losing realtime is the
    // price of the filter, and a shop needs minutes-fresh, not seconds-fresh.
    if (effectiveRole() === 'staff') {
      attachStaffPoll(collectionName, stateKey, loadingKey, errorKey, loadedKey, orderByField, orderByDirection, set);
      return;
    }

    const q = query(collection(db, collectionName), orderBy(orderByField, orderByDirection));

    const attachListener = (retryCount = 0) => {
      const unsubscribe = onSnapshot(q,
        (serverSnapshot) => {
          const list = serverSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as T));
          
          set({
            [stateKey]: list,
            ...(transform ? transform(list) : {}),
            [loadingKey]: false,
            [loadedKey]: true,
            [errorKey]: null,
          } as unknown as Partial<AppState>);

          const source = serverSnapshot.metadata.fromCache ? "cache" : "server";
          console.log(`[GemsTrack Store] Data for ${collectionName} loaded from ${source}. Count: ${list.length}`);

          if (onData) onData(list, get);
        },
        (error) => {
          // Retry on permission-denied if the user is authenticated — this is a transient
          // timing issue where the Firestore SDK hasn't received the auth token yet.
          if (error.code === 'permission-denied' && auth.currentUser && retryCount < 4) {
            const delay = 500 * Math.pow(2, retryCount); // 500ms, 1s, 2s, 4s
            console.warn(`[GemsTrack Store] permission-denied on ${collectionName}, retrying in ${delay}ms (attempt ${retryCount + 1})`);
            setTimeout(() => attachListener(retryCount + 1), delay);
            return;
          }
          console.error(`[GemsTrack Store] Error in ${collectionName} real-time listener:`, error);
          set({
            [loadingKey]: false,
            [errorKey]: error.message || (`Failed to listen for ${collectionName} updates.`),
          } as unknown as Partial<AppState>);
        }
      );
    };

    attachListener();
  };
};

/**
 * Post one named operation to the staff write path.
 *
 * Returns false when the caller is not staff, so a write function can branch
 * with `if (await staffWrite(...)) return;` and leave the owner path below
 * completely untouched.
 */
async function staffWriteJson(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await auth?.currentUser?.getIdToken();
  const res = await fetch('/api/staff/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(devRole() && { [DEV_ROLE_HEADER]: 'staff' }) },
    body: JSON.stringify({ op, ...payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not save (HTTP ${res.status})`);
  }
  return res.json();
}

async function staffWrite(op: string, payload: Record<string, unknown>): Promise<boolean> {
  if (effectiveRole() !== 'staff') return false;
  const token = await auth?.currentUser?.getIdToken();
  const res = await fetch('/api/staff/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(devRole() && { [DEV_ROLE_HEADER]: 'staff' }) },
    body: JSON.stringify({ op, ...payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not save (HTTP ${res.status})`);
  }
  return true;
}

/**
 * The staff read path: poll /api/staff/collections instead of listening.
 *
 * A collection staff are not allowed settles as an empty list rather than
 * erroring or spinning — the pages that use it are not reachable for them
 * anyway, and a permanent spinner in the corner of an app is worse than an
 * empty one.
 *
 * `onData` is deliberately NOT run here. Those callbacks write back to
 * Firestore (the customer phone normalisation, for one), which staff cannot do
 * and should not trigger.
 */
function attachStaffPoll(
  collectionName: string,
  stateKey: string,
  loadingKey: string,
  errorKey: string,
  loadedKey: string,
  orderByField: string,
  orderByDirection: 'asc' | 'desc',
  set: (fn: Partial<AppState> | ((state: AppState) => void)) => void,
) {
  const settle = (list: unknown[], error: string | null = null) =>
    set({
      [stateKey]: list, [loadingKey]: false, [loadedKey]: true, [errorKey]: error,
    } as unknown as Partial<AppState>);

  if (!isStaffCollection(collectionName)) { settle([]); return; }

  const dir = orderByDirection === 'desc' ? -1 : 1;
  const sortByField = (list: Record<string, unknown>[]) =>
    [...list].sort((a, b) => {
      const x = a?.[orderByField], y = b?.[orderByField];
      if (x === y) return 0;
      if (x === undefined || x === null) return 1;
      if (y === undefined || y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    });

  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) return;                       // signed out mid-flight
      const res = await fetch(`/api/staff/collections?name=${encodeURIComponent(collectionName)}`, {
        headers: { Authorization: `Bearer ${token}`, ...(devRole() && { [DEV_ROLE_HEADER]: 'staff' }) },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { docs } = await res.json();
      settle(sortByField(Array.isArray(docs) ? docs : []));
    } catch (e) {
      // Keep whatever is already on screen; a dropped poll is not a reason to
      // blank the order the operator is reading.
      console.error(`[GemsTrack Store] staff poll failed for ${collectionName}`, e);
      set({ [loadingKey]: false, [loadedKey]: true } as unknown as Partial<AppState>);
    }
  };

  void tick();
  const id = setInterval(tick, STAFF_POLL_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { stopped = true; clearInterval(id); });
  }
}

/** Slow enough not to hammer the API, fast enough for a shop counter. */
const STAFF_POLL_MS = 25_000;

const loadProducts = createDataLoader<Product, 'products'>('products', 'products', 'isProductsLoading', 'productsError', 'hasProductsLoaded', 'sku', 'asc');
// Runs once per session, the first time customers are loaded: silently rewrites any
// legacy phone numbers that lack a country code to E.164 (+92 default). Idempotent —
// after the first pass every stored number already matches, so it never writes again.
let hasNormalizedCustomerPhones = false;
let voiceAliasesAttached = false;
/**
 * Removal hides a person; it does not destroy them.
 *
 * Split here, at the one place the collection arrives, rather than in each list that shows
 * it. Every screen that reads `customers` gets the live book for free, and a screen added
 * later cannot forget to exclude somebody who was removed last week.
 */
const splitRemoved = <T extends { deletedAt?: string }>(list: T[]) => ({
  live: list.filter((r) => !r.deletedAt),
  removed: list.filter((r) => Boolean(r.deletedAt)),
});

const loadCustomers = createDataLoader<Customer, 'customers'>(
  'customers', 'customers', 'isCustomersLoading', 'customersError', 'hasCustomersLoaded', 'name', 'asc',
  (list, get) => {
    if (hasNormalizedCustomerPhones) return;
    if (get().settings?.databaseLocked) return;
    const needsFix = list.some((c) => {
      const n = normalizePhoneNumber(c.phone);
      return n && n !== (c.phone || '');
    });
    hasNormalizedCustomerPhones = true;
    if (!needsFix) return;
    get().normalizeCustomerPhones().catch((err) => {
      console.error('[GemsTrack Store] Auto phone normalization failed:', err);
      hasNormalizedCustomerPhones = false; // allow a retry on the next load
    });
  },
  (list) => {
    const { live, removed } = splitRemoved(list);
    return { customers: live, removedCustomers: removed };
  }
);
const loadKarigars = createDataLoader<Karigar, 'karigars'>(
  'karigars', 'karigars', 'isKarigarsLoading', 'karigarsError', 'hasKarigarsLoaded', 'name', 'asc',
  undefined,
  (list) => {
    const { live, removed } = splitRemoved(list);
    return { karigars: live, removedKarigars: removed };
  }
);
const loadKarigarBatches = createDataLoader<KarigarBatch, 'karigarBatches'>('karigar_batches', 'karigarBatches', 'isKarigarBatchesLoading', 'karigarBatchesError', 'hasKarigarBatchesLoaded', 'startDate', 'asc');
const loadSilverTransactions = createDataLoader<SilverTransaction, 'silverTransactions'>('silver_transactions', 'silverTransactions', 'isSilverTransactionsLoading', 'silverTransactionsError', 'hasSilverTransactionsLoaded', 'date', 'desc');
const loadInvoices = createDataLoader<Invoice, 'generatedInvoices'>('invoices', 'generatedInvoices', 'isInvoicesLoading', 'invoicesError', 'hasInvoicesLoaded', 'createdAt', 'desc');
const loadOrders = createDataLoader<Order, 'orders'>('orders', 'orders', 'isOrdersLoading', 'ordersError', 'hasOrdersLoaded', 'createdAt', 'desc');
const loadHisaab = createDataLoader<HisaabEntry, 'hisaabEntries'>('hisaab', 'hisaabEntries', 'isHisaabLoading', 'hisaabError', 'hasHisaabLoaded', 'date', 'desc');
const loadExpenses = createDataLoader<Expense, 'expenses'>('expenses', 'expenses', 'isExpensesLoading', 'expensesError', 'hasExpensesLoaded', 'date', 'desc');
const loadAdditionalRevenues = createDataLoader<AdditionalRevenue, 'additionalRevenues'>('additional_revenue', 'additionalRevenues', 'isAdditionalRevenueLoading', 'additionalRevenueError', 'hasAdditionalRevenueLoaded', 'date', 'desc');
const loadGivenItems = createDataLoader<GivenItem, 'givenItems'>('given_items', 'givenItems', 'isGivenItemsLoading', 'givenItemsError', 'hasGivenItemsLoaded', 'date', 'desc');
const loadRepairs = createDataLoader<Repair, 'repairs'>('repairs', 'repairs', 'isRepairsLoading', 'repairsError', 'hasRepairsLoaded', 'receivedAt', 'desc');
const loadKarigarJobs = createDataLoader<KarigarJob, 'karigarJobs'>('karigar_jobs', 'karigarJobs', 'isKarigarJobsLoading', 'karigarJobsError', 'hasKarigarJobsLoaded', 'assignedDate', 'desc');
const loadSoldProducts = createDataLoader<Product, 'soldProducts'>('sold_products', 'soldProducts', 'isSoldProductsLoading', 'soldProductsError', 'hasSoldProductsLoaded', 'sku', 'asc');
const loadActivityLog = createDataLoader<ActivityLog, 'activityLog'>('activity_log', 'activityLog', 'isActivityLogLoading', 'activityLogError', 'hasActivityLogLoaded', 'timestamp', 'desc');


export const useAppStore = create<AppState>()(
  persist(
    immer((set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (hydrated) => {
        set({
          _hasHydrated: hydrated,
        });
      },
      settings: initialSettingsData, // Fallback, will be overwritten by loadSettings
      categories: staticCategories, // Categories remain local for now
      products: [],
      soldProducts: [],
      customers: [],
      removedCustomers: [],
      cart: [], // This will be persisted
      generatedInvoices: [],
      karigars: [],
      removedKarigars: [],
      voiceAliases: [],
      karigarBatches: [],
      silverTransactions: [],
      orders: [],
      hisaabEntries: [],
      expenses: [],
      additionalRevenues: [],
      givenItems: [],
      repairs: [],
      karigarJobs: [],
      activityLog: [],
      printHistory: [],

      isSettingsLoading: true,
      isProductsLoading: true,
      isSoldProductsLoading: true,
      isCustomersLoading: true,
      isKarigarsLoading: true,
      isKarigarBatchesLoading: true,
      isSilverTransactionsLoading: true,
      isInvoicesLoading: true,
      isOrdersLoading: true,
      isHisaabLoading: true,
      isExpensesLoading: true,
      isAdditionalRevenueLoading: true,
      isGivenItemsLoading: true,
      isRepairsLoading: true,
      isKarigarJobsLoading: true,
      isActivityLogLoading: true,
      
      hasSettingsLoaded: false,
      hasProductsLoaded: false,
      hasSoldProductsLoaded: false,
      hasCustomersLoaded: false,
      hasKarigarsLoaded: false,
      hasKarigarBatchesLoaded: false,
      hasSilverTransactionsLoaded: false,
      hasInvoicesLoaded: false,
      hasOrdersLoaded: false,
      hasHisaabLoaded: false,
      hasExpensesLoaded: false,
      hasAdditionalRevenueLoaded: false,
      hasGivenItemsLoaded: false,
      hasRepairsLoaded: false,
      hasKarigarJobsLoaded: false,
      hasActivityLogLoaded: false,

      settingsError: null,
      productsError: null,
      soldProductsError: null,
      customersError: null,
      invoicesError: null,
      ordersError: null,
      karigarsError: null,
      karigarBatchesError: null,
      silverTransactionsError: null,
      hisaabError: null,
      expensesError: null,
      additionalRevenueError: null,
      givenItemsError: null,
      repairsError: null,
      karigarJobsError: null,
      activityLogError: null,


      loadSettings: async () => {
        if (get().hasSettingsLoaded) return;
        set({ isSettingsLoading: true, settingsError: null });

        // Staff cannot read this document either, and the whole app gates on
        // it — appReady never turns true without settings, so without this
        // branch a staff sign-in lands on a spinner that never resolves.
        if (effectiveRole() === 'staff') {
          const pull = async () => {
            try {
              const token = await auth?.currentUser?.getIdToken();
              if (!token) return;
              const res = await fetch('/api/staff/collections?name=settings', {
                headers: { Authorization: `Bearer ${token}`, ...(devRole() && { [DEV_ROLE_HEADER]: 'staff' }) }, cache: 'no-store',
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const { doc: fields } = await res.json();
              set({
                settings: { ...initialSettingsData, ...(fields || {}) } as Settings,
                isSettingsLoading: false, hasSettingsLoaded: true, settingsError: null,
              });
            } catch (e) {
              console.error('[GemsTrack Store] staff settings fetch failed', e);
              // Fall back to defaults rather than stranding the app: wrong
              // rates are visible and correctable, a permanent spinner is not.
              set({
                settings: initialSettingsData as Settings,
                isSettingsLoading: false, hasSettingsLoaded: true,
                settingsError: 'Could not load shop settings.',
              });
            }
          };
          void pull();
          setInterval(pull, STAFF_POLL_MS);
          return;
        }

        const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
        
        onSnapshot(settingsDocRef,
            (docSnap) => {
                let loadedSettings: Settings;
                if (docSnap.exists()) {
                    const firestoreSettings = docSnap.data() as Partial<Settings>;
                    loadedSettings = {
                        ...initialSettingsData,
                        ...firestoreSettings,
                        firebaseConfig: firebaseConfig,
                        allowedDeviceIds: Array.isArray(firestoreSettings.allowedDeviceIds) ? firestoreSettings.allowedDeviceIds : [],
                        weprintApiSkus: Array.isArray(firestoreSettings.weprintApiSkus) ? firestoreSettings.weprintApiSkus : [],
                        paymentMethods: Array.isArray(firestoreSettings.paymentMethods) ? firestoreSettings.paymentMethods : [],
                        theme: firestoreSettings.theme || 'slate',
                    };
                } else {
                    console.log("[GemsTrack Store loadSettings] No settings found, creating with initial data.");
                    const settingsWithConfig = { ...initialSettingsData, firebaseConfig: firebaseConfig };
                    setDoc(settingsDocRef, settingsWithConfig); // set and forget
                    loadedSettings = settingsWithConfig;
                }

                if (loadedSettings.databaseLocked) {
                    set({ settingsError: "Database access is locked by an administrator." });
                }

                // Self-healing: if the invoice counter is 0 or missing, scan actual
                // invoices to recalibrate so the first new invoice never overwrites
                // a real historical record.
                if (!loadedSettings.lastInvoiceNumber) {
                    getDocs(collection(db, FIRESTORE_COLLECTIONS.INVOICES))
                        .then(snap => {
                            let maxNum = 0;
                            snap.forEach(d => {
                                const match = d.id.match(/^INV-(\d+)$/);
                                if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
                            });
                            if (maxNum > 0) {
                                console.warn(`[loadSettings] lastInvoiceNumber was 0/missing — recalibrating to ${maxNum}`);
                                updateDoc(settingsDocRef, { lastInvoiceNumber: maxNum }).catch(console.error);
                            }
                        })
                        .catch(console.error);
                }

                // Self-healing: if the order counter is 0 or missing (or stale/lower
                // than actual max), scan orders and recalibrate to prevent collisions.
                if (!loadedSettings.lastOrderNumber) {
                    getDocs(collection(db, FIRESTORE_COLLECTIONS.ORDERS))
                        .then(snap => {
                            let maxNum = 0;
                            snap.forEach(d => {
                                const match = d.id.match(/^ORD-(\d+)$/);
                                if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
                            });
                            if (maxNum > 0) {
                                console.warn(`[loadSettings] lastOrderNumber was 0/missing — recalibrating to ${maxNum}`);
                                updateDoc(settingsDocRef, { lastOrderNumber: maxNum }).catch(console.error);
                            }
                        })
                        .catch(console.error);
                }

                set((state) => {
                    state.settings = loadedSettings;
                    state.isSettingsLoading = false;
                    state.hasSettingsLoaded = true;
                    state.settingsError = null;
                });
                console.log("[GemsTrack Store loadSettings] Real-time settings update received.");
            },
            (error: any) => {
                console.error("[GemsTrack Store loadSettings] Error in real-time listener:", error);
                set({
                    settingsError: error.message || 'Failed to connect to settings database.',
                    isSettingsLoading: false,
                    hasSettingsLoaded: true, // Mark as loaded even on error to unblock UI
                    settings: initialSettingsData, // Fallback
                });
            }
        );
      },
      updateSettings: async (newSettings) => {
        const {databaseLocked} = get().settings;
        if(databaseLocked) {
            console.warn("[updateSettings] Blocked: Database is locked.");
            return;
        }

        const currentSettings = get().settings;
        console.log("[GemsTrack Store updateSettings] Attempting to update settings:", newSettings);
        
        // Optimistic update: merge in-memory
        set((state) => { state.settings = { ...state.settings, ...newSettings }; });

        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          // Write only the delta (newSettings) — merge:true ensures other fields are preserved.
          // Never spread currentSettings into the write: stale in-memory defaults could overwrite real Firestore values.
          await setDoc(settingsDocRef, cleanObject(newSettings), { merge: true });
          console.log("[GemsTrack Store updateSettings] Settings updated successfully in Firestore.");
        } catch (error) {
          console.error("[GemsTrack Store updateSettings] Error updating settings in Firestore:", error);
          // Revert on error to keep UI consistent with the database
          set((state) => { state.settings = currentSettings; });
          throw error;
        }
      },

      addCategory: (title) => set((state) => {
          // A category typed in at runtime has no hand-written singular; a plain trailing s
          // is the best guess available, and the bill falls back to the title if that is wrong.
          const newCategory: Category = { id: `cat-${Date.now()}`, title, singular: title.replace(/s$/, '') };
          state.categories.push(newCategory);
          console.log("[GemsTrack Store addCategory] Added category:", newCategory);
      }),
      updateCategory: (id, title) => set((state) => {
          const category = state.categories.find((c) => c.id === id);
          if (category) category.title = title;
          console.log("[GemsTrack Store updateCategory] Updated category:", category);
      }),
      deleteCategory: (id) => set((state) => {
          state.categories = state.categories.filter((c) => c.id !== id);
          console.log("[GemsTrack Store deleteCategory] Deleted category with ID:", id);
      }),

      loadProducts: () => loadProducts(set, get),
      loadSoldProducts: () => loadSoldProducts(set, get),
      loadCustomers: () => loadCustomers(set, get),
      loadKarigars: () => loadKarigars(set, get),
      loadKarigarBatches: () => loadKarigarBatches(set, get),
      loadSilverTransactions: () => loadSilverTransactions(set, get),
      addSilverTransaction: async (data) => {
        if (get().settings.databaseLocked) return null;
        try {
          // Strip undefined fields — Firestore addDoc rejects them
          const payload = cleanObject({ ...data });
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.SILVER_TRANSACTIONS), payload);
          return { id: docRef.id, ...data };
        } catch (error) {
          console.error("[addSilverTransaction] Error:", error);
          return null;
        }
      },
      deleteSilverTransaction: async (id) => {
        if (get().settings.databaseLocked) return;
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.SILVER_TRANSACTIONS, id));
        } catch (error) {
          console.error("[deleteSilverTransaction] Error:", error);
          throw error;
        }
      },
      loadGeneratedInvoices: () => loadInvoices(set, get),
      loadOrders: () => loadOrders(set, get),
      loadHisaab: () => loadHisaab(set, get),
      loadExpenses: () => loadExpenses(set, get),
      loadAdditionalRevenues: () => loadAdditionalRevenues(set, get),
      loadGivenItems: () => loadGivenItems(set, get),
      loadRepairs: () => loadRepairs(set, get),
      loadKarigarJobs: () => loadKarigarJobs(set, get),
      loadActivityLog: () => loadActivityLog(set, get),

       reAddSoldProductToInventory: async (soldProduct) => {
        console.log(`[reAddSoldProductToInventory] Attempting to re-add based on SKU: ${soldProduct?.sku}`);
        if (!soldProduct) {
             throw new Error(`Sold product not found.`);
        }
        // Create a new product object, omitting the SKU, and add it.
        const { sku, qrCodeDataUrl, ...productDataForAdd } = soldProduct;
        const newProduct = await get().addProduct(productDataForAdd);
        if (!newProduct) {
            throw new Error("Failed to create a new product in the inventory from the sold item.");
        }
        console.log(`[reAddSoldProductToInventory] Successfully re-added product with new SKU: ${newProduct.sku}`);
        return newProduct;
    },
      addProduct: async (productData) => {
        if(get().settings.databaseLocked) return null;
        const { categories, products } = get();
        const category = categories.find(c => c.id === productData.categoryId);
        if (!category) {
          console.error(`[GemsTrack Store addProduct] Category with id ${productData.categoryId} not found.`);
          return null;
        }
        const prefix = CATEGORY_SKU_PREFIXES[productData.categoryId] || "XXX";
        let maxNum = 0;
        products.forEach(p => {
          if (p.sku.startsWith(prefix + "-")) {
            const numPart = parseInt(p.sku.substring(prefix.length + 1), 10);
            if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
          }
        });
        const newNum = (maxNum + 1).toString().padStart(6, '0');
        const generatedSku = `${prefix}-${newNum}`;
        
        let autoGeneratedName = productData.name;
        if (productData.isCustomPrice) {
            autoGeneratedName = productData.description || 'Custom Item';
        } else if (!autoGeneratedName) { // Auto-generate name only if not provided and not custom price
            autoGeneratedName = `${category.title} - ${generatedSku}`;
        }
        
        const isActualGoldCoin = productData.categoryId === GOLD_COIN_CATEGORY_ID_INTERNAL && productData.metalType === 'gold';
        
        const partialProduct: Partial<Product> = { 
          ...productData,
          name: autoGeneratedName,
          hasDiamonds: isActualGoldCoin ? false : productData.hasDiamonds,
          diamondCharges: isActualGoldCoin ? 0 : (productData.hasDiamonds ? productData.diamondCharges : 0),
          wastagePercentage: isActualGoldCoin ? 0 : productData.wastagePercentage,
          makingCharges: isActualGoldCoin ? 0 : productData.makingCharges,
          stoneCharges: isActualGoldCoin ? 0 : productData.stoneCharges,
          miscCharges: isActualGoldCoin ? 0 : productData.miscCharges,
        };
        
        if (partialProduct.metalType === 'gold' && !partialProduct.karat) {
          partialProduct.karat = '21k';
        }

        const newProduct: Product = { ...partialProduct, sku: generatedSku } as Product;
        
        const cleanProduct = cleanObject(newProduct);

        console.log("[GemsTrack Store addProduct] Attempting to add product:", cleanProduct);

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, newProduct.sku), cleanProduct);
          await addActivityLog('product.create', `Created product: ${newProduct.name}`, `SKU: ${newProduct.sku}`, newProduct.sku);
          console.log("[GemsTrack Store addProduct] Product added successfully to Firestore:", newProduct.sku);
          // Intentionally NOT pushing products to Shopify — the Shopify product
          // catalog is managed manually. POS products / cart-added items must
          // never auto-create entries in Shopify inventory.
          return newProduct;
        } catch (error) {
          console.error("[GemsTrack Store addProduct] Error adding product to Firestore:", error);
          return null;
        }
      },
      updateProduct: async (sku, updatedProductData) => {
        if(get().settings.databaseLocked) return;
        const productRef = doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku);
        console.log(`[GemsTrack Store updateProduct] Attempting to update product SKU ${sku} with:`, updatedProductData);
        try {
            const currentProduct = get().products.find(p => p.sku === sku);
            if (!currentProduct) throw new Error("Product not found for update");

            const mergedData = {...currentProduct, ...updatedProductData};
            
            const isActualGoldCoin = (mergedData.categoryId) === GOLD_COIN_CATEGORY_ID_INTERNAL && 
                                     (mergedData.metalType) === 'gold';

            let finalUpdatedFields: Partial<Product> = { ...updatedProductData };
            
            if (finalUpdatedFields.isCustomPrice && finalUpdatedFields.description) {
              finalUpdatedFields.name = finalUpdatedFields.description;
            } else if (!finalUpdatedFields.isCustomPrice && !finalUpdatedFields.name) {
                const category = get().categories.find(c => c.id === mergedData.categoryId);
                finalUpdatedFields.name = `${category?.title || 'Item'} - ${sku}`;
            }

            if (isActualGoldCoin) {
                finalUpdatedFields = {
                    ...finalUpdatedFields,
                    hasDiamonds: false, diamondCharges: 0, wastagePercentage: 0,
                    makingCharges: 0, stoneCharges: 0, miscCharges: 0,
                };
            } else {
                 if (updatedProductData.hasDiamonds === false) { finalUpdatedFields.diamondCharges = 0; }
                 if (updatedProductData.metalType && updatedProductData.metalType !== 'gold' && 'karat' in finalUpdatedFields) {
                    finalUpdatedFields.karat = undefined;
                 } else if (updatedProductData.metalType === 'gold' && !finalUpdatedFields.karat) {
                     if (!('karat' in updatedProductData) && !currentProduct.karat) {
                         finalUpdatedFields.karat = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
                    }
                 }
            }
            const { sku: _s, ...payloadToFirestore } = finalUpdatedFields;
            
            const cleanPayload = cleanObject(payloadToFirestore);

            await setDoc(productRef, cleanPayload, { merge: true });
            await addActivityLog('product.update', `Updated product: ${finalUpdatedFields.name || currentProduct.name}`, `SKU: ${sku}`, sku);
            console.log(`[GemsTrack Store updateProduct] Product SKU ${sku} updated successfully.`);
            // Product catalog is managed manually on Shopify — no auto-push.
        } catch (error) {
          console.error(`[GemsTrack Store updateProduct] Error updating product SKU ${sku} in Firestore:`, error);
        }
      },
      deleteProduct: async (sku) => {
        if(get().settings.databaseLocked) return;
        const productName = get().products.find(p => p.sku === sku)?.name || sku;
        console.log(`[GemsTrack Store deleteProduct] Attempting to delete product SKU ${sku}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku));
          set(state => {
            state.cart = state.cart.filter(item => item.sku !== sku);
          });
          await addActivityLog('product.delete', `Deleted product: ${productName}`, `SKU: ${sku}`, sku);
          console.log(`[GemsTrack Store deleteProduct] Product SKU ${sku} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteProduct] Error deleting product SKU ${sku} from Firestore:`, error);
        }
      },
       deleteLatestProducts: async (count: number) => {
            if (get().settings.databaseLocked || count <= 0) return 0;
            console.log(`[deleteLatestProducts] Attempting to delete the latest ${count} products.`);
            try {
                const productsRef = collection(db, FIRESTORE_COLLECTIONS.PRODUCTS);
                const q = query(productsRef, orderBy('__name__', 'desc')); // Firestore sorts document IDs lexicographically.
                const snapshot = await getDocs(q);

                const productsToDelete = snapshot.docs.slice(0, count);

                if (productsToDelete.length === 0) {
                    console.log("[deleteLatestProducts] No products found to delete.");
                    return 0;
                }

                const batch = writeBatch(db);
                productsToDelete.forEach(doc => {
                    batch.delete(doc.ref);
                    addActivityLog('product.delete', `Deleted product: ${doc.data().name}`, `SKU: ${doc.id}`, doc.id);
                });
                await batch.commit();
                
                console.log(`[deleteLatestProducts] Successfully deleted ${productsToDelete.length} products.`);
                return productsToDelete.length;
            } catch (error) {
                console.error("[deleteLatestProducts] Error deleting latest products:", error);
                throw error;
            }
        },
       setProductQrCode: async (sku, qrCodeDataUrl) => {
        if(get().settings.databaseLocked) return;
        console.log(`[GemsTrack Store setProductQrCode] Setting QR for SKU ${sku}.`);
        try {
            await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku), { qrCodeDataUrl }, { merge: true });
        } catch (error) {
            console.error(`[GemsTrack Store setProductQrCode] Error saving QR code URL for SKU ${sku} to Firestore:`, error);
        }
      },

      addCustomer: async (customerData) => {
        if(get().settings.databaseLocked) return null;
        const newCustomerId = `cust-${Date.now()}`;
        const newCustomer: Customer = {
          id: newCustomerId,
          name: customerData.name || 'Unnamed Customer',
          phone: normalizePhoneNumber(customerData.phone) || '',
          email: customerData.email || '',
          address: customerData.address || '',
        };
        console.log("[GemsTrack Store addCustomer] Attempting to add customer:", newCustomer);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustomerId), newCustomer);
          await addActivityLog('customer.create', `Created customer: ${newCustomer.name}`, `ID: ${newCustomerId}`, newCustomerId);
          if (typeof window !== 'undefined' && !newCustomerId.startsWith('shopify-')) {
            if (PUSH_TO_SHOPIFY) fetch('/api/shopify/push/customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: newCustomerId }) }).catch(() => {});
          }
          console.log("[GemsTrack Store addCustomer] Customer added successfully:", newCustomerId);
          return newCustomer;
        } catch (error) {
          console.error("[GemsTrack Store addCustomer] Error adding customer to Firestore:", error);
          return null;
        }
      },
      updateCustomer: async (id, updatedCustomerData) => {
        if(get().settings.databaseLocked) return;
        // Normalize phone to E.164 (with country code, default +92) on every save so
        // numbers stay consistent regardless of which form did the edit.
        const dataToWrite = updatedCustomerData.phone !== undefined
          ? { ...updatedCustomerData, phone: normalizePhoneNumber(updatedCustomerData.phone) }
          : updatedCustomerData;
        console.log(`[GemsTrack Store updateCustomer] Attempting to update customer ID ${id} with:`, dataToWrite);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id), dataToWrite, { merge: true });
          await addActivityLog('customer.update', `Updated customer: ${updatedCustomerData.name}`, `ID: ${id}`, id);
          if (typeof window !== 'undefined' && !id.startsWith('shopify-')) {
            if (PUSH_TO_SHOPIFY) fetch('/api/shopify/push/customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: id }) }).catch(() => {});
          }
          console.log(`[GemsTrack Store updateCustomer] Customer ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateCustomer] Error updating customer ID ${id} in Firestore:`, error);
        }
      },
      normalizeCustomerPhones: async () => {
        // One-shot data fix: rewrite every customer's stored phone to E.164 (default +92)
        // so legacy numbers entered without a country code get corrected in place.
        // Writes directly via a batch (no per-row Shopify push) to avoid spamming the
        // sync endpoint, and only touches rows whose number actually changes.
        if (get().settings.databaseLocked) return 0;
        const { customers } = get();
        const batch = writeBatch(db);
        let fixed = 0;
        customers.forEach((c) => {
          const normalized = normalizePhoneNumber(c.phone);
          if (normalized && normalized !== (c.phone || '')) {
            batch.update(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, c.id), { phone: normalized });
            fixed++;
          }
        });
        if (fixed > 0) {
          try {
            await batch.commit();
            await addActivityLog('customer.update', `Normalized ${fixed} customer phone number(s) to international format`, '', '');
          } catch (error) {
            console.error('[GemsTrack Store normalizeCustomerPhones] Error committing phone normalization batch:', error);
            throw error;
          }
        }
        return fixed;
      },
      /**
       * Removing a customer hides them; it does not destroy anything.
       *
       * Their ledger, orders and invoices stay exactly where they are, still pointing at
       * this id, so putting them back restores a complete account rather than a bare name.
       * Settings > Recently removed is the way back, and emptying that list is the only
       * thing in the app that genuinely deletes.
       */
      deleteCustomer: async (id) => {
        if(get().settings.databaseLocked) return;
        const customerName = get().customers.find(c => c.id === id)?.name || id;
        try {
          await updateDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id), { deletedAt: new Date().toISOString() });
          await addActivityLog('customer.delete', `Removed customer: ${customerName}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store deleteCustomer] Error removing customer ID ${id}:`, error);
          throw error;
        }
      },

      restoreCustomer: async (id) => {
        if(get().settings.databaseLocked) return;
        const customerName = get().removedCustomers.find(c => c.id === id)?.name || id;
        try {
          await updateDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id), { deletedAt: deleteField() });
          await addActivityLog('customer.update', `Restored customer: ${customerName}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store restoreCustomer] Error restoring customer ID ${id}:`, error);
          throw error;
        }
      },

      mergeCustomers: async (keepId, deleteId) => {
        if(get().settings.databaseLocked) return { updatedDocs: 0 };
        const keepCustomer = get().customers.find(c => c.id === keepId);
        const deleteCustomer = get().customers.find(c => c.id === deleteId);
        if (!keepCustomer || !deleteCustomer) throw new Error('One or both customers not found');

        let updatedDocs = 0;
        const BATCH_LIMIT = 490;

        const flushBatch = async (batch: ReturnType<typeof writeBatch>) => {
          await batch.commit();
        };

        let batch = writeBatch(db);
        let opCount = 0;

        const addOp = async (op: () => void) => {
          op();
          opCount++;
          if (opCount >= BATCH_LIMIT) {
            await flushBatch(batch);
            batch = writeBatch(db);
            opCount = 0;
          }
        };

        // Update invoices
        const invoicesSnap = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.INVOICES), where('customerId', '==', deleteId)));
        for (const d of invoicesSnap.docs) {
          await addOp(() => batch.update(d.ref, { customerId: keepId, customerName: keepCustomer.name }));
          updatedDocs++;
        }

        // Update orders
        const ordersSnap = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.ORDERS), where('customerId', '==', deleteId)));
        for (const d of ordersSnap.docs) {
          await addOp(() => batch.update(d.ref, { customerId: keepId, customerName: keepCustomer.name }));
          updatedDocs++;
        }

        // Update hisaab entries
        const hisaabSnap = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.HISAAB), where('entityId', '==', deleteId), where('entityType', '==', 'customer')));
        for (const d of hisaabSnap.docs) {
          await addOp(() => batch.update(d.ref, { entityId: keepId, entityName: keepCustomer.name }));
          updatedDocs++;
        }

        // Update given items
        const givenSnap = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS), where('recipientId', '==', deleteId)));
        for (const d of givenSnap.docs) {
          await addOp(() => batch.update(d.ref, { recipientId: keepId, recipientName: keepCustomer.name }));
          updatedDocs++;
        }

        // Delete the duplicate customer
        await addOp(() => batch.delete(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, deleteId)));

        if (opCount > 0) await flushBatch(batch);

        await addActivityLog('customer.delete', `Merged customer "${deleteCustomer.name}" into "${keepCustomer.name}"`, `Deleted ID: ${deleteId}, Kept ID: ${keepId}, Updated ${updatedDocs} records`, keepId);

        return { updatedDocs };
      },


      addKarigar: async (karigarData) => {
        if(get().settings.databaseLocked) return null;
        const newKarigarId = `karigar-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        const newKarigar: Karigar = { ...karigarData, id: newKarigarId };
        console.log("[GemsTrack Store addKarigar] Attempting to add karigar:", newKarigar);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, newKarigarId), newKarigar);
          await addActivityLog('karigar.create', `Created karigar: ${newKarigar.name}`, `ID: ${newKarigarId}`, newKarigarId);
          console.log("[GemsTrack Store addKarigar] Karigar added successfully:", newKarigarId);
          return newKarigar;
        } catch (error) {
          console.error("[GemsTrack Store addKarigar] Error adding karigar to Firestore:", error);
          return null;
        }
      },
      updateKarigar: async (id, updatedKarigarData) => {
        if(get().settings.databaseLocked) return;
        console.log(`[GemsTrack Store updateKarigar] Attempting to update karigar ID ${id} with:`, updatedKarigarData);
         try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id), updatedKarigarData, { merge: true });
          await addActivityLog('karigar.update', `Updated karigar: ${updatedKarigarData.name}`, `ID: ${id}`, id);
          console.log(`[GemsTrack Store updateKarigar] Karigar ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateKarigar] Error updating karigar ID ${id} in Firestore:`, error);
        }
      },
      /** See deleteCustomer — this hides, it does not destroy. */
      deleteKarigar: async (id) => {
        if(get().settings.databaseLocked) return;
        const karigarName = get().karigars.find(k => k.id === id)?.name || id;
        try {
          await updateDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id), { deletedAt: new Date().toISOString() });
          await addActivityLog('karigar.delete', `Removed karigar: ${karigarName}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store deleteKarigar] Error removing karigar ID ${id}:`, error);
          throw error;
        }
      },

      restoreKarigar: async (id) => {
        if(get().settings.databaseLocked) return;
        const karigarName = get().removedKarigars.find(k => k.id === id)?.name || id;
        try {
          await updateDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id), { deletedAt: deleteField() });
          await addActivityLog('karigar.update', `Restored karigar: ${karigarName}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store restoreKarigar] Error restoring karigar ID ${id}:`, error);
          throw error;
        }
      },

      /**
       * Empty the Recently removed list for good.
       *
       * This is the one place a record actually leaves the database. Everything else in the
       * app that says "delete" only sets deletedAt, which is why this is worth confirming
       * loudly and counting out loud before it runs.
       */
      purgeRemoved: async () => {
        if(get().settings.databaseLocked) return { customers: 0, karigars: 0 };
        const customers = get().removedCustomers;
        const karigars = get().removedKarigars;
        for (const c of customers) await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, c.id));
        for (const k of karigars) await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, k.id));
        if (customers.length || karigars.length) {
          await addActivityLog(
            'customer.delete',
            `Permanently deleted ${customers.length} customer(s) and ${karigars.length} karigar(s)`,
            'Emptied Recently removed',
            'recently-removed',
          );
        }
        return { customers: customers.length, karigars: karigars.length };
      },

      /**
       * The names this shop has already corrected once.
       *
       * Small, read on every voice turn, and worth having in memory rather than fetched
       * mid-sentence — so it rides the same real-time listener as everything else.
       */
      loadVoiceAliases: () => {
        if (voiceAliasesAttached) return;
        voiceAliasesAttached = true;
        try {
          onSnapshot(
            query(collection(db, FIRESTORE_COLLECTIONS.VOICE_ALIASES), orderBy('createdAt', 'desc')),
            (snap) => set({ voiceAliases: snap.docs.map((d) => ({ ...d.data(), id: d.id } as VoiceAlias)) }),
            (error) => {
              console.error('[GemsTrack Store] voice_aliases listener:', error);
              voiceAliasesAttached = false; // allow a retry
            },
          );
        } catch (error) {
          console.error('[GemsTrack Store loadVoiceAliases]', error);
          voiceAliasesAttached = false;
        }
      },

      /**
       * Being told once should be enough, and it is only enough if it is written down.
       *
       * Keyed on the SOUND of what was heard rather than its spelling, so the correction
       * survives the transcriber spelling it differently the next time — which it will.
       */
      teachVoiceAlias: async (heard, kind, refId, refName) => {
        if (get().settings.databaseLocked) return;
        const key = phoneticKey(heard).join(' ');
        if (!key) return;
        const existing = get().voiceAliases.find(
          (a) => a.heardKey === key && a.kind === kind && a.refId === refId,
        );
        try {
          if (existing) {
            // Same correction again — count it rather than filling the list with duplicates.
            await updateDoc(doc(db, FIRESTORE_COLLECTIONS.VOICE_ALIASES, existing.id), {
              uses: (existing.uses ?? 1) + 1,
            });
            return;
          }
          await addDoc(collection(db, FIRESTORE_COLLECTIONS.VOICE_ALIASES), cleanObject({
            heard: String(heard).slice(0, 120),
            heardKey: key,
            kind,
            refId,
            refName,
            uses: 1,
            createdAt: new Date().toISOString(),
          }));
        } catch (error) {
          console.error('[GemsTrack Store teachVoiceAlias]', error);
        }
      },

      forgetVoiceAlias: async (id) => {
        if (get().settings.databaseLocked) return;
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.VOICE_ALIASES, id));
        } catch (error) {
          console.error('[GemsTrack Store forgetVoiceAlias]', error);
          throw error;
        }
      },

      createKarigarBatch: async (data) => {
        if(get().settings.databaseLocked) return null;
        try {
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.KARIGAR_BATCHES), data);
          const newBatch: KarigarBatch = { id: docRef.id, ...data };
          set(state => { state.karigarBatches.push(newBatch); });
          return newBatch;
        } catch (error) {
          console.error('[GemsTrack Store createKarigarBatch] Error:', error);
          return null;
        }
      },

      closeKarigarBatch: async (batchId, closedDate, totalPaid) => {
        if(get().settings.databaseLocked) return;
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGAR_BATCHES, batchId), { closedDate, totalPaid }, { merge: true });
          set(state => {
            const idx = state.karigarBatches.findIndex(b => b.id === batchId);
            if (idx !== -1) {
              state.karigarBatches[idx].closedDate = closedDate;
              state.karigarBatches[idx].totalPaid = totalPaid;
            }
          });
        } catch (error) {
          console.error('[GemsTrack Store closeKarigarBatch] Error:', error);
          throw error;
        }
      },

      deleteKarigarBatch: async (batchId) => {
        if(get().settings.databaseLocked) return;
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGAR_BATCHES, batchId));
          set(state => { state.karigarBatches = state.karigarBatches.filter(b => b.id !== batchId); });
        } catch (error) {
          console.error('[GemsTrack Store deleteKarigarBatch] Error:', error);
          throw error;
        }
      },

      addToCart: (sku) => set((state) => {
          const existingItem = state.cart.find((item) => item.sku === sku);
          if (!existingItem) {
            const productToAdd = state.products.find(p => p.sku === sku);
            if(productToAdd) {
                state.cart.push({ ...productToAdd, quantity: 1 });
            }
          }
      }),
      addProductToCart: (product) => set((state) => {
          const existingItem = state.cart.find((item) => item.sku === product.sku);
          if (!existingItem) {
              state.cart.push({ ...product, quantity: 1 });
          }
      }),
      removeFromCart: (sku) => set((state) => { state.cart = state.cart.filter((item) => item.sku !== sku); }),
      updateCartItem: (sku, updatedProductData) => set(state => {
        const cartIndex = state.cart.findIndex(item => item.sku === sku);
        if (cartIndex !== -1) {
            state.cart[cartIndex] = { ...state.cart[cartIndex], ...updatedProductData };
        }
      }),
      clearCart: () => set((state) => { state.cart = []; }),
      loadCartFromInvoice: (invoice) => set(state => {
        state.cart = invoice.items.map(item => {
            // Treat both isCustomPrice (product-based) and isManualPrice (order-based)
            // as manual price overrides so the original price is preserved.
            const hasManualPrice = !!(item.isCustomPrice || item.isManualPrice);
            return {
                sku: item.sku,
                name: item.name,
                categoryId: item.categoryId,
                metalType: item.metalType,
                karat: item.karat,
                metalWeightG: item.metalWeightG,
                secondaryMetalType: undefined, // These fields are not on InvoiceItem
                secondaryMetalKarat: undefined,
                secondaryMetalWeightG: undefined,
                hasStones: !!item.stoneChargesIfAny,
                stoneWeightG: item.stoneWeightG,
                wastagePercentage: item.wastagePercentage,
                makingCharges: item.makingCharges,
                hasDiamonds: !!item.diamondChargesIfAny,
                diamondCharges: item.diamondChargesIfAny,
                stoneCharges: item.stoneChargesIfAny,
                miscCharges: item.miscChargesIfAny,
                stoneDetails: item.stoneDetails,
                diamondDetails: item.diamondDetails,
                size: item.size,
                // Restore manual price override — without this the price gets
                // recalculated from metal weights giving a different (or zero) total.
                isCustomPrice: hasManualPrice,
                customPrice: hasManualPrice ? item.unitPrice : undefined,
                quantity: 1
            };
        });
      }),

      generateInvoice: async (customerInfo, invoiceRates, discountAmount, exchangeInfo?, existingInvoiceId?, delivery?, takenBy?, hideRates?, internalNote?) => {
        if(get().settings.databaseLocked) return null;
        const { cart } = get();
        if (cart.length === 0) return null;
        console.log("[GemsTrack Store generateInvoice] Starting invoice generation...");

        try {
            const result = await runTransaction(db, async (transaction) => {
                const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);

                // --- READS FIRST, AND TOGETHER ---
                // These used to run one await after another, which cost a full network
                // round-trip each on a counter phone -- the whole reason "Create
                // Invoice" sat there before anything happened. Only the invoice-number
                // check below actually depends on another read; everything else was
                // sequential by habit rather than by need.
                //
                // The cart's product documents were read here too, in parallel, and the
                // result was never looked at -- a round-trip and one billed read per
                // line of the bill, for nothing. Nothing downstream consults the stored
                // product: the invoice is priced from the cart item in hand and
                // sold_products is written from that same object.
                const [settingsDoc, customerDoc, existingInvoiceDoc] = await Promise.all([
                    transaction.get(settingsDocRef),
                    customerInfo.id
                        ? transaction.get(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, customerInfo.id))
                        : Promise.resolve(null),
                    existingInvoiceId
                        ? transaction.get(doc(db, FIRESTORE_COLLECTIONS.INVOICES, existingInvoiceId))
                        : Promise.resolve(null),
                ]);

                if (!settingsDoc.exists()) throw new Error("Global settings not found.");
                const currentSettings = settingsDoc.data() as Settings;

                // Existing invoice: payment history and creation date must survive a re-save.
                let existingAmountPaid = 0;
                let existingPaymentHistory: Payment[] = [];
                let existingCreatedAt: string | undefined;
                let existingInvoiceData: Omit<Invoice, 'id'> | null = null;
                if (existingInvoiceDoc?.exists()) {
                    existingInvoiceData = existingInvoiceDoc.data() as Omit<Invoice, 'id'>;
                    existingAmountPaid = existingInvoiceData.amountPaid || 0;
                    existingPaymentHistory = existingInvoiceData.paymentHistory || [];
                    existingCreatedAt = existingInvoiceData.createdAt;
                }

                // Guard: for new invoices, pre-read the target doc to confirm the counter is not stale.
                // This MUST be done here (before any writes) — Firestore Web SDK forbids reads after writes.
                let nextInvoiceNumber: number | undefined;
                let newInvoiceId: string | undefined;
                if (!existingInvoiceId) {
                    nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
                    newInvoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
                    const targetInvoiceCheck = await transaction.get(doc(db, FIRESTORE_COLLECTIONS.INVOICES, newInvoiceId));
                    if (targetInvoiceCheck.exists()) {
                        throw new Error(`Invoice ${newInvoiceId} already exists — the invoice counter (lastInvoiceNumber=${currentSettings.lastInvoiceNumber}) is stale. Please contact your administrator to recalibrate it.`);
                    }
                }
                
                // --- WRITES SECOND ---
                let finalCustomerId = customerInfo.id;
                let finalCustomerName = customerInfo.name;

                if (!finalCustomerId && customerInfo.name) {
                    // Use a stable ID (not Date.now()) so Firestore transaction retries
                    // don't create duplicate customer documents.
                    const newCustId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                    const newCustomerData: Omit<Customer, 'id'> = { name: customerInfo.name, phone: customerInfo.phone || "", address: '', email: '' };
                    transaction.set(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustId), newCustomerData);
                    finalCustomerId = newCustId;
                } else if (customerDoc?.exists()) {
                    finalCustomerName = customerDoc.data().name;
                }

                const ratesForInvoice = {
                    goldRatePerGram24k: invoiceRates.goldRatePerGram24k ?? 0,
                    goldRatePerGram22k: invoiceRates.goldRatePerGram22k ?? 0,
                    goldRatePerGram21k: invoiceRates.goldRatePerGram21k ?? 0,
                    goldRatePerGram18k: invoiceRates.goldRatePerGram18k ?? 0,
                    palladiumRatePerGram: invoiceRates.palladiumRatePerGram ?? 0,
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
                    if (cartItem.isCustomPrice) itemToAdd.isCustomPrice = true;

                    invoiceItems.push(cleanObject(itemToAdd as InvoiceItem));

                    transaction.set(doc(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS, cartItem.sku), cleanObject(cartItem));
                    transaction.delete(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, cartItem.sku));
                }

                const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
                const exchangeTotal = (exchangeInfo?.amount1 || 0) + (exchangeInfo?.amount2 || 0);
                const grandTotal = subtotal - calculatedDiscountAmount - exchangeTotal;
                const existingAdjustmentsAmount = getInvoiceAdjustmentsAmount(existingInvoiceData);

                // Reuse existing ID when editing so the invoice number is never consumed twice
                let invoiceId: string;
                if (existingInvoiceId) {
                    invoiceId = existingInvoiceId;
                } else {
                    // nextInvoiceNumber and newInvoiceId were computed + guard-read above, before writes
                    invoiceId = newInvoiceId!;
                    transaction.update(settingsDocRef, { lastInvoiceNumber: nextInvoiceNumber });
                }

                const newInvoiceData: Omit<Invoice, 'id'> = {
                    items: invoiceItems, subtotal, discountAmount: calculatedDiscountAmount, grandTotal,
                    amountPaid: existingAmountPaid,
                    balanceDue: grandTotal - existingAmountPaid,
                    createdAt: existingCreatedAt || new Date().toISOString(),
                    ratesApplied: ratesForInvoice,
                    // Only set when the counter chose someone; undefined stays out of Firestore.
                    ...(takenBy ? { takenBy } : {}),
                    ...(hideRates ? { hideRates: true } : {}),
                    ...(internalNote?.trim() ? { internalNote: internalNote.trim() } : {}),
                    paymentHistory: existingPaymentHistory,
                    customerName: finalCustomerName || 'Walk-in Customer',
                    customerId: finalCustomerId,
                    customerContact: customerInfo.phone ? normalizePhoneNumber(customerInfo.phone) : customerInfo.phone,
                    ...(existingAdjustmentsAmount !== 0 && { adjustmentsAmount: existingAdjustmentsAmount }),
                    ...(exchangeInfo?.description && { exchangeDescription: exchangeInfo.description }),
                    ...(exchangeInfo?.amount1 && { exchangeAmount1: exchangeInfo.amount1 }),
                    ...(exchangeInfo?.amount2 && { exchangeAmount2: exchangeInfo.amount2 }),
                    // Recorded only when the piece is actually going out, so an
                    // unticked box does not stamp every invoice with an empty
                    // delivery object.
                    ...(delivery?.required && delivery.address.trim() ? { delivery } : {}),
                };

                const cleanInvoiceData = cleanObject(newInvoiceData as Invoice);

                transaction.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), cleanInvoiceData);

                
                const finalInvoice = { ...cleanInvoiceData, id: invoiceId } as Invoice;
                if(finalInvoice.items && typeof finalInvoice.items === 'object' && !Array.isArray(finalInvoice.items)){
                  finalInvoice.items = Object.values(finalInvoice.items);
                }

                return finalInvoice;
            });

            if (result) {
              addActivityLog('invoice.create', `Created invoice ${result.id}`,
                `Customer: ${result.customerName || 'Walk-in'} | Total: ${Number(result.grandTotal || 0).toLocaleString()}`, result.id);
            }

            // This line should be outside the transaction, in the main function body.
            set(state => { state.cart = []; });

            // When editing an existing invoice, clean up its old hisaab entries so
            // we don't end up with duplicate balance entries after re-creation.
            // This runs AFTER the transaction so the invoice is always safe first.
            if (existingInvoiceId) {
                try {
                    const oldHisaabSnap = await getDocs(query(
                        collection(db, FIRESTORE_COLLECTIONS.HISAAB),
                        where('linkedInvoiceId', '==', existingInvoiceId)
                    ));
                    if (!oldHisaabSnap.empty) {
                        const hisaabBatch = writeBatch(db);
                        oldHisaabSnap.docs.forEach(d => hisaabBatch.delete(d.ref));
                        await hisaabBatch.commit();
                    }
                } catch (e) {
                    console.warn('[generateInvoice] Could not clean up old hisaab entries, continuing:', e);
                }
            }

            // If there's an outstanding balance, track it in hisaab
            if (result && result.balanceDue > 0) {
                await addDoc(collection(db, FIRESTORE_COLLECTIONS.HISAAB), {
                    entityId: result.customerId || 'walk-in',
                    entityType: 'customer',
                    entityName: result.customerName || 'Walk-in Customer',
                    date: result.createdAt,
                    description: `Outstanding balance for Invoice ${result.id}`,
                    cashDebit: result.balanceDue,
                    cashCredit: 0,
                    goldDebitGrams: 0,
                    goldCreditGrams: 0,
                    linkedInvoiceId: result.id,
                });
            }

            if (result) syncInvoiceShopify(result.id, 'upsert');

            // WhatsApp notification: new invoice/sale (only for brand-new invoices, not edits)
            if (result && !existingInvoiceId) {
                const itemList = (Array.isArray(result.items) ? result.items : Object.values(result.items || {})) as InvoiceItem[];
                const itemNames = itemList.map(i => i.name || 'Item').join(', ');
                const paidLine = result.balanceDue > 0
                    ? `Paid: PKR ${result.amountPaid.toLocaleString()} | Balance: PKR ${result.balanceDue.toLocaleString()}`
                    : `Paid in full`;
                const msg = `🧾 *New Sale* ${result.id}\nCustomer: ${result.customerName || 'Walk-in'}\nItems: ${itemNames}\nTotal: PKR ${result.grandTotal.toLocaleString()}\n${paidLine}`;
                notifyWhatsApp(get().settings, msg, get().settings.notifNewInvoice);
            }

            return result;
        } catch (error) {
            console.error("[GemsTrack Store generateInvoice] Transaction failed: ", error);
            return null;
        }
      },
      updateInvoicePayment: async (invoiceId, paymentAmount, paymentDate, method, reference) => {
        if(get().settings.databaseLocked) return null;

        // Staff have no database access, so their payment goes through the
        // server — which runs THIS SAME function against the Admin SDK. The
        // logic is not mirrored; only the driver differs.
        if (effectiveRole() === 'staff') {
          try {
            const res = await staffWriteJson('recordPayment', {
              invoiceId, amount: paymentAmount, date: paymentDate, method, reference,
            });
            const updated = res.invoice as Invoice;
            set(state => ({
              generatedInvoices: state.generatedInvoices.map(i => i.id === invoiceId ? { ...i, ...updated } : i),
            }) as Partial<AppState>);
            return updated;
          } catch (error) {
            console.error(`Error updating invoice payment for ${invoiceId}:`, error);
            return null;
          }
        }

        try {
          const updated = await recordInvoicePayment(
            clientPort,
            { invoiceId, amount: paymentAmount, date: paymentDate, method, reference },
            {
              // The port keeps its action as a plain string; the store's own log
              // is typed, and the value is one of its members.
              log: (action, title, detail, ref) => { addActivityLog(action as LogEventType, title, detail, ref ?? ''); },
              syncInvoiceShopify: (id, mode) => { syncInvoiceShopify(id, mode); },
              notify: (msg) => { notifyWhatsApp(get().settings, msg, get().settings.notifPaymentReceived); },
            },
          );
          return updated as unknown as Invoice;
        } catch (error) {
          console.error(`Error updating invoice payment for ${invoiceId}:`, error);
          return null;
        }
      },

      /**
       * Record a partial refund on an invoice. Adds a negative entry to
       * paymentHistory and recalculates amountPaid + balanceDue. Mirrors the
       * refund onto Shopify (issuing a refund transaction for `refundAmount`).
       */
      refundInvoicePartial: async (invoiceId, refundAmount, reason) => {
        if (get().settings.databaseLocked) return null;
        if (!(refundAmount > 0)) return null;

        const invoiceRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
        try {
          const updatedInvoice = await runTransaction(db, async (transaction) => {
            const invoiceDoc = await transaction.get(invoiceRef);
            if (!invoiceDoc.exists()) throw new Error('Invoice not found');
            const invoiceData = invoiceDoc.data() as Invoice;

            const refundEntry: Payment = {
              amount: -Math.abs(refundAmount),
              date: new Date().toISOString(),
              notes: reason ? `Refund: ${reason}` : 'Refund',
            };
            const newPaymentHistory = [...(invoiceData.paymentHistory || []), refundEntry];
            const newAmountPaid = newPaymentHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
            const newBalanceDue = (invoiceData.grandTotal || 0) - newAmountPaid;

            transaction.update(invoiceRef, {
              paymentHistory: newPaymentHistory,
              amountPaid: newAmountPaid,
              balanceDue: newBalanceDue,
            });

            return { ...invoiceData, id: invoiceId, paymentHistory: newPaymentHistory, amountPaid: newAmountPaid, balanceDue: newBalanceDue } as Invoice;
          });

          if (updatedInvoice) {
            addActivityLog('invoice.refund', `Partial refund on invoice ${invoiceId}`,
              `Amount: ${refundAmount.toLocaleString()}${reason ? ` | ${reason}` : ''}`, invoiceId);
            // Reconcile linked hisaab debit entries (the customer owes again).
            const hisaabSnap = await getDocs(query(
              collection(db, FIRESTORE_COLLECTIONS.HISAAB),
              where('linkedInvoiceId', '==', invoiceId),
            ));
            const debitDocs = hisaabSnap.docs.filter(d => Number(d.data().cashDebit ?? 0) > 0);
            const hisaabBatch = writeBatch(db);
            if (updatedInvoice.balanceDue > 0) {
              if (debitDocs.length > 0) {
                hisaabBatch.update(debitDocs[0].ref, { cashDebit: updatedInvoice.balanceDue });
                debitDocs.slice(1).forEach(d => hisaabBatch.delete(d.ref));
              } else if (updatedInvoice.customerId && updatedInvoice.customerId !== 'walk-in') {
                const newRef = doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB));
                hisaabBatch.set(newRef, {
                  entityId: updatedInvoice.customerId,
                  entityType: 'customer',
                  entityName: updatedInvoice.customerName || 'Customer',
                  date: updatedInvoice.createdAt,
                  description: `Outstanding balance for Invoice ${invoiceId}`,
                  cashDebit: updatedInvoice.balanceDue,
                  cashCredit: 0,
                  goldDebitGrams: 0,
                  goldCreditGrams: 0,
                  linkedInvoiceId: invoiceId,
                });
              }
            }
            await hisaabBatch.commit();

            // Mirror to Shopify: issue a refund for this exact amount.
            if (typeof window !== 'undefined' && !invoiceId.startsWith('SHOPIFY-')) {
              fetch('/api/shopify/sync/invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoiceId, action: 'refund', amount: refundAmount, reason }),
              }).catch(() => { /* fire-and-forget */ });
            }
          }
          return updatedInvoice;
        } catch (error) {
          console.error(`[refundInvoicePartial] ${invoiceId}:`, error);
          return null;
        }
      },

      updateInvoiceDiscount: async (invoiceId, newDiscountAmount) => {
        if (get().settings.databaseLocked) return null;

        const invoiceRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);

        try {
          const updatedInvoice = await runTransaction(db, async (transaction) => {
            const invoiceDoc = await transaction.get(invoiceRef);
            if (!invoiceDoc.exists()) throw new Error("Invoice not found!");

            const invoiceData = invoiceDoc.data() as Invoice;

            const newGrandTotal = invoiceData.subtotal - newDiscountAmount - (invoiceData.exchangeAmount1 || 0) - (invoiceData.exchangeAmount2 || 0);
            const newBalanceDue = newGrandTotal - invoiceData.amountPaid;

            const updatedFields = {
              discountAmount: newDiscountAmount,
              grandTotal: newGrandTotal,
              balanceDue: newBalanceDue,
            };

            transaction.update(invoiceRef, updatedFields);


            return { ...invoiceData, ...updatedFields, id: invoiceId };
          });

          if (updatedInvoice) {
            addActivityLog('invoice.update', `Discount updated on invoice ${invoiceId}`,
              `Discount: ${Number(updatedInvoice.discountAmount || 0).toLocaleString()} | New total: ${Number(updatedInvoice.grandTotal || 0).toLocaleString()}`, invoiceId);
            // Update linked hisaab entries
            const hisaabSnap = await getDocs(query(
              collection(db, FIRESTORE_COLLECTIONS.HISAAB),
              where('linkedInvoiceId', '==', invoiceId)
            ));
            const debitDocs = hisaabSnap.docs.filter(d => (d.data().cashDebit ?? 0) > 0);

            const hisaabBatch = writeBatch(db);
            if (updatedInvoice.balanceDue <= 0) {
              debitDocs.forEach(d => hisaabBatch.delete(d.ref));
            } else {
              if (debitDocs.length > 0) {
                hisaabBatch.update(debitDocs[0].ref, { cashDebit: updatedInvoice.balanceDue });
                debitDocs.slice(1).forEach(d => hisaabBatch.delete(d.ref));
              } else if (updatedInvoice.customerId && updatedInvoice.customerId !== 'walk-in') {
                const newRef = doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB));
                hisaabBatch.set(newRef, {
                  entityId: updatedInvoice.customerId,
                  entityType: 'customer',
                  entityName: updatedInvoice.customerName || 'Customer',
                  date: updatedInvoice.createdAt,
                  description: `Outstanding balance for Invoice ${invoiceId}`,
                  cashDebit: updatedInvoice.balanceDue,
                  cashCredit: 0,
                  goldDebitGrams: 0,
                  goldCreditGrams: 0,
                  linkedInvoiceId: invoiceId,
                });
              }
            }
            await hisaabBatch.commit();

            // Sync source order grandTotal
            if (updatedInvoice.sourceOrderId) {
              await updateDoc(
                doc(db, FIRESTORE_COLLECTIONS.ORDERS, updatedInvoice.sourceOrderId),
                { grandTotal: updatedInvoice.balanceDue }
              );
            }
            syncInvoiceShopify(invoiceId, 'upsert');
          }

          return updatedInvoice;
        } catch (error) {
          console.error(`Error updating invoice discount for ${invoiceId}:`, error);
          return null;
        }
      },

      syncHisaabOutstandingBalances: async () => {
        try {
          const [invoicesSnap, hisaabSnap, customersSnap] = await Promise.all([
            getDocs(collection(db, FIRESTORE_COLLECTIONS.INVOICES)),
            getDocs(collection(db, FIRESTORE_COLLECTIONS.HISAAB)),
            getDocs(collection(db, FIRESTORE_COLLECTIONS.CUSTOMERS)),
          ]);

          // Build a name→{id, name} map for fuzzy customer matching on Shopify invoices with missing customerId
          const customerByName: Record<string, { id: string; name: string }> = {};
          for (const d of customersSnap.docs) {
            const cust = d.data() as any;
            if (cust.name) customerByName[cust.name.toLowerCase().trim()] = { id: d.id, name: cust.name };
          }

          // Build a map of invoiceId → invoice data for fast lookup
          const invoiceMap: Record<string, any> = {};
          for (const d of invoicesSnap.docs) {
            invoiceMap[d.id] = { ...d.data(), id: d.id };
          }

          const allHisaabDocs = hisaabSnap.docs.map(d => ({ _ref: d.ref, ...(d.data() as any) }));

          console.log(`[syncHisaab] Checking ${invoicesSnap.docs.length} invoices against ${hisaabSnap.docs.length} hisaab entries.`);

          // Log all current hisaab entries so we can see what's actually in there
          for (const h of allHisaabDocs) {
            const invData = h.linkedInvoiceId ? invoiceMap[h.linkedInvoiceId] : null;
            console.log(`[syncHisaab] Entry: ${h.entityName} | debit:${h.cashDebit} credit:${h.cashCredit} | linkedInvoice:${h.linkedInvoiceId || 'none'} | invoice.balanceDue:${invData ? invData.balanceDue : 'N/A'} | invoice.amountPaid:${invData ? invData.amountPaid : 'N/A'} | invoice.grandTotal:${invData ? invData.grandTotal : 'N/A'}`);
          }

          const batch = writeBatch(db);
          let ops = 0;
          const getOutstandingDescription = (invoiceId: string) => `Outstanding balance for Invoice ${invoiceId}`;
          const getExcessAdvanceDescription = (invoiceId: string) => `Excess advance returned for Invoice ${invoiceId}`;

          // Iterate over hisaab entries — for each entry linked to an invoice, validate it
          // Group by invoiceId so we can handle duplicates
          const linkedByInvoice: Record<string, typeof allHisaabDocs> = {};
          for (const h of allHisaabDocs) {
            if (!h.linkedInvoiceId) continue; // manual entries — leave untouched
            if (!linkedByInvoice[h.linkedInvoiceId]) linkedByInvoice[h.linkedInvoiceId] = [];
            linkedByInvoice[h.linkedInvoiceId].push(h);
          }

          for (const [invoiceId, linked] of Object.entries(linkedByInvoice)) {
            const inv = invoiceMap[invoiceId];

            // Invoice was deleted but hisaab entry remains — clean up
            if (!inv) {
              linked.forEach(h => { batch.delete(h._ref); ops++; });
              console.log(`[syncHisaab] Deleted ${linked.length} orphaned entries for missing invoice ${invoiceId}.`);
              continue;
            }

            const outstandingDebitEntries = linked.filter(h =>
              (h.cashDebit ?? 0) > 0 && h.description === getOutstandingDescription(inv.id)
            );
            const excessAdvanceCreditEntries = linked.filter(h =>
              (h.cashCredit ?? 0) > 0 && h.description === getExcessAdvanceDescription(inv.id)
            );
            const resolvedCustomerId = inv.customerId || customerByName[inv.customerName?.toLowerCase().trim()]?.id || '';
            const balanceDue = inv.status === 'Refunded' ? 0 : Number(inv.balanceDue ?? 0);

            if (balanceDue > 0) {
              if (excessAdvanceCreditEntries.length > 0) {
                console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) removing ${excessAdvanceCreditEntries.length} stale excess-advance credit entr${excessAdvanceCreditEntries.length === 1 ? 'y' : 'ies'}.`);
                excessAdvanceCreditEntries.forEach(h => { batch.delete(h._ref); ops++; });
              }

              if (outstandingDebitEntries.length === 0) {
                if (resolvedCustomerId && resolvedCustomerId !== 'walk-in') {
                  console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) outstanding ${balanceDue} — creating missing entry.`);
                  const newRef = doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB));
                  batch.set(newRef, {
                    entityId: resolvedCustomerId,
                    entityType: 'customer',
                    entityName: inv.customerName || 'Customer',
                    date: inv.createdAt,
                    description: getOutstandingDescription(inv.id),
                    cashDebit: balanceDue,
                    cashCredit: 0,
                    goldDebitGrams: 0,
                    goldCreditGrams: 0,
                    linkedInvoiceId: inv.id,
                  });
                  ops++;
                }
              } else {
                if (outstandingDebitEntries[0].cashDebit !== balanceDue) {
                  console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) updating stale cashDebit ${outstandingDebitEntries[0].cashDebit} → ${balanceDue}.`);
                  batch.update(outstandingDebitEntries[0]._ref, { cashDebit: balanceDue, cashCredit: 0 });
                  ops++;
                }
                outstandingDebitEntries.slice(1).forEach(h => { batch.delete(h._ref); ops++; });
              }
              continue;
            }

            if (balanceDue < 0) {
              if (outstandingDebitEntries.length > 0) {
                console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) removing ${outstandingDebitEntries.length} stale outstanding entr${outstandingDebitEntries.length === 1 ? 'y' : 'ies'} after overpayment.`);
                outstandingDebitEntries.forEach(h => { batch.delete(h._ref); ops++; });
              }

              const creditAmount = Math.abs(balanceDue);
              if (excessAdvanceCreditEntries.length === 0) {
                if (resolvedCustomerId && resolvedCustomerId !== 'walk-in') {
                  console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) excess advance ${creditAmount} — creating missing credit entry.`);
                  const newRef = doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB));
                  batch.set(newRef, {
                    entityId: resolvedCustomerId,
                    entityType: 'customer',
                    entityName: inv.customerName || 'Customer',
                    date: inv.createdAt,
                    description: getExcessAdvanceDescription(inv.id),
                    cashDebit: 0,
                    cashCredit: creditAmount,
                    goldDebitGrams: 0,
                    goldCreditGrams: 0,
                    linkedInvoiceId: inv.id,
                  });
                  ops++;
                }
              } else {
                if (excessAdvanceCreditEntries[0].cashCredit !== creditAmount) {
                  console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) updating stale cashCredit ${excessAdvanceCreditEntries[0].cashCredit} → ${creditAmount}.`);
                  batch.update(excessAdvanceCreditEntries[0]._ref, { cashDebit: 0, cashCredit: creditAmount });
                  ops++;
                }
                excessAdvanceCreditEntries.slice(1).forEach(h => { batch.delete(h._ref); ops++; });
              }
              continue;
            }

            const staleAutoEntries = [...outstandingDebitEntries, ...excessAdvanceCreditEntries];
            if (staleAutoEntries.length > 0) {
              console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) settled, removing ${staleAutoEntries.length} stale auto-managed entr${staleAutoEntries.length === 1 ? 'y' : 'ies'}.`);
              staleAutoEntries.forEach(h => { batch.delete(h._ref); ops++; });
            }
          }

          // Second pass: catch invoices that have NO hisaab entry at all.
          // These are typically Shopify-imported invoices that were never run through
          // generateInvoice(), so no entry was ever created for them.
          for (const inv of Object.values(invoiceMap)) {
            if (linkedByInvoice[inv.id]) continue; // already handled above
            if ((inv.balanceDue ?? 0) <= 0 || inv.status === 'Refunded') continue;
            // For invoices with missing customerId (e.g. Shopify imports with unmatched names), try name-based lookup
            const resolvedId = inv.customerId || customerByName[inv.customerName?.toLowerCase().trim()]?.id || '';
            if (!resolvedId || resolvedId === 'walk-in') continue;

            console.log(`[syncHisaab] Invoice ${inv.id} (${inv.customerName}) has no hisaab entry — creating (balanceDue: ${inv.balanceDue}).`);
            const newRef = doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB));
            batch.set(newRef, {
              entityId: resolvedId,
              entityType: 'customer',
              entityName: inv.customerName || 'Customer',
              date: inv.createdAt,
              description: getOutstandingDescription(inv.id),
              cashDebit: inv.balanceDue,
              cashCredit: 0,
              goldDebitGrams: 0,
              goldCreditGrams: 0,
              linkedInvoiceId: inv.id,
            });
            ops++;
          }

          if (ops > 0) {
            await batch.commit();
            console.log(`[syncHisaab] Done — applied ${ops} corrections.`);
          } else {
            console.log('[syncHisaab] Already in sync, nothing to do.');
          }
        } catch (error) {
          console.error('[syncHisaab] Error:', error);
        }
      },

      deleteInvoice: async (invoiceId, isEditing = false, syncShopify = true) => {
          if(get().settings.databaseLocked) return;
          console.log(`[deleteInvoice] Attempting to delete invoice ${invoiceId}. Is editing flow: ${isEditing}. Sync Shopify: ${syncShopify}`);
          try {
              const invoiceDocRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
              const invoiceDoc = await getDoc(invoiceDocRef);
              if (!invoiceDoc.exists()) {
                  console.warn(`Invoice ${invoiceId} not found for deletion.`);
                  return;
              }
              const invoiceData = invoiceDoc.data() as Invoice;
              const hadShopifyLink = !!invoiceData.shopifyOrderId;

              const batch = writeBatch(db);
              
              // Only move products back if it's NOT an edit-and-replace operation
              // Order-generated items (SKU starts with 'ORD-') were never in the products collection, skip them
              if (!isEditing) {
                  for(const item of invoiceData.items) {
                      if (item.sku.startsWith('ORD-')) continue;
                      const soldProductRef = doc(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS, item.sku);
                      const productData = {
                          sku: item.sku, name: item.name, categoryId: item.categoryId,
                          metalType: item.metalType, karat: item.karat, metalWeightG: item.metalWeightG,
                          hasStones: item.stoneChargesIfAny > 0,
                          stoneWeightG: item.stoneWeightG, wastagePercentage: item.wastagePercentage,
                          makingCharges: item.makingCharges, hasDiamonds: item.diamondChargesIfAny > 0,
                          diamondCharges: item.diamondChargesIfAny, stoneCharges: item.stoneChargesIfAny,
                          miscCharges: item.miscChargesIfAny, stoneDetails: item.stoneDetails, diamondDetails: item.diamondDetails,
                          // Restore custom price override so refunded inventory keeps its price
                          ...(item.isCustomPrice && { isCustomPrice: true, customPrice: item.unitPrice }),
                      };
                      batch.set(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, item.sku), cleanObject(productData));
                      batch.delete(soldProductRef);
                  }
              }

              const hisaabSnapshot = await getDocs(query(
                  collection(db, FIRESTORE_COLLECTIONS.HISAAB),
                  where('linkedInvoiceId', '==', invoiceId)
              ));
              hisaabSnapshot.docs.forEach(doc => batch.delete(doc.ref));

              // If this invoice was created from an order, clear the invoiceId on that order
              // so it re-appears in revenue calculations.
              if (invoiceData.sourceOrderId) {
                  batch.set(
                      doc(db, FIRESTORE_COLLECTIONS.ORDERS, invoiceData.sourceOrderId),
                      { invoiceId: deleteField() },
                      { merge: true }
                  );
              }

              batch.delete(invoiceDocRef);
              await batch.commit();

              await addActivityLog('invoice.delete', `Deleted invoice ${invoiceId}`, `Customer: ${invoiceData.customerName}`, invoiceId);
              console.log(`Successfully deleted invoice ${invoiceId} and related data.`);

              // Cancel the matching Shopify order, but only when this is a true
              // delete — not the edit/revert flow (which carries the link forward)
              // and not when the caller (e.g. refundOrder) handles Shopify itself.
              if (!isEditing && syncShopify && hadShopifyLink && !invoiceId.startsWith('SHOPIFY-')) {
                  syncInvoiceShopify(invoiceId, 'cancel');
              }
          } catch (e) {
              console.error(`Failed to delete invoice ${invoiceId}:`, e);
              throw e;
          }
      },

      addOrder: async (orderData) => {
        if(get().settings.databaseLocked) return null;

        // Staff post to the server, which runs THIS SAME createOrder against
        // the Admin SDK. One copy of the numbering and the rate snapshot.
        if (effectiveRole() === 'staff') {
          try {
            const res = await staffWriteJson('createOrder', { order: orderData });
            const created = res.order as Order;
            set(state => ({ orders: [created, ...state.orders] }) as Partial<AppState>);
            return created;
          } catch (error) {
            console.error('[GemsTrack Store addOrder] staff write failed:', error);
            return null;
          }
        }

        try {
          const created = await createOrder(
            clientPort,
            orderData as unknown as Parameters<typeof createOrder>[1],
            {
              createCustomer: async (c) => {
                const made = await get().addCustomer({ name: c.name, phone: c.phone, email: '', address: '' });
                return made ? { id: made.id, name: made.name } : null;
              },
              normalizePhone: (v) => normalizePhoneNumber(v),
              clean: cleanObject,
            },
            {
              log: (action, title, detail, ref) => { addActivityLog(action as LogEventType, title, detail, ref ?? ''); },
              notify: (msg) => { const st = get().settings; notifyWhatsApp(st, msg, !!st.notifNewOrder); },
            },
          );
          syncOrderShopify(created.id, 'upsert');
          return created as unknown as Order;
        } catch (error) {
          console.error(`[GemsTrack Store addOrder] Error saving order to Firestore:`, error);
          return null;
        }
      },
      updateOrder: async (orderId, updatedOrderData) => {
        if(get().settings.databaseLocked) return;
        const orderRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
        const cleanData = cleanObject(updatedOrderData);
        await setDoc(orderRef, cleanData, { merge: true });
        await addActivityLog('order.update', `Updated order: ${orderId}`, `Details updated`, orderId);
        syncOrderShopify(orderId, 'upsert');
      },
      deleteOrder: async (orderId: string) => {
        if(get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) {
            console.error(`Order ${orderId} not found for deletion.`);
            return;
        }
        console.log(`[GemsTrack Store deleteOrder] Attempting to delete order ID ${orderId}.`);
        try {
          // Cancel the Shopify draft FIRST while we still have orderId mapping in Firestore.
          if (order.shopifyDraftOrderId) syncOrderShopify(orderId, 'cancel');
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId));
          await addActivityLog('order.delete', `Deleted order: ${orderId}`, `Customer: ${order.customerName}`, orderId);
          console.log(`[GemsTrack Store deleteOrder] Order ID ${orderId} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteOrder] Error deleting order ID ${orderId} from Firestore:`, error);
          throw error;
        }
      },
      updateOrderStatus: async (orderId, status) => {
        if(get().settings.databaseLocked) return;
        // Staff cannot touch Firestore; the same rules are applied server-side.
        if (await staffWrite('updateOrderStatus', { orderId, status })) {
          set(state => ({
            orders: state.orders.map(o => o.id === orderId
              ? { ...o, status, items: status === 'Completed'
                  ? (o.items || []).map(i => ({ ...i, isCompleted: true })) : o.items }
              : o),
          }) as Partial<AppState>);
          return;
        }
        console.log(`[GemsTrack Store updateOrderStatus] Updating order ${orderId} to status: ${status}`);
        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);

          // Completing an order completes every piece in it — nobody ticks the
          // per-item boxes one by one, and leaving them unticked makes finished
          // work linger as "pending" on the Workshop dashboard forever.
          const existing = get().orders.find(o => o.id === orderId);
          const items = Array.isArray(existing?.items) ? existing!.items : [];
          const needsTicking = status === 'Completed' && items.some(i => !i.isCompleted);
          const payload: Record<string, unknown> = { status };
          if (needsTicking) payload.items = items.map(i => ({ ...i, isCompleted: true }));

          await setDoc(orderDocRef, payload, { merge: true });
          await addActivityLog('order.update', `Order ${orderId} status changed`, `New status: ${status}`, orderId);
          if (needsTicking) {
            await addActivityLog('order.update', `All items marked complete on ${orderId}`,
              `${items.filter(i => !i.isCompleted).length} item(s) auto-completed`, orderId);
          }
          // Cancelled / Refunded → drop the Shopify draft. Other statuses just update.
          if (status === 'Cancelled' || status === 'Refunded') {
            syncOrderShopify(orderId, 'cancel');
          } else {
            syncOrderShopify(orderId, 'upsert');
          }
          console.log(`[GemsTrack Store updateOrderStatus] Successfully updated status for order ${orderId}.`);

          // WhatsApp notifications: completed or cancelled
          const s = get().settings;
          const order = get().orders.find(o => o.id === orderId);
          if (s.notifEnabled && s.notifPhones?.length && order) {
            let msg: string | null = null;
            if (status === 'Completed' && s.notifOrderCompleted) {
              msg = `*Order Completed* ${orderId}\nCustomer: ${order.customerName || 'Walk-in'}\nTotal: PKR ${order.grandTotal.toLocaleString()}`;
            } else if ((status === 'Cancelled' || status === 'Refunded') && s.notifOrderCancelled) {
              msg = `*Order ${status}* ${orderId}\nCustomer: ${order.customerName || 'Walk-in'}\nTotal: PKR ${order.grandTotal.toLocaleString()}`;
            }
            // The specific toggle was already checked when msg was built.
            if (msg) notifyWhatsApp(s, msg);
          }
        } catch (error) {
          console.error(`[GemsTrack Store updateOrderStatus] Error updating status for order ${orderId}:`, error);
          throw error;
        }
      },

      updateOrderItemStatus: async (orderId, itemIndex, isCompleted) => {
        if(get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) {
          console.error(`Order with ID ${orderId} not found.`);
          throw new Error("Order not found");
        }
        const updatedItems = order.items.map((item, i) =>
          i === itemIndex ? { ...item, isCompleted } : item
        );

        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
          await setDoc(orderDocRef, { items: updatedItems }, { merge: true });
          console.log(`Successfully updated item #${itemIndex} status for order ${orderId}.`);
          syncOrderShopify(orderId, 'upsert');
        } catch (error) {
          console.error(`Error updating item status for order ${orderId}:`, error);
          throw error;
        }
      },
      /** Assign (or clear) the karigar on a single order item, without opening the order form. */
      /**
       * A Pending order whose every piece now has a karigar has, by
       * definition, been handed out — so it moves itself to In Progress.
       * Returns the status to write, or null to leave it alone. Only ever
       * promotes Pending; it will not touch Completed, Cancelled or Refunded.
       */
      _statusAfterAssign: (order: Order, items: OrderItem[]): OrderStatus | null => {
        if (order.status !== 'Pending') return null;
        if (!items.length) return null;
        const allAssigned = items.every(i => i.karigarId && i.karigarId !== 'none');
        return allAssigned ? 'In Progress' : null;
      },

      updateOrderItemKarigar: async (orderId, itemIndex, karigarId) => {
        if (get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) throw new Error('Order not found');

        const clearing = !karigarId || karigarId === 'none';
        const updatedItems = order.items.map((item, i) => {
          if (i !== itemIndex) return item;
          const next = { ...item };
          if (clearing) delete next.karigarId; else next.karigarId = karigarId;
          return next;
        });

        const nextStatus = get()._statusAfterAssign(order, updatedItems);

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId),
            { items: updatedItems, ...(nextStatus && { status: nextStatus }) }, { merge: true });
          const name = clearing ? 'Unassigned' : (get().karigars.find(k => k.id === karigarId)?.name || karigarId);
          await addActivityLog('order.update', `Karigar assigned on ${orderId}`,
            `${order.items[itemIndex]?.description || `Item ${itemIndex + 1}`} → ${name}`, orderId);
          if (nextStatus) {
            await addActivityLog('order.update', `${orderId} → ${nextStatus}`,
              'Every piece now has a karigar', orderId);
          }
          syncOrderShopify(orderId, 'upsert');
        } catch (error) {
          console.error(`Error assigning karigar for order ${orderId}:`, error);
          throw error;
        }
      },

      /**
       * Update only the making details of an order item — the fields a karigar
       * needs. Deliberately cannot touch price, customer or quantity, so this
       * can be exposed on the Workshop dashboard without risk of editing the
       * commercial side of an order by accident.
       */
      updateOrderItemDetails: async (orderId, itemIndex, patch) => {
        if (get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) throw new Error('Order not found');

        const updatedItems = order.items.map((item, i) => {
          if (i !== itemIndex) return item;
          const next: OrderItem = { ...item };
          const setOrClear = (key: 'size' | 'stoneDetails' | 'diamondDetails' | 'adminNote' | 'referenceSku', value?: string) => {
            const v = (value ?? '').trim();
            if (v) next[key] = v;
            else delete next[key];
          };
          // The description prints on the customer's estimate/invoice, so it
          // is updated when given but never cleared to an empty string.
          if (patch.description !== undefined && patch.description.trim()) {
            next.description = patch.description.trim();
          }
          if ('size' in patch) setOrClear('size', patch.size);
          if ('stoneDetails' in patch) setOrClear('stoneDetails', patch.stoneDetails);
          if ('diamondDetails' in patch) setOrClear('diamondDetails', patch.diamondDetails);
          if ('adminNote' in patch) setOrClear('adminNote', patch.adminNote);
          if ('referenceSku' in patch) setOrClear('referenceSku', patch.referenceSku);
          if (patch.estimatedWeightG !== undefined) next.estimatedWeightG = Number(patch.estimatedWeightG) || 0;
          if (patch.sampleImageDataUri !== undefined) {
            if (patch.sampleImageDataUri) next.sampleImageDataUri = patch.sampleImageDataUri;
            else delete next.sampleImageDataUri;
          }
          return next;
        });

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId), { items: updatedItems }, { merge: true });
          await addActivityLog('order.update', `Making details updated on ${orderId}`,
            `${order.items[itemIndex]?.description || `Item ${itemIndex + 1}`}`, orderId);
          syncOrderShopify(orderId, 'upsert');
        } catch (error) {
          console.error(`Error updating item details for ${orderId}:`, error);
          throw error;
        }
      },

      /** Assign a karigar to a sold item — resizing, replating, repairs, and
       *  Shopify orders (which land as invoices, not orders). */
      updateInvoiceItemKarigar: async (invoiceId, itemIndex, karigarId) => {
        if (get().settings.databaseLocked) return;
        const inv = get().generatedInvoices.find(i => i.id === invoiceId);
        if (!inv) throw new Error('Invoice not found');
        const items = (Array.isArray(inv.items) ? inv.items : Object.values(inv.items || {})) as InvoiceItem[];
        const clearing = !karigarId || karigarId === 'none';
        const updated = items.map((item, i) => {
          if (i !== itemIndex) return item;
          const next = { ...item };
          if (clearing) delete next.karigarId; else next.karigarId = karigarId;
          return next;
        });
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), { items: updated }, { merge: true });
          const name = clearing ? 'Unassigned' : (get().karigars.find(k => k.id === karigarId)?.name || karigarId);
          await addActivityLog('invoice.update', `Karigar assigned on ${invoiceId}`,
            `${items[itemIndex]?.name || `Item ${itemIndex + 1}`} → ${name}`, invoiceId);
        } catch (error) {
          console.error(`Error assigning karigar on invoice ${invoiceId}:`, error);
          throw error;
        }
      },

      updateInvoiceItemStatus: async (invoiceId, itemIndex, isCompleted) => {
        if (get().settings.databaseLocked) return;
        const inv = get().generatedInvoices.find(i => i.id === invoiceId);
        if (!inv) throw new Error('Invoice not found');
        const items = (Array.isArray(inv.items) ? inv.items : Object.values(inv.items || {})) as InvoiceItem[];
        const updated = items.map((item, i) => (i === itemIndex ? { ...item, isCompleted } : item));
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), { items: updated }, { merge: true });
        } catch (error) {
          console.error(`Error updating invoice item status on ${invoiceId}:`, error);
          throw error;
        }
      },

      /*
       * "Given" is written the same way "done" is: the item array is rewritten with the
       * one field changed and merged over the document. Clearing deletes the key rather
       * than writing null, so an item that was never handed over and one whose handover
       * was taken back look the same, which they are.
       */
      updateOrderItemGiven: async (orderId, itemIndex, givenAt) => {
        if (get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) throw new Error('Order not found');
        const updatedItems = order.items.map((item, i) => {
          if (i !== itemIndex) return item;
          const next: OrderItem = { ...item };
          if (givenAt) next.givenAt = givenAt; else delete next.givenAt;
          return next;
        });
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId), { items: updatedItems }, { merge: true });
        } catch (error) {
          console.error(`Error updating given state for order ${orderId}:`, error);
          throw error;
        }
      },
      updateInvoiceItemGiven: async (invoiceId, itemIndex, givenAt) => {
        if (get().settings.databaseLocked) return;
        const inv = get().generatedInvoices.find(i => i.id === invoiceId);
        if (!inv) throw new Error('Invoice not found');
        const items = (Array.isArray(inv.items) ? inv.items : Object.values(inv.items || {})) as InvoiceItem[];
        const updated = items.map((item, i) => {
          if (i !== itemIndex) return item;
          const next: InvoiceItem = { ...item };
          if (givenAt) next.givenAt = givenAt; else delete next.givenAt;
          return next;
        });
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), { items: updated }, { merge: true });
        } catch (error) {
          console.error(`Error updating given state for invoice ${invoiceId}:`, error);
          throw error;
        }
      },
      // Not through updateKarigarJob: that strips undefined, so it can set the field
      // but never remove it, and un-ticking the box has to remove it.
      setKarigarJobGiven: async (id, givenAt) => {
        if (get().settings.databaseLocked) return;
        try {
          await updateDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGAR_JOBS, id), { givenAt: givenAt ?? deleteField() });
        } catch (error) {
          console.error(`Error updating given state for job ${id}:`, error);
          throw error;
        }
      },

      /** Assign every item on an order to one karigar. `onlyUnassigned` leaves existing assignments alone. */
      assignOrderItemsToKarigar: async (orderId, karigarId, onlyUnassigned = false) => {
        if (get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) throw new Error('Order not found');

        const clearing = !karigarId || karigarId === 'none';
        let changed = 0;
        const updatedItems = order.items.map(item => {
          const assigned = item.karigarId && item.karigarId !== 'none';
          if (onlyUnassigned && assigned) return item;
          const next = { ...item };
          if (clearing) delete next.karigarId; else next.karigarId = karigarId;
          changed++;
          return next;
        });
        if (!changed) return;

        const nextStatus = get()._statusAfterAssign(order, updatedItems);

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId),
            { items: updatedItems, ...(nextStatus && { status: nextStatus }) }, { merge: true });
          const name = clearing ? 'Unassigned' : (get().karigars.find(k => k.id === karigarId)?.name || karigarId);
          await addActivityLog('order.update', `Bulk karigar assign on ${orderId}`, `${changed} item(s) → ${name}`, orderId);
          if (nextStatus) {
            await addActivityLog('order.update', `${orderId} → ${nextStatus}`,
              'Every piece now has a karigar', orderId);
          }
          syncOrderShopify(orderId, 'upsert');
        } catch (error) {
          console.error(`Error bulk-assigning karigar for order ${orderId}:`, error);
          throw error;
        }
      },

      removeItemFromOrder: async (orderId, itemIndex) => {
        if (get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) throw new Error("Order not found");
        if (order.items.length <= 1) throw new Error("Cannot remove the last item from an order. Delete the order instead.");

        const updatedItems = order.items.filter((_, i) => i !== itemIndex);
        const newSubtotal = updatedItems.reduce((sum, item) => sum + (item.totalEstimate || item.manualPrice || 0), 0);
        const newGrandTotal = newSubtotal;
        const newSummary = updatedItems.length === 1
          ? (updatedItems[0].description || 'Custom order')
          : updatedItems.map(i => i.description).filter(Boolean).join(', ') || 'Custom order';

        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
          await setDoc(orderDocRef, { items: updatedItems, subtotal: newSubtotal, grandTotal: newGrandTotal, summary: newSummary }, { merge: true });
          await addActivityLog('order.update', `Removed item from order: ${orderId}`, `Item: ${order.items[itemIndex]?.description}`, orderId);
          syncOrderShopify(orderId, 'upsert');
        } catch (error) {
          console.error(`Error removing item from order ${orderId}:`, error);
          throw error;
        }
      },

      generateInvoiceFromOrder: async (order, finalizedItems, additionalDiscount) => {
        if (get().settings.databaseLocked) return null;
        const { settings } = get();
        let finalSubtotal = 0;
        const ratesForInvoice = order.ratesApplied || {
            goldRatePerGram24k: settings.goldRatePerGram24k,
            goldRatePerGram22k: settings.goldRatePerGram22k,
            goldRatePerGram21k: settings.goldRatePerGram21k,
            goldRatePerGram18k: settings.goldRatePerGram18k,
            palladiumRatePerGram: settings.palladiumRatePerGram,
            platinumRatePerGram: settings.platinumRatePerGram,
            silverRatePerGram: settings.silverRatePerGram
        };

        const finalInvoiceItems: InvoiceItem[] = [];
        order.items.forEach((originalItem, index) => {
            const finalizedData = finalizedItems[index]; // Use index for reliability
            if (!finalizedData) {
                console.error(`Could not find finalized data for item index: ${index}`);
                throw new Error(`Finalized data for item "${originalItem.description}" not found.`);
            }

            let itemPrice: number;
            let itemCosts: { metalCost: number; wastageCost: number; makingCharges: number; diamondCharges: number; stoneCharges: number };

            if (finalizedData.isManualPrice) {
                itemPrice = Number(finalizedData.finalManualPrice) || 0;
                itemCosts = { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0 };
            } else {
                const productForCostCalc = {
                    metalType: originalItem.metalType,
                    karat: originalItem.karat,
                    metalWeightG: finalizedData.finalWeightG,
                    stoneWeightG: originalItem.stoneWeightG,
                    hasStones: originalItem.hasStones,
                    wastagePercentage: originalItem.wastagePercentage,
                    makingCharges: finalizedData.finalMakingCharges,
                    hasDiamonds: originalItem.hasDiamonds,
                    diamondCharges: finalizedData.finalDiamondCharges,
                    stoneCharges: finalizedData.finalStoneCharges,
                    miscCharges: 0,
                };
                const costs = _calculateProductCostsInternal(productForCostCalc, ratesForInvoice as any);
                itemPrice = costs.totalPrice;
                itemCosts = { metalCost: costs.metalCost, wastageCost: costs.wastageCost, makingCharges: costs.makingCharges, diamondCharges: costs.diamondCharges, stoneCharges: costs.stoneCharges };
            }

            finalSubtotal += itemPrice;

            const numericPart = String(order.id).replace(/^ORD-/, '');
            const itemToAdd: InvoiceItem = {
                sku: `ORD-${numericPart}-${index + 1}`,
                name: originalItem.description,
                categoryId: '',
                metalType: originalItem.metalType,
                karat: originalItem.karat,
                metalWeightG: finalizedData.isManualPrice ? 0 : finalizedData.finalWeightG,
                stoneWeightG: originalItem.stoneWeightG,
                quantity: 1,
                unitPrice: itemPrice,
                itemTotal: itemPrice,
                metalCost: itemCosts.metalCost,
                wastageCost: itemCosts.wastageCost,
                wastagePercentage: originalItem.wastagePercentage,
                makingCharges: itemCosts.makingCharges,
                diamondChargesIfAny: itemCosts.diamondCharges,
                stoneChargesIfAny: itemCosts.stoneCharges,
                miscChargesIfAny: 0,
                stoneDetails: originalItem.stoneDetails,
                diamondDetails: originalItem.diamondDetails,
                ...(originalItem.size && { size: originalItem.size }),
                ...(finalizedData.isManualPrice && { isManualPrice: true }),
                ...(originalItem.itemCategory && { itemCategory: originalItem.itemCategory }),
                ...(originalItem.adminNote && { adminNote: originalItem.adminNote }),
            };
            finalInvoiceItems.push(cleanObject(itemToAdd));
        });

        const totalDiscount = additionalDiscount;
        const grandTotal = finalSubtotal - totalDiscount;

        const advancePayment: Payment = {
            amount: (order.advancePayment || 0) + (order.advanceInExchangeValue || 0),
            date: order.createdAt,
            notes: `Advance from Order. Cash: ${order.advancePayment || 0}. Exchange: ${order.advanceInExchangeValue || 0} (${order.advanceInExchangeDescription || ''})`,
        };

        const paymentHistory: Payment[] = advancePayment.amount > 0 ? [advancePayment] : [];
        const amountPaid = advancePayment.amount;
        const balanceDue = finalSubtotal - amountPaid - totalDiscount;

        const baseInvoiceData: Omit<Invoice, 'id'> = {
            items: finalInvoiceItems,
            subtotal: finalSubtotal,
            discountAmount: totalDiscount,
            grandTotal: grandTotal,
            amountPaid: amountPaid,
            balanceDue: balanceDue,
            createdAt: new Date().toISOString(),
            ratesApplied: ratesForInvoice,
            paymentHistory: paymentHistory,
            customerId: order.customerId,
            customerName: order.customerName || 'Walk-in Customer',
            customerContact: order.customerContact,
            ...(order.source && { acquisitionSource: order.source }),
            sourceOrderId: order.id,
            ...(order.hideRates ? { hideRates: true } : {}),
            // The address the customer gave when ordering is the address it
            // ships to. Without this the invoice was raised with no delivery
            // details at all and they had to be typed in again.
            ...(order.delivery?.required && order.delivery.address?.trim()
              ? { delivery: order.delivery } : {}),
            // Carry forward: if this order had previously been linked to a Shopify
            // order (and was reverted to be re-finalized), preserve the link so the
            // upsert handler reuses the same Shopify order instead of creating a new one.
            ...(order.shopifyOrderId && { shopifyOrderId: order.shopifyOrderId }),
            ...(order.shopifyOrderNumber && { shopifyOrderNumber: order.shopifyOrderNumber }),
        };

        try {
            const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);

            const finalInvoice = await runTransaction(db, async (transaction) => {
                const settingsDoc = await transaction.get(settingsDocRef);
                if (!settingsDoc.exists()) throw new Error("Global settings not found.");
                const currentSettings = settingsDoc.data() as Settings;

                const nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
                const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;

                // Guard: never silently overwrite an existing invoice if the counter is stale
                const targetInvoiceCheck = await transaction.get(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId));
                if (targetInvoiceCheck.exists()) {
                    throw new Error(`Invoice ${invoiceId} already exists — the invoice counter (lastInvoiceNumber=${currentSettings.lastInvoiceNumber}) is stale. Please contact your administrator to recalibrate it.`);
                }

                const newInvoice: Invoice = { id: invoiceId, ...baseInvoiceData };
                const payload = cleanObject({ ...baseInvoiceData });

                transaction.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), payload);
                transaction.update(settingsDocRef, { lastInvoiceNumber: nextInvoiceNumber });
                transaction.update(doc(db, FIRESTORE_COLLECTIONS.ORDERS, order.id), {
                    status: 'Completed',
                    grandTotal: balanceDue,
                    invoiceId: invoiceId,
                    // The Shopify link now lives on the invoice; clear it from the order.
                    ...(order.shopifyOrderId && { shopifyOrderId: deleteField(), shopifyOrderNumber: deleteField() }),
                    // Draft is being cancelled in parallel — clear its references too.
                    ...(order.shopifyDraftOrderId && { shopifyDraftOrderId: deleteField(), shopifyDraftOrderName: deleteField() }),
                });

                return newInvoice;
            });

            await addActivityLog('invoice.create', `Created invoice ${finalInvoice.id} from order ${order.id}`, `Customer: ${finalInvoice.customerName} | Total: ${finalInvoice.grandTotal.toLocaleString()}`, finalInvoice.id);

            set(state => { state.clearCart(); });

            if (finalInvoice) {
                if (finalInvoice.balanceDue > 0) {
                    // Customer still owes money — track in hisaab
                    await addDoc(collection(db, FIRESTORE_COLLECTIONS.HISAAB), {
                        entityId: finalInvoice.customerId || 'walk-in',
                        entityType: 'customer',
                        entityName: finalInvoice.customerName || 'Walk-in Customer',
                        date: finalInvoice.createdAt,
                        description: `Outstanding balance for Invoice ${finalInvoice.id}`,
                        cashDebit: finalInvoice.balanceDue,
                        cashCredit: 0,
                        goldDebitGrams: 0,
                        goldCreditGrams: 0,
                        linkedInvoiceId: finalInvoice.id,
                    });
                } else if (finalInvoice.balanceDue < 0) {
                    // Advance was more than the final total — we owe the customer the difference
                    await addDoc(collection(db, FIRESTORE_COLLECTIONS.HISAAB), {
                        entityId: finalInvoice.customerId || 'walk-in',
                        entityType: 'customer',
                        entityName: finalInvoice.customerName || 'Walk-in Customer',
                        date: finalInvoice.createdAt,
                        description: `Excess advance returned for Invoice ${finalInvoice.id}`,
                        cashDebit: 0,
                        cashCredit: Math.abs(finalInvoice.balanceDue),
                        goldDebitGrams: 0,
                        goldCreditGrams: 0,
                        linkedInvoiceId: finalInvoice.id,
                    });
                }
            }

            if (finalInvoice) {
                // Cancel the in-progress draft (if any) — the real Shopify order
                // for the invoice is the canonical record now.
                if (order.shopifyDraftOrderId) syncOrderShopify(order.id, 'cancel');
                syncInvoiceShopify(finalInvoice.id, 'upsert');
            }

            return finalInvoice;
        } catch (error) {
            console.error("Error finalizing order into invoice:", error);
            return null;
        }
      },
      revertOrderFromInvoice: async (orderId, invoiceId) => {
        if (get().settings.databaseLocked) return;
        try {
            // Carry forward the invoice's Shopify link to the order doc so the
            // next finalize re-uses the same Shopify order instead of creating a new one.
            const invSnap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId));
            const invShopId = invSnap.exists() ? (invSnap.data() as any)?.shopifyOrderId : undefined;
            const invShopNum = invSnap.exists() ? (invSnap.data() as any)?.shopifyOrderNumber : undefined;

            await get().deleteInvoice(invoiceId, true);
            // Preserve the order's original status instead of hardcoding 'In Progress',
            // which would upgrade a 'Pending' order incorrectly.
            const existingOrder = get().orders.find(o => o.id === orderId);
            const revertedStatus = existingOrder?.status === 'Completed' ? 'In Progress' : (existingOrder?.status || 'In Progress');
            await setDoc(doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId),
                {
                    status: revertedStatus,
                    invoiceId: deleteField(),
                    ...(invShopId && { shopifyOrderId: invShopId }),
                    ...(invShopNum && { shopifyOrderNumber: invShopNum }),
                },
                { merge: true }
            );
            await addActivityLog('order.revert', `Reverted order ${orderId}`, `Cancelled invoice ${invoiceId}`, orderId);
            // Order is back to in-progress — recreate (or refresh) its Shopify draft.
            syncOrderShopify(orderId, 'upsert');
        } catch (error) {
            console.error("Error reverting order from invoice:", error);
            throw error;
        }
      },
      refundOrder: async (orderId) => {
        if (get().settings.databaseLocked) return;
        const order = get().orders.find(o => o.id === orderId);
        if (!order) return;
        try {
            if (order.invoiceId) {
                // Trigger Shopify refund first (using the still-live invoice's link),
                // then delete the invoice locally and tell deleteInvoice not to also
                // cancel on Shopify (refund already covers it).
                syncInvoiceShopify(order.invoiceId, 'refund');
                // Delete invoice AND restore stock (isEditing=false)
                await get().deleteInvoice(order.invoiceId, false, false);
            } else if (order.shopifyOrderId) {
                // Carried-forward state: order has a Shopify link but no invoice
                // (post-revert / pre-finalize). Refund the Shopify order directly.
                syncShopifyOrderById(order.shopifyOrderId, 'refund');
            }
            // Always cancel a draft if one exists (pre-invoice state).
            if (order.shopifyDraftOrderId) syncOrderShopify(orderId, 'cancel');
            await setDoc(
                doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId),
                {
                    status: 'Refunded',
                    invoiceId: deleteField(),
                    ...(order.shopifyOrderId && { shopifyOrderId: deleteField(), shopifyOrderNumber: deleteField() }),
                },
                { merge: true }
            );
            await addActivityLog('order.refund', `Refunded order ${orderId}`, `Customer: ${order.customerName || 'Unknown'}`, orderId);
        } catch (error) {
            console.error('[refundOrder] Error:', error);
            throw error;
        }
      },
      recordOrderAdvance: async (orderId, amount, notes) => {
        if (get().settings.databaseLocked) return null;
        const orderRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);

        try {
            const updatedOrder = await runTransaction(db, async (transaction) => {
                const orderDoc = await transaction.get(orderRef);
                if (!orderDoc.exists()) {
                    throw new Error("Order not found!");
                }
                const orderData = orderDoc.data() as Order;
                
                const currentAdvance = Number(orderData.advancePayment) || 0;
                const newAdvancePayment = currentAdvance + amount;
                const newGrandTotal = orderData.subtotal - newAdvancePayment - (orderData.advanceInExchangeValue || 0);

                transaction.update(orderRef, {
                    advancePayment: newAdvancePayment,
                    grandTotal: newGrandTotal,
                });
                
                // No hisaab entry here — the advance is captured as cashCredit when
                // the order is finalized to an invoice, avoiding double-counting.

                return { ...orderData, advancePayment: newAdvancePayment, grandTotal: newGrandTotal } as Order;
            });
            syncOrderShopify(orderId, 'upsert');
            if (updatedOrder) {
              await addActivityLog('order.update', `Advance recorded for Order ${orderId}`, `Amount: ${amount.toLocaleString()}`, orderId);
            }
            return updatedOrder;
        } catch (error) {
            console.error(`Error recording advance for order ${orderId}:`, error);
            throw error;
        }
    },
      
      addHisaabEntry: async (entryData) => {
        if(get().settings.databaseLocked) return null;
        try {
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.HISAAB), entryData);
          console.log("[GemsTrack Store addHisaabEntry] Hisaab entry added with ID:", docRef.id);
          return { id: docRef.id, ...entryData };
        } catch (error) {
          console.error("[GemsTrack Store addHisaabEntry] Error adding hisaab entry:", error);
          return null;
        }
      },
      deleteHisaabEntry: async (entryId: string) => {
        if(get().settings.databaseLocked) return;
        console.log(`[GemsTrack Store deleteHisaabEntry] Attempting to delete entry ID ${entryId}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.HISAAB, entryId));
          console.log(`[GemsTrack Store deleteHisaabEntry] Entry ID ${entryId} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteHisaabEntry] Error deleting entry ID ${entryId} from Firestore:`, error);
          throw error;
        }
      },
      
      addExpense: async (expenseData) => {
        if(get().settings.databaseLocked) return null;
        try {
          // If a partner fronted the cash, create a matching loan entry on
          // their ledger first so we can store its id alongside the expense.
          let ledgerEntryId: string | undefined;
          const paidBy = expenseData.paidBy;
          if (paidBy === 'ammar' || paidBy === 'mina') {
            const ledger = paidBy === 'ammar' ? 'ammar_ledger' : 'mina_ledger';
            const ledgerDoc = await addDoc(collection(db, ledger), {
              type: 'payment',
              category: 'loan',
              description: `Expense paid: ${expenseData.description}`,
              amount: expenseData.amount,
              date: Timestamp.fromDate(new Date(expenseData.date)),
              createdAt: serverTimestamp(),
              linkedExpenseId: 'pending', // patched after expense create
            });
            ledgerEntryId = ledgerDoc.id;
          }

          const persisted: Omit<Expense, 'id'> = { ...expenseData, ...(ledgerEntryId && { ledgerEntryId }) };
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.EXPENSES), persisted);

          // Backfill the linkedExpenseId on the ledger entry now that we know it
          if (ledgerEntryId && (paidBy === 'ammar' || paidBy === 'mina')) {
            const ledger = paidBy === 'ammar' ? 'ammar_ledger' : 'mina_ledger';
            await setDoc(doc(db, ledger, ledgerEntryId), { linkedExpenseId: docRef.id }, { merge: true });
          }

          await addActivityLog('expense.create', `Added expense: ${expenseData.description}`, `Category: ${expenseData.category} | Amount: ${expenseData.amount.toLocaleString()}${paidBy && paidBy !== 'business' ? ` | Paid by: ${paidBy}` : ''}`, docRef.id);
          return { id: docRef.id, ...persisted } as Expense;
        } catch (error) {
          console.error("[GemsTrack Store addExpense] Error adding expense:", error);
          return null;
        }
      },
      updateExpense: async (id, updatedExpenseData) => {
        if(get().settings.databaseLocked) return;
        try {
          const existing = get().expenses.find(e => e.id === id);
          const prevPaidBy: PaidBy = (existing?.paidBy as PaidBy) || 'business';
          const nextPaidBy: PaidBy = (updatedExpenseData.paidBy as PaidBy) || 'business';
          const prevLedgerId = existing?.ledgerEntryId;

          // If the payer changed, clean up the old ledger entry.
          if (prevLedgerId && (prevPaidBy !== nextPaidBy || updatedExpenseData.amount !== existing?.amount || updatedExpenseData.date !== existing?.date)) {
            const prevLedger = prevPaidBy === 'ammar' ? 'ammar_ledger' : prevPaidBy === 'mina' ? 'mina_ledger' : null;
            if (prevLedger) await deleteDoc(doc(db, prevLedger, prevLedgerId)).catch(() => {});
          }

          let newLedgerId: string | undefined;
          if (nextPaidBy === 'ammar' || nextPaidBy === 'mina') {
            const ledger = nextPaidBy === 'ammar' ? 'ammar_ledger' : 'mina_ledger';
            // If the payer + amount + date are unchanged AND we already have a ledger id, keep it
            const samePayer = prevPaidBy === nextPaidBy;
            const sameAmount = updatedExpenseData.amount === existing?.amount;
            const sameDate = updatedExpenseData.date === existing?.date;
            if (samePayer && sameAmount && sameDate && prevLedgerId) {
              newLedgerId = prevLedgerId;
              // Just update description on the existing ledger entry
              await setDoc(doc(db, ledger, prevLedgerId), { description: `Expense paid: ${updatedExpenseData.description || ''}` }, { merge: true });
            } else {
              const ledgerDoc = await addDoc(collection(db, ledger), {
                type: 'payment',
                category: 'loan',
                description: `Expense paid: ${updatedExpenseData.description || ''}`,
                amount: updatedExpenseData.amount,
                date: Timestamp.fromDate(new Date(updatedExpenseData.date as string)),
                createdAt: serverTimestamp(),
                linkedExpenseId: id,
              });
              newLedgerId = ledgerDoc.id;
            }
          }

          const finalData = { ...updatedExpenseData, ...(newLedgerId ? { ledgerEntryId: newLedgerId } : { ledgerEntryId: null }) } as Partial<Expense>;
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.EXPENSES, id), finalData, { merge: true });
          await addActivityLog('expense.update', `Updated expense: ${updatedExpenseData.description}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store updateExpense] Error updating expense ID ${id}:`, error);
        }
      },
      deleteExpense: async (id: string) => {
        if(get().settings.databaseLocked) return;
        const existing = get().expenses.find(e => e.id === id);
        const expenseDesc = existing?.description || id;
        try {
          // Clean up paired ledger entry if there is one
          if (existing?.ledgerEntryId && existing.paidBy && existing.paidBy !== 'business') {
            const ledger = existing.paidBy === 'ammar' ? 'ammar_ledger' : 'mina_ledger';
            await deleteDoc(doc(db, ledger, existing.ledgerEntryId)).catch(() => {});
          }
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.EXPENSES, id));
          await addActivityLog('expense.delete', `Deleted expense: ${expenseDesc}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store deleteExpense] Error deleting expense ID ${id}:`, error);
          throw error;
        }
      },

      addAdditionalRevenue: async (data) => {
        if(get().settings.databaseLocked) return null;
        try {
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.ADDITIONAL_REVENUE), data);
          await addActivityLog('revenue.create', `Added revenue: ${data.description}`, `Amount: ${data.amount.toLocaleString()}`, docRef.id);
          return { id: docRef.id, ...data };
        } catch (error) {
          console.error('[GemsTrack Store addAdditionalRevenue] Error:', error);
          return null;
        }
      },
      updateAdditionalRevenue: async (id, data) => {
        if(get().settings.databaseLocked) return;
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.ADDITIONAL_REVENUE, id), data, { merge: true });
          await addActivityLog('revenue.update', `Updated revenue: ${data.description}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store updateAdditionalRevenue] Error:`, error);
        }
      },
      deleteAdditionalRevenue: async (id: string) => {
        if(get().settings.databaseLocked) return;
        const desc = get().additionalRevenues.find(r => r.id === id)?.description || id;
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.ADDITIONAL_REVENUE, id));
          await addActivityLog('revenue.delete', `Deleted revenue: ${desc}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store deleteAdditionalRevenue] Error:`, error);
          throw error;
        }
      },

      // ── Karigar jobs (standalone workshop work, not from a customer order) ──
      addKarigarJob: async (data) => {
        if (get().settings.databaseLocked) return null;
        try {
          const clean = cleanObject(data as KarigarJob);
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.KARIGAR_JOBS), clean);
          await addActivityLog('job.create', `Assigned job to ${data.karigarName}`, `${data.description}`, docRef.id);
          return { id: docRef.id, ...data };
        } catch (error) {
          console.error('[GemsTrack Store addKarigarJob] Error:', error);
          return null;
        }
      },
      updateKarigarJob: async (id, data) => {
        if (get().settings.databaseLocked) return;
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGAR_JOBS, id), cleanObject(data as KarigarJob), { merge: true });
          await addActivityLog('job.update', `Updated workshop job`, `ID: ${id}`, id);
        } catch (error) {
          console.error('[GemsTrack Store updateKarigarJob] Error:', error);
        }
      },
      deleteKarigarJob: async (id) => {
        if (get().settings.databaseLocked) return;
        const job = get().karigarJobs.find(j => j.id === id);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGAR_JOBS, id));
          await addActivityLog('job.delete', `Deleted workshop job: ${job?.description || id}`, `Karigar: ${job?.karigarName || '—'}`, id);
        } catch (error) {
          console.error('[GemsTrack Store deleteKarigarJob] Error:', error);
          throw error;
        }
      },
      setKarigarJobStatus: async (id, status) => {
        if (get().settings.databaseLocked) return;
        const job = get().karigarJobs.find(j => j.id === id);
        try {
          const patch: Partial<KarigarJob> = { status };
          if (status === 'completed') patch.completedDate = new Date().toISOString();
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGAR_JOBS, id), patch, { merge: true });
          await addActivityLog('job.update', `Job marked ${status}`, `${job?.description || id} — ${job?.karigarName || ''}`, id);
        } catch (error) {
          console.error('[GemsTrack Store setKarigarJobStatus] Error:', error);
        }
      },

      // Like delete and markReturned below, these rethrow: the page reports
      // the failure, rather than toasting "Added" over a write that never landed.
      addGivenItem: async (data) => {
        if (get().settings.databaseLocked) return null;
        try {
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS), data);
          await addActivityLog('given.create', `Given item: ${data.description}`, `To: ${data.recipientName}`, docRef.id);
          return { id: docRef.id, ...data };
        } catch (error) {
          console.error('[GemsTrack Store addGivenItem] Error:', error);
          throw error;
        }
      },
      updateGivenItem: async (id, data) => {
        if (get().settings.databaseLocked) return;
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS, id), data, { merge: true });
          await addActivityLog('given.update', `Updated given item`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store updateGivenItem] Error:`, error);
          throw error;
        }
      },
      deleteGivenItem: async (id) => {
        if (get().settings.databaseLocked) return;
        const desc = get().givenItems.find(g => g.id === id)?.description || id;
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS, id));
          await addActivityLog('given.delete', `Deleted given item: ${desc}`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store deleteGivenItem] Error:`, error);
          throw error;
        }
      },
      markGivenItemReturned: async (id, returnedDate) => {
        if (get().settings.databaseLocked) return;
        const item = get().givenItems.find(g => g.id === id);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS, id), { status: 'returned', returnedDate }, { merge: true });
          await addActivityLog('given.returned', `Item returned: ${item?.description || id}`, `From: ${item?.recipientName || ''}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store markGivenItemReturned] Error:`, error);
          throw error;
        }
      },

      // ── Repairs ──────────────────────────────────────────────────────────
      addRepair: async ({ advance, advanceMethod, ...data }) => {
        if (get().settings.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
        // The highest number already on file is a floor for the counter, so a
        // settings document written before repairs existed cannot reissue one.
        const onFile = get().repairs.reduce((m, r) => {
          const n = Number(String(r.id).replace(/^REP-/, ''));
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const now = new Date().toISOString();
        const created = await runTransaction(db, async (tx) => {
          const settingsRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          const snap = await tx.get(settingsRef);
          const next = Math.max(Number(snap.data()?.lastRepairNumber) || 0, onFile) + 1;
          const id = `REP-${String(next).padStart(6, '0')}`;
          const repairRef = doc(db, FIRESTORE_COLLECTIONS.REPAIRS, id);
          const clash = await tx.get(repairRef);
          if (clash.exists()) throw new Error(`Repair ${id} already exists — the repair counter is behind. Try again.`);

          const payments: RepairPayment[] = [];
          if (advance && advance > 0) {
            const revenueRef = doc(collection(db, FIRESTORE_COLLECTIONS.ADDITIONAL_REVENUE));
            tx.set(revenueRef, {
              date: now, amount: advance, repairId: id,
              description: `Repair ${id} — advance: ${data.item} (${data.customerName || 'walk-in'})`,
            });
            payments.push({ amount: advance, date: now, ...(advanceMethod ? { method: advanceMethod } : {}), revenueId: revenueRef.id, note: 'Advance' });
          }
          const repair: Repair = cleanObject({ ...data, id, payments, status: 'received' as RepairStatus, receivedAt: data.receivedAt || now });
          tx.set(repairRef, repair);
          tx.update(settingsRef, { lastRepairNumber: next });
          return repair;
        });
        await addActivityLog('repair.create', `Repair ${created.id} received: ${created.item}`, `From: ${created.customerName || 'walk-in'}`, created.id);
        return created;
      },

      updateRepair: async (id, data) => {
        if (get().settings.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
        // A field left empty on the form clears it: undefined becomes a delete,
        // where a plain merge would quietly keep the old karigar or estimate.
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) patch[k] = v === undefined ? deleteField() : v;
        await setDoc(doc(db, FIRESTORE_COLLECTIONS.REPAIRS, id), patch, { merge: true });
        await addActivityLog('repair.update', `Repair ${id} updated`, data.item || '', id);
      },

      setRepairStatus: async (id, status, extra = {}) => {
        if (get().settings.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
        const now = new Date().toISOString();
        const stamp: Partial<Repair> =
          status === 'ready' ? { readyAt: now }
          : status === 'collected' ? { collectedAt: now }
          : {};
        await setDoc(doc(db, FIRESTORE_COLLECTIONS.REPAIRS, id), cleanObject({ status, ...stamp, ...extra }), { merge: true });
        await addActivityLog('repair.status', `Repair ${id}: ${REPAIR_STATUS_LABELS[status]}`, '', id);
      },

      recordRepairPayment: async (id, payment) => {
        if (get().settings.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
        if (!(payment.amount > 0)) return;
        await runTransaction(db, async (tx) => {
          const repairRef = doc(db, FIRESTORE_COLLECTIONS.REPAIRS, id);
          const snap = await tx.get(repairRef);
          if (!snap.exists()) throw new Error(`Repair ${id} not found.`);
          const repair = snap.data() as Repair;
          const revenueRef = doc(collection(db, FIRESTORE_COLLECTIONS.ADDITIONAL_REVENUE));
          tx.set(revenueRef, {
            date: payment.date, amount: payment.amount, repairId: id,
            description: `Repair ${id}: ${repair.item} (${repair.customerName || 'walk-in'})`,
          });
          tx.update(repairRef, { payments: [...(repair.payments || []), cleanObject({ ...payment, revenueId: revenueRef.id })] });
        });
        await addActivityLog('repair.payment', `Repair ${id}: PKR ${payment.amount.toLocaleString()} received`, payment.method || '', id);
      },

      deleteRepair: async (id) => {
        if (get().settings.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
        const repair = get().repairs.find(r => r.id === id);
        const batch = writeBatch(db);
        for (const p of repair?.payments || []) {
          if (p.revenueId) batch.delete(doc(db, FIRESTORE_COLLECTIONS.ADDITIONAL_REVENUE, p.revenueId));
        }
        batch.delete(doc(db, FIRESTORE_COLLECTIONS.REPAIRS, id));
        await batch.commit();
        await addActivityLog('repair.delete', `Repair ${id} deleted`, repair ? `${repair.item} — ${repair.customerName}` : '', id);
      },

      addPrintHistory: (sku) => set(state => {
        const newEntry: PrintHistoryEntry = { sku, timestamp: new Date().toISOString() };
        // Add to the beginning and keep only the last 50 entries
        state.printHistory = [newEntry, ...state.printHistory].slice(0, 50);
      }),
    })),
    {
      name: 'gemstrack-pos-storage',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') return ssrDummyStorage;
        return localStorage;
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        cart: state.cart,
        printHistory: state.printHistory,
      }),
      version: 17,
      migrate: (persistedState, version) => {
        const oldState = persistedState as any;
        if (version < 15) {
            if (oldState.settings && !oldState.settings.paymentMethods) {
                oldState.settings.paymentMethods = [];
            }
        }
        if (version < 16) {
          if (!oldState.printHistory) {
            oldState.printHistory = [];
          }
        }
        if (version < 17) {
          // Settings are no longer persisted locally; they sync exclusively from Firestore.
          delete oldState.settings;
        }
        return oldState as AppState;
      },
    }
  )
);

// --- Exported Helper Functions ---
export const DEFAULT_KARAT_VALUE_FOR_CALCULATION: KaratValue = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
export const GOLD_COIN_CATEGORY_ID: string = GOLD_COIN_CATEGORY_ID_INTERNAL;
export const MENS_RING_CATEGORY_ID: string = MENS_RING_CATEGORY_ID_INTERNAL;

export const calculateProductCosts = (
  product: Omit<Product, 'sku' | 'qrCodeDataUrl' | 'imageUrl' | 'name'> & {
    categoryId?: string;
    name?: string;
  },
  rates: Partial<Settings>
) => {
    const fullRates = {
        goldRatePerGram18k: rates.goldRatePerGram18k || 0,
        goldRatePerGram21k: rates.goldRatePerGram21k || 0,
        goldRatePerGram22k: rates.goldRatePerGram22k || 0,
        goldRatePerGram24k: rates.goldRatePerGram24k || 0,
        palladiumRatePerGram: rates.palladiumRatePerGram || 0,
        platinumRatePerGram: rates.platinumRatePerGram || 0,
        silverRatePerGram: rates.silverRatePerGram || 0,
    };
  return _calculateProductCostsInternal(product, fullRates);
};

// --- SELECTOR DEFINITIONS ---
export const selectCartDetails = (state: AppState): EnrichedCartItem[] => {
  if (!state.cart || !Array.isArray(state.cart)) {
    return [];
  }
  if (!state.settings) {
    return [];
  }

  return state.cart.map((cartItem) => {
      const costs = calculateProductCosts(cartItem, state.settings);
      return {
        ...cartItem,
        quantity: 1, // Always 1
        totalPrice: costs.totalPrice,
        lineItemTotal: costs.totalPrice,
      };
    });
};

export const selectCartSubtotal = (state: AppState): number => {
  const detailedCartItems = selectCartDetails(state);
  if (!Array.isArray(detailedCartItems)) {
    console.error("[GemsTrack selectCartSubtotal] selectCartDetails did not return an array.");
    return 0;
  }
  return detailedCartItems.reduce((total, item) => total + item.lineItemTotal, 0);
};

export const selectCategoryTitleById = (categoryId: string, state: AppState): string => {
    const category = state.categories.find(c => c.id === categoryId);
    return category ? category.title : 'Uncategorized';
};

export const selectProductWithCosts = (sku: string, state: AppState): (Product & ReturnType<typeof calculateProductCosts>) | undefined => {
    const product = state.products.find(p => p.sku === sku);
    if (!product) return undefined;
    const costs = calculateProductCosts(product, state.settings);
    return { ...product, ...costs };
};

console.log("[GemsTrack Store] store.ts: Module fully evaluated.");
