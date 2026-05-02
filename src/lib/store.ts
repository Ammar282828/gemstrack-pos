
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc, query, orderBy, where, onSnapshot, addDoc, runTransaction, getDocsFromCache, updateDoc, deleteField } from 'firebase/firestore';
import { db, auth, firebaseConfig } from '@/lib/firebase';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';


// --- Firestore Collection Names ---
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
};
const GLOBAL_SETTINGS_DOC_ID = "global";


// --- Helper Functions and Constants ---
const DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = '21k';
const GOLD_COIN_CATEGORY_ID_INTERNAL = 'cat017';
const MENS_RING_CATEGORY_ID_INTERNAL = 'cat018';

/**
 * Fire-and-forget Shopify sync. Idempotent on the server; safe to call from
 * any invoice mutation. Skipped for SHOPIFY-originated docs and during SSR.
 */
function syncInvoiceShopify(invoiceId: string | undefined | null, action: 'upsert' | 'cancel' | 'refund' = 'upsert') {
  if (!invoiceId) return;
  if (typeof window === 'undefined') return;
  if (invoiceId.startsWith('SHOPIFY-')) return;
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
  fetch('/api/shopify/sync/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, action }),
  }).catch(() => { /* fire-and-forget */ });
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


function _getRateForKarat(karat: KaratValue | string | undefined, rates: { goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number }): number {
    const k = String(karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL) as KaratValue;
    switch(k) {
        case '24k': return rates.goldRatePerGram24k;
        case '22k': return rates.goldRatePerGram22k;
        case '21k': return rates.goldRatePerGram21k;
        case '18k': return rates.goldRatePerGram18k;
        default: return 0;
    }
}


function _calculateSingleMetalCost(
    metalType: MetalType,
    karat: KaratValue | string | undefined,
    weightG: number,
    rates: { 
        goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
        palladiumRatePerGram: number; platinumRatePerGram: number; silverRatePerGram: number; 
    }
): number {
    let cost = 0;
    const { palladiumRatePerGram, platinumRatePerGram, silverRatePerGram } = rates;
    const validWeightG = Math.max(0, Number(weightG) || 0);

    if (metalType === 'gold') {
        const rate = _getRateForKarat(karat, rates);
        if (rate > 0) {
            cost = validWeightG * rate;
        }
    } else if (metalType === 'palladium' && palladiumRatePerGram > 0) {
        cost = validWeightG * palladiumRatePerGram;
    } else if (metalType === 'platinum' && platinumRatePerGram > 0) {
        cost = validWeightG * platinumRatePerGram;
    } else if (metalType === 'silver' && silverRatePerGram > 0) {
        cost = validWeightG * silverRatePerGram;
    }
    return cost;
}


function _calculateProductCostsInternal(
  product: {
    categoryId?: string;
    name?: string;
    metalType: MetalType;
    karat?: KaratValue | string;
    metalWeightG: number;
    secondaryMetalType?: MetalType;
    secondaryMetalKarat?: KaratValue;
    secondaryMetalWeightG?: number;
    stoneWeightG: number;
    wastagePercentage: number;
    makingCharges: number;
    hasDiamonds: boolean;
    diamondCharges: number;
    stoneCharges: number;
    miscCharges: number;
    isCustomPrice?: boolean;
    customPrice?: number;
    silverRatePerGram?: number;
  },
  rates: { 
      goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
      palladiumRatePerGram: number; platinumRatePerGram: number; silverRatePerGram: number; 
  }
) {
  // If manual price override is active, just return that price.
  if (product.isCustomPrice) {
    return {
      metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
      totalPrice: product.customPrice || 0,
    };
  }

  // NEW: Special simplified calculation for Silver
  if (product.metalType === 'silver') {
    // Prioritize the product-specific rate, fall back to the global rate.
    const silverRatePerGram = product.silverRatePerGram || rates.silverRatePerGram || 0;
    
    // For silver, the provided rate is all-inclusive for metal, making, and wastage.
    const allInSilverCost = (Number(product.metalWeightG) || 0) * silverRatePerGram;
    
    const stoneChargesValue = Number(product.stoneCharges) || 0;
    const miscChargesValue = Number(product.miscCharges) || 0;
    const diamondChargesValue = Number(product.diamondCharges) || 0;

    const totalPrice = allInSilverCost + stoneChargesValue + diamondChargesValue + miscChargesValue;

    if (isNaN(totalPrice)) {
      console.error("[GemsTrack Store _calculateProductCostsInternal] CRITICAL: Produced NaN for Silver. Details:", { product, rates });
      return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, totalPrice: 0 };
    }

    return {
      metalCost: allInSilverCost, // This represents the (rate * grams) part.
      wastageCost: 0, // Considered bundled into the rate.
      makingCharges: 0, // Considered bundled into the rate.
      diamondCharges: diamondChargesValue,
      stoneCharges: stoneChargesValue,
      miscCharges: miscChargesValue,
      totalPrice: totalPrice,
    };
  }

  // --- Existing logic for Gold, Platinum, etc. ---
  const primaryMetalNetWeightG = Math.max(0, (Number(product.metalWeightG) || 0) - (Number(product.stoneWeightG) || 0));
  if (primaryMetalNetWeightG < 0) {
      console.warn(`[GemsTrack Store _calculateProductCostsInternal] Net primary metal weight is negative for ${product.name}. Clamping to 0.`);
  }

  const primaryMetalCost = _calculateSingleMetalCost(product.metalType, product.karat, primaryMetalNetWeightG, rates);
  
  let secondaryMetalCost = 0;
  if (product.secondaryMetalType && product.secondaryMetalWeightG) {
      secondaryMetalCost = _calculateSingleMetalCost(product.secondaryMetalType, product.secondaryMetalKarat, product.secondaryMetalWeightG, rates);
  }

  const totalMetalCost = primaryMetalCost + secondaryMetalCost;
  
  const isActualGoldCoin = product.categoryId === GOLD_COIN_CATEGORY_ID_INTERNAL && product.metalType === 'gold';
  // Exclude silver from wastage calculation
  const applyWastage = product.metalType === 'gold' || product.metalType === 'platinum' || product.metalType === 'palladium';
  const wastagePercentage = isActualGoldCoin || !applyWastage ? 0 : (Number(product.wastagePercentage) || 0);
  const makingCharges = isActualGoldCoin ? 0 : (Number(product.makingCharges) || 0);
  const hasDiamondsValue = isActualGoldCoin ? false : product.hasDiamonds;
  const diamondChargesValue = hasDiamondsValue ? (Number(product.diamondCharges) || 0) : 0;
  const stoneChargesValue = isActualGoldCoin ? 0 : (Number(product.stoneCharges) || 0);
  const miscChargesValue = isActualGoldCoin ? 0 : (Number(product.miscCharges) || 0);

  const wastageCost = totalMetalCost * (wastagePercentage / 100);
  const validWastageCost = Number(wastageCost) || 0;
  const totalPrice = totalMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneChargesValue + miscChargesValue;
  
  if (isNaN(totalPrice)) {
    console.error("[GemsTrack Store _calculateProductCostsInternal] CRITICAL: Produced NaN. Details:", { product, rates });
    return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, totalPrice: 0 };
  }

  return {
    metalCost: totalMetalCost,
    wastageCost: validWastageCost,
    makingCharges: makingCharges,
    diamondCharges: diamondChargesValue,
    stoneCharges: stoneChargesValue,
    miscCharges: miscChargesValue,
    totalPrice: totalPrice,
  };
}

/** Public helper — computes the selling price for a product given current settings rates. */
export function calculateProductPrice(product: {
  metalType: MetalType;
  karat?: KaratValue | string;
  metalWeightG: number;
  secondaryMetalType?: MetalType;
  secondaryMetalKarat?: KaratValue;
  secondaryMetalWeightG?: number;
  stoneWeightG: number;
  wastagePercentage: number;
  makingCharges: number;
  hasDiamonds: boolean;
  diamondCharges: number;
  stoneCharges: number;
  miscCharges: number;
  isCustomPrice?: boolean;
  customPrice?: number;
  categoryId?: string;
  name?: string;
  silverRatePerGram?: number;
}, rates: {
  goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
  palladiumRatePerGram: number; platinumRatePerGram: number; silverRatePerGram: number;
}): number {
  return _calculateProductCostsInternal(product, rates).totalPrice;
}

// --- Type Definitions ---
export type MetalType = 'gold' | 'palladium' | 'platinum' | 'silver';
export type KaratValue = '18k' | '21k' | '22k' | '24k';
export type ThemeKey = 'default' | 'forest' | 'ocean' | 'sunset' | 'amethyst' | 'quartz' | 'slate' | 'latte' | 'mint' | 'gold';

export interface Theme {
  key: ThemeKey;
  name: string;
  primaryColorHsl: string;
}

export const AVAILABLE_THEMES: Theme[] = [
    { key: 'default', name: 'Default Dark', primaryColorHsl: '210 40% 98%' },
    { key: 'slate', name: 'Slate', primaryColorHsl: '210 90% 75%' },
    { key: 'forest', name: 'Forest', primaryColorHsl: '130 65% 60%' },
    { key: 'ocean', name: 'Ocean', primaryColorHsl: '185 70% 55%' },
    { key: 'sunset', name: 'Sunset', primaryColorHsl: '30 90% 60%' },
    { key: 'amethyst', name: 'Amethyst', primaryColorHsl: '260 80% 70%' },
    { key: 'quartz', name: 'Quartz', primaryColorHsl: '340 85% 70%' },
    { key: 'latte', name: 'Latte', primaryColorHsl: '40 80% 70%' },
    { key: 'mint', name: 'Mint', primaryColorHsl: '155 80% 65%' },
    { key: 'gold', name: 'Gold', primaryColorHsl: '45 90% 65%' },
];

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
  palladiumRatePerGram: number;
  platinumRatePerGram: number;
  silverRatePerGram: number;
  shopName: string;
  shopAddress: string;
  shopContact: string;
  shopLogoUrl?: string;
  shopLogoUrlBlack?: string;
  lastInvoiceNumber: number;
  lastOrderNumber: number;
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
  // WhatsApp Notifications
  notifEnabled?: boolean;
  notifPhones?: string[]; // recipient numbers in international format, no +, e.g. ["923262275554"]
  notifNewOrder?: boolean;
  notifOrderCompleted?: boolean;
  notifOrderCancelled?: boolean;
  notifDailyChecklist?: boolean;
  notifEndOfDay?: boolean;
  notifWeeklyReport?: boolean;
  notifOrderOverdue?: boolean; // daily check: orders Pending/In Progress for 7+ days
  notifGivenItems?: boolean;   // daily check: given items unreturned for 7+ days
  notifKarigarPayment?: boolean; // weekly check: unpaid karigar batches
  notifDailyChecklistTime?: string; // "HH:MM", default "09:00"
  notifEndOfDayTime?: string;       // "HH:MM", default "19:00"
}

export interface Category {
  id: string;
  title: string;
}

export interface Customer {
  id: string; // Firestore document ID
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  shopifyCustomerId?: string;
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
}

export interface Payment {
  amount: number;
  date: string; // ISO string
  notes?: string;
}

export interface Invoice {
  id: string; // Firestore document ID
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
  paymentHistory: Payment[];
  sourceOrderId?: string; // Set when invoice is created from an order
  source?: string; // 'shopify_import' | 'shopify' for imported/synced orders
  shopifyOrderName?: string;
  shopifyOrderId?: string;
  shopifyOrderNumber?: number;
  shopifyDraftOrderId?: string;
  shopifyCheckoutUrl?: string;
  status?: 'Refunded'; // Set when invoice has been refunded
  refundedAt?: string; // ISO string of refund time
}

export interface Karigar {
  id: string; // Firestore document ID
  name: string;
  contact?: string;
  notes?: string;
}

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
}

export interface Order {
  id: string; // Firestore document ID, e.g., ORD-000001
  createdAt: string; // ISO string
  status: OrderStatus;
  items: OrderItem[];
  ratesApplied: Partial<Settings>; // Store all rates at time of order
  subtotal: number;
  advancePayment: number;
  advanceGoldDetails?: string;
  grandTotal: number;
  summary?: string;
  customerId?: string;
  customerName?: string;
  customerContact?: string;
  advanceInExchangeDescription?: string; // For gold/diamonds given by customer
  advanceInExchangeValue?: number; // Estimated value of the exchange
  invoiceId?: string; // Set when order is finalized into an invoice
  tcsConsignmentNo?: string; // TCS Envio courier consignment number
  notes?: string;
  shopifyOrderId?: string; // Carried forward from invoice during edit/revert so the next finalize re-links the same Shopify order
  shopifyOrderNumber?: number;
  shopifyDraftOrderId?: string; // Set while the order is in-progress (pre-invoice) and mirrored to Shopify as a draft order
  shopifyDraftOrderName?: string; // Shopify-assigned draft name (e.g. #D1)
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
  'Repairs & Maintenance', 'Taxes', 'Travel', 'Making Charges', 'Other'
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export interface Expense {
  id: string;
  date: string; // ISO String
  category: ExpenseCategory | string; // Allow 'Other' as custom string
  description: string;
  amount: number;
  karigarId?: string; // Links this expense to a karigar payment
  batchId?: string;   // Links this expense to a karigar hisaab batch
}

export interface KarigarBatch {
  id: string;
  karigarId: string;
  label: string;       // e.g., "March 2026"
  startDate: string;   // ISO
  closedDate?: string; // ISO — undefined means open/current
  totalPaid?: number;  // Stored when closed for quick display
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
}

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
  'cat017': 'GCN', 'cat018': 'MRN',
};

// --- Initial Data Definitions (For reference or one-time seeding, not for store initial state) ---
const initialSettingsData: Settings = {
  goldRatePerGram24k: 240000, goldRatePerGram22k: 220000, goldRatePerGram21k: 210000, goldRatePerGram18k: 180000,
  palladiumRatePerGram: 22000, platinumRatePerGram: 25000, silverRatePerGram: 250,
  shopName: "MINA", shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "", shopLogoUrlBlack: "", lastInvoiceNumber: 0,
  lastOrderNumber: 0,
  allowedDeviceIds: ["device-1761585988934-qghkiup"],
  weprintApiSkus: [],
  paymentMethods: [],
  theme: 'slate',
  databaseLocked: false,
  notifEnabled: false,
  notifPhones: [],
  notifNewOrder: true,
  notifOrderCompleted: true,
  notifOrderCancelled: true,
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

export const staticCategories: Category[] = [
  { id: 'cat001', title: 'Rings' }, { id: 'cat002', title: 'Tops' },
  { id: 'cat003', title: 'Balis' }, { id: 'cat004', title: 'Lockets' },
  { id: 'cat005', title: 'Bracelets' }, { id: 'cat006', title: 'Bracelet and Ring Set' },
  { id: 'cat007', title: 'Bangles' }, { id: 'cat008', title: 'Chains' },
  { id: 'cat009', title: 'Bands' }, { id: 'cat010', title: 'Locket Sets without Bangle' },
  { id: 'cat011', title: 'Locket Set with Bangle' }, { id: 'cat012', title: 'String Sets' },
  { id: 'cat013', title: 'Stone Necklace Sets without Bracelets' },
  { id: 'cat014', title: 'Stone Necklace Sets with Bracelets' },
  { id: 'cat015', title: 'Gold Necklace Sets with Bracelets' },
  { id: 'cat016', title: 'Gold Necklace Sets without Bracelets' },
  { id: 'cat017', title: 'Gold Coins' },
  { id: 'cat018', title: "Men's Rings" },
];

export const LOG_EVENT_TYPES = ['product', 'customer', 'karigar', 'invoice', 'order', 'expense'] as const;
export type LogEventType = 
  | 'product.create' | 'product.update' | 'product.delete'
  | 'customer.create' | 'customer.update' | 'customer.delete'
  | 'karigar.create' | 'karigar.update' | 'karigar.delete'
  | 'invoice.create' | 'invoice.update' | 'invoice.payment' | 'invoice.refund' | 'invoice.delete'
  | 'order.create' | 'order.update' | 'order.delete' | 'order.revert' | 'order.refund'
  | 'expense.create' | 'expense.update' | 'expense.delete'
  | 'revenue.create' | 'revenue.update' | 'revenue.delete'
  | 'given.create' | 'given.update' | 'given.delete' | 'given.returned';

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
  cart: CartItem[]; // This will be persisted
  generatedInvoices: Invoice[];
  karigars: Karigar[];
  karigarBatches: KarigarBatch[];
  silverTransactions: SilverTransaction[];
  orders: Order[];
  hisaabEntries: HisaabEntry[];
  expenses: Expense[];
  additionalRevenues: AdditionalRevenue[];
  givenItems: GivenItem[];
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
  deleteCustomer: (id: string) => Promise<void>;
  mergeCustomers: (keepId: string, deleteId: string) => Promise<{ updatedDocs: number }>;


  loadKarigars: () => void;
  addKarigar: (karigarData: Omit<Karigar, 'id'>) => Promise<Karigar | null>;
  updateKarigar: (id: string, updatedKarigarData: Partial<Omit<Karigar, 'id'>>) => Promise<void>;
  deleteKarigar: (id: string) => Promise<void>;
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
    existingInvoiceId?: string
  ) => Promise<Invoice | null>;
  updateInvoicePayment: (invoiceId: string, paymentAmount: number, paymentDate: string) => Promise<Invoice | null>;
  refundInvoicePartial: (invoiceId: string, refundAmount: number, reason?: string) => Promise<Invoice | null>;
  updateInvoiceDiscount: (invoiceId: string, newDiscountAmount: number) => Promise<Invoice | null>;
  syncHisaabOutstandingBalances: () => Promise<void>;
  deleteInvoice: (invoiceId: string, isEditing?: boolean, syncShopify?: boolean) => Promise<void>;
  
  loadOrders: () => void;
  addOrder: (orderData: OrderDataForAdd) => Promise<Order | null>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  updateOrderItemStatus: (orderId: string, itemIndex: number, isCompleted: boolean) => Promise<void>;
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

  loadGivenItems: () => void;
  addGivenItem: (data: Omit<GivenItem, 'id'>) => Promise<GivenItem | null>;
  updateGivenItem: (id: string, data: Partial<Omit<GivenItem, 'id'>>) => Promise<void>;
  deleteGivenItem: (id: string) => Promise<void>;
  markGivenItemReturned: (id: string, returnedDate: string) => Promise<void>;

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
  loadingKey: 'isProductsLoading' | 'isCustomersLoading' | 'isKarigarsLoading' | 'isKarigarBatchesLoading' | 'isSilverTransactionsLoading' | 'isInvoicesLoading' | 'isOrdersLoading' | 'isHisaabLoading' | 'isExpensesLoading' | 'isAdditionalRevenueLoading' | 'isGivenItemsLoading' | 'isSoldProductsLoading' | 'isActivityLogLoading',
  errorKey: 'productsError' | 'customersError' | 'karigarsError' | 'karigarBatchesError' | 'silverTransactionsError' | 'invoicesError' | 'ordersError' | 'hisaabError' | 'expensesError' | 'additionalRevenueError' | 'givenItemsError' | 'soldProductsError' | 'activityLogError',
  loadedKey: 'hasProductsLoaded' | 'hasCustomersLoaded' | 'hasKarigarsLoaded' | 'hasKarigarBatchesLoaded' | 'hasSilverTransactionsLoaded' | 'hasInvoicesLoaded' | 'hasOrdersLoaded' | 'hasHisaabLoaded' | 'hasExpensesLoaded' | 'hasAdditionalRevenueLoaded' | 'hasGivenItemsLoaded' | 'hasSoldProductsLoaded' | 'hasActivityLogLoaded',
  orderByField: string = "name",
  orderByDirection: "asc" | "desc" = "asc"
) => {
  return (set: (fn: Partial<AppState> | ((state: AppState) => void)) => void, get: () => AppState) => {
    if (get()[loadedKey]) return;

    set({ [loadingKey]: true, [errorKey]: null } as unknown as Partial<AppState>);

    const q = query(collection(db, collectionName), orderBy(orderByField, orderByDirection));

    const attachListener = (retryCount = 0) => {
      const unsubscribe = onSnapshot(q,
        (serverSnapshot) => {
          const list = serverSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as T));
          
          set({
            [stateKey]: list,
            [loadingKey]: false,
            [loadedKey]: true,
            [errorKey]: null,
          } as unknown as Partial<AppState>);

          const source = serverSnapshot.metadata.fromCache ? "cache" : "server";
          console.log(`[GemsTrack Store] Data for ${collectionName} loaded from ${source}. Count: ${list.length}`);
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

const loadProducts = createDataLoader<Product, 'products'>('products', 'products', 'isProductsLoading', 'productsError', 'hasProductsLoaded', 'sku', 'asc');
const loadCustomers = createDataLoader<Customer, 'customers'>('customers', 'customers', 'isCustomersLoading', 'customersError', 'hasCustomersLoaded', 'name', 'asc');
const loadKarigars = createDataLoader<Karigar, 'karigars'>('karigars', 'karigars', 'isKarigarsLoading', 'karigarsError', 'hasKarigarsLoaded', 'name', 'asc');
const loadKarigarBatches = createDataLoader<KarigarBatch, 'karigarBatches'>('karigar_batches', 'karigarBatches', 'isKarigarBatchesLoading', 'karigarBatchesError', 'hasKarigarBatchesLoaded', 'startDate', 'asc');
const loadSilverTransactions = createDataLoader<SilverTransaction, 'silverTransactions'>('silver_transactions', 'silverTransactions', 'isSilverTransactionsLoading', 'silverTransactionsError', 'hasSilverTransactionsLoaded', 'date', 'desc');
const loadInvoices = createDataLoader<Invoice, 'generatedInvoices'>('invoices', 'generatedInvoices', 'isInvoicesLoading', 'invoicesError', 'hasInvoicesLoaded', 'createdAt', 'desc');
const loadOrders = createDataLoader<Order, 'orders'>('orders', 'orders', 'isOrdersLoading', 'ordersError', 'hasOrdersLoaded', 'createdAt', 'desc');
const loadHisaab = createDataLoader<HisaabEntry, 'hisaabEntries'>('hisaab', 'hisaabEntries', 'isHisaabLoading', 'hisaabError', 'hasHisaabLoaded', 'date', 'desc');
const loadExpenses = createDataLoader<Expense, 'expenses'>('expenses', 'expenses', 'isExpensesLoading', 'expensesError', 'hasExpensesLoaded', 'date', 'desc');
const loadAdditionalRevenues = createDataLoader<AdditionalRevenue, 'additionalRevenues'>('additional_revenue', 'additionalRevenues', 'isAdditionalRevenueLoading', 'additionalRevenueError', 'hasAdditionalRevenueLoaded', 'date', 'desc');
const loadGivenItems = createDataLoader<GivenItem, 'givenItems'>('given_items', 'givenItems', 'isGivenItemsLoading', 'givenItemsError', 'hasGivenItemsLoaded', 'date', 'desc');
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
      cart: [], // This will be persisted
      generatedInvoices: [],
      karigars: [],
      karigarBatches: [],
      silverTransactions: [],
      orders: [],
      hisaabEntries: [],
      expenses: [],
      additionalRevenues: [],
      givenItems: [],
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
      activityLogError: null,


      loadSettings: async () => {
        if (get().hasSettingsLoaded) return;
        set({ isSettingsLoading: true, settingsError: null });

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
          const newCategory: Category = { id: `cat-${Date.now()}`, title };
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
          phone: customerData.phone || '',
          email: customerData.email || '',
          address: customerData.address || '',
        };
        console.log("[GemsTrack Store addCustomer] Attempting to add customer:", newCustomer);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustomerId), newCustomer);
          await addActivityLog('customer.create', `Created customer: ${newCustomer.name}`, `ID: ${newCustomerId}`, newCustomerId);
          if (typeof window !== 'undefined' && !newCustomerId.startsWith('shopify-')) {
            fetch('/api/shopify/push/customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: newCustomerId }) }).catch(() => {});
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
        console.log(`[GemsTrack Store updateCustomer] Attempting to update customer ID ${id} with:`, updatedCustomerData);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id), updatedCustomerData, { merge: true });
          await addActivityLog('customer.update', `Updated customer: ${updatedCustomerData.name}`, `ID: ${id}`, id);
          if (typeof window !== 'undefined' && !id.startsWith('shopify-')) {
            fetch('/api/shopify/push/customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: id }) }).catch(() => {});
          }
          console.log(`[GemsTrack Store updateCustomer] Customer ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateCustomer] Error updating customer ID ${id} in Firestore:`, error);
        }
      },
      deleteCustomer: async (id) => {
        if(get().settings.databaseLocked) return;
        const customerName = get().customers.find(c => c.id === id)?.name || id;
        console.log(`[GemsTrack Store deleteCustomer] Attempting to delete customer ID ${id}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id));
          await addActivityLog('customer.delete', `Deleted customer: ${customerName}`, `ID: ${id}`, id);
          console.log(`[GemsTrack Store deleteCustomer] Customer ID ${id} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteCustomer] Error deleting customer ID ${id} from Firestore:`, error);
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
      deleteKarigar: async (id) => {
        if(get().settings.databaseLocked) return;
        const karigarName = get().karigars.find(k => k.id === id)?.name || id;
        console.log(`[GemsTrack Store deleteKarigar] Attempting to delete karigar ID ${id}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id));
          await addActivityLog('karigar.delete', `Deleted karigar: ${karigarName}`, `ID: ${id}`, id);
          console.log(`[GemsTrack Store deleteKarigar] Karigar ID ${id} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteKarigar] Error deleting karigar ID ${id} from Firestore:`, error);
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
                // Restore manual price override — without this the price gets
                // recalculated from metal weights giving a different (or zero) total.
                isCustomPrice: hasManualPrice,
                customPrice: hasManualPrice ? item.unitPrice : undefined,
                quantity: 1
            };
        });
      }),

      generateInvoice: async (customerInfo, invoiceRates, discountAmount, exchangeInfo?, existingInvoiceId?) => {
        if(get().settings.databaseLocked) return null;
        const { cart } = get();
        if (cart.length === 0) return null;
        console.log("[GemsTrack Store generateInvoice] Starting invoice generation...");

        try {
            const result = await runTransaction(db, async (transaction) => {
                const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
                const settingsDoc = await transaction.get(settingsDocRef);
                if (!settingsDoc.exists()) throw new Error("Global settings not found.");
                const currentSettings = settingsDoc.data() as Settings;

                // --- READS FIRST ---
                const productDocsPromises = cart.map(cartItem => transaction.get(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, cartItem.sku)));
                await Promise.all(productDocsPromises);

                let customerDoc = null;
                if (customerInfo.id) {
                    customerDoc = await transaction.get(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, customerInfo.id));
                }

                // Read existing invoice to preserve payment history and creation date
                let existingAmountPaid = 0;
                let existingPaymentHistory: Payment[] = [];
                let existingCreatedAt: string | undefined;
                let existingInvoiceData: Omit<Invoice, 'id'> | null = null;
                if (existingInvoiceId) {
                    const existingInvoiceDoc = await transaction.get(doc(db, FIRESTORE_COLLECTIONS.INVOICES, existingInvoiceId));
                    if (existingInvoiceDoc.exists()) {
                        existingInvoiceData = existingInvoiceDoc.data() as Omit<Invoice, 'id'>;
                        existingAmountPaid = existingInvoiceData.amountPaid || 0;
                        existingPaymentHistory = existingInvoiceData.paymentHistory || [];
                        existingCreatedAt = existingInvoiceData.createdAt;
                    }
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
                    paymentHistory: existingPaymentHistory,
                    customerName: finalCustomerName || 'Walk-in Customer',
                    customerId: finalCustomerId,
                    customerContact: customerInfo.phone,
                    ...(existingAdjustmentsAmount !== 0 && { adjustmentsAmount: existingAdjustmentsAmount }),
                    ...(exchangeInfo?.description && { exchangeDescription: exchangeInfo.description }),
                    ...(exchangeInfo?.amount1 && { exchangeAmount1: exchangeInfo.amount1 }),
                    ...(exchangeInfo?.amount2 && { exchangeAmount2: exchangeInfo.amount2 }),
                };

                const cleanInvoiceData = cleanObject(newInvoiceData as Invoice);

                transaction.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), cleanInvoiceData);

                addActivityLog('invoice.create', `Created invoice ${invoiceId}`, `Customer: ${finalCustomerName || 'Walk-in'} | Total: ${grandTotal.toLocaleString()}`, invoiceId);
                
                const finalInvoice = { ...cleanInvoiceData, id: invoiceId } as Invoice;
                if(finalInvoice.items && typeof finalInvoice.items === 'object' && !Array.isArray(finalInvoice.items)){
                  finalInvoice.items = Object.values(finalInvoice.items);
                }

                return finalInvoice;
            });

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

            return result;
        } catch (error) {
            console.error("[GemsTrack Store generateInvoice] Transaction failed: ", error);
            return null;
        }
      },
      updateInvoicePayment: async (invoiceId, paymentAmount, paymentDate) => {
        if(get().settings.databaseLocked) return null;
        
        const invoiceRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);

        try {
            const updatedInvoice = await runTransaction(db, async (transaction) => {
                const invoiceDoc = await transaction.get(invoiceRef);
                if (!invoiceDoc.exists()) {
                    throw new Error("Invoice not found!");
                }

                const invoiceData = invoiceDoc.data() as Invoice;
                
                const newPayment: Payment = { amount: paymentAmount, date: paymentDate, notes: 'Payment received' };
                const newPaymentHistory = [...(invoiceData.paymentHistory || []), newPayment];
                
                const newAmountPaid = newPaymentHistory.reduce((acc, p) => acc + p.amount, 0);
                const newBalanceDue = invoiceData.grandTotal - newAmountPaid;

                const updatedFields = {
                    paymentHistory: newPaymentHistory,
                    amountPaid: newAmountPaid,
                    balanceDue: newBalanceDue,
                };
                
                transaction.update(invoiceRef, updatedFields);
                
                addActivityLog('invoice.payment', `Payment received for invoice ${invoiceId}`, `Amount: ${paymentAmount.toLocaleString()} | Customer: ${invoiceData.customerName}`, invoiceId);


                return { ...invoiceData, ...updatedFields, id: invoiceId };
            });
            if (updatedInvoice) {
                // Find all hisaab entries linked to this invoice and update to reflect new balanceDue.
                // Single-field query to avoid composite index requirement; filter cashDebit in JS.
                const hisaabSnap = await getDocs(query(
                    collection(db, FIRESTORE_COLLECTIONS.HISAAB),
                    where('linkedInvoiceId', '==', invoiceId)
                ));
                const debitDocs = hisaabSnap.docs.filter(d => (d.data().cashDebit ?? 0) > 0);

                const hisaabBatch = writeBatch(db);
                if (updatedInvoice.balanceDue <= 0) {
                    // Fully paid — remove all linked debit entries
                    debitDocs.forEach(d => hisaabBatch.delete(d.ref));
                } else {
                    // Partially paid — update first entry to remaining balance, delete any duplicates
                    if (debitDocs.length > 0) {
                        hisaabBatch.update(debitDocs[0].ref, { cashDebit: updatedInvoice.balanceDue });
                        debitDocs.slice(1).forEach(d => hisaabBatch.delete(d.ref));
                    } else {
                        // No linked entry found (edge case) — create one for the outstanding amount
                        if (updatedInvoice.customerId && updatedInvoice.customerId !== 'walk-in') {
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
                }
                await hisaabBatch.commit();

                // Sync the source order's grandTotal if this invoice came from an order
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

            addActivityLog('invoice.refund', `Partial refund on invoice ${invoiceId}`, `Amount: ${refundAmount.toLocaleString()}${reason ? ` | ${reason}` : ''}`, invoiceId);
            return { ...invoiceData, id: invoiceId, paymentHistory: newPaymentHistory, amountPaid: newAmountPaid, balanceDue: newBalanceDue } as Invoice;
          });

          if (updatedInvoice) {
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

            addActivityLog('invoice.update', `Discount updated on invoice ${invoiceId}`, `Discount: ${newDiscountAmount.toLocaleString()} | New total: ${newGrandTotal.toLocaleString()}`, invoiceId);

            return { ...invoiceData, ...updatedFields, id: invoiceId };
          });

          if (updatedInvoice) {
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
        const { settings, addCustomer, customers } = get();

        // Pre-transaction: resolve customer (writes to Firestore, must happen before the transaction)
        let finalCustomerId = orderData.customerId;
        let finalCustomerName = orderData.customerName;

        if (!finalCustomerId && orderData.customerName) {
            const newCustomer = await addCustomer({
                name: orderData.customerName,
                phone: orderData.customerContact,
                email: '',
                address: '',
            });
            if (newCustomer) {
                finalCustomerId = newCustomer.id;
                finalCustomerName = newCustomer.name;
            }
        } else if (finalCustomerId) {
             const customer = customers.find(c => c.id === finalCustomerId);
             if (customer) finalCustomerName = customer.name;
        } else if (!finalCustomerName && orderData.customerContact) {
            finalCustomerName = `Customer - ${orderData.customerContact}`;
        }

        const finalSubtotal = Number(orderData.subtotal) || 0;
        const finalGrandTotal = Number(orderData.grandTotal) || 0;

        // Generate a simple summary from item descriptions
        const summaryResult = {
            summary: orderData.items.length === 1
                ? (orderData.items[0].description || 'Custom order')
                : orderData.items.map(i => i.description).filter(Boolean).join(', ') || 'Custom order',
        };

        const ratesApplied = {
            goldRatePerGram18k: settings.goldRatePerGram18k,
            goldRatePerGram21k: settings.goldRatePerGram21k,
            goldRatePerGram22k: settings.goldRatePerGram22k,
            goldRatePerGram24k: settings.goldRatePerGram24k,
            palladiumRatePerGram: settings.palladiumRatePerGram,
            platinumRatePerGram: settings.platinumRatePerGram,
            silverRatePerGram: settings.silverRatePerGram
        };

        const createdAt = new Date().toISOString();

        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);

          const finalOrder = await runTransaction(db, async (transaction) => {
            const settingsDoc = await transaction.get(settingsDocRef);
            if (!settingsDoc.exists()) throw new Error("Global settings not found.");
            const currentSettings = settingsDoc.data() as Settings;

            const nextOrderNumber = (currentSettings.lastOrderNumber || 0) + 1;
            const newOrderId = `ORD-${nextOrderNumber.toString().padStart(6, '0')}`;

            const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, newOrderId);
            const existingOrder = await transaction.get(orderDocRef);
            if (existingOrder.exists()) throw new Error(`Order ID ${newOrderId} already exists. lastOrderNumber may be out of sync.`);

            const order: Order = {
              ...orderData,
              id: newOrderId,
              customerId: finalCustomerId,
              customerName: finalCustomerName,
              subtotal: finalSubtotal,
              grandTotal: finalGrandTotal,
              createdAt,
              status: 'Pending',
              summary: summaryResult.summary,
              ratesApplied: ratesApplied,
            };

            transaction.set(orderDocRef, order);
            transaction.update(settingsDocRef, { lastOrderNumber: nextOrderNumber });
            return order;
          });

          await addActivityLog('order.create', `Created order: ${finalOrder.id}`, `Customer: ${finalCustomerName || 'Walk-in'} | Total: ${finalGrandTotal.toLocaleString()}`, finalOrder.id);
          console.log(`[GemsTrack Store addOrder] Order ${finalOrder.id} saved successfully.`);
          syncOrderShopify(finalOrder.id, 'upsert');

          // WhatsApp notification: new order
          const s = get().settings;
          if (s.notifEnabled && s.notifNewOrder && s.notifPhones?.length) {
            const items = finalOrder.items.map(i => i.description || 'Item').join(', ');
            const msg = `*New Order* ${finalOrder.id}\nCustomer: ${finalCustomerName || 'Walk-in'}\nItems: ${items}\nTotal: PKR ${finalGrandTotal.toLocaleString()}`;
            s.notifPhones.forEach(phone => {
              fetch('/api/notifications/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: phone, message: msg }),
              }).catch(e => console.warn('[notif] new order send failed:', e));
            });
          }

          return finalOrder;
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
        console.log(`[GemsTrack Store updateOrderStatus] Updating order ${orderId} to status: ${status}`);
        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
          await setDoc(orderDocRef, { status }, { merge: true });
          await addActivityLog('order.update', `Order ${orderId} status changed`, `New status: ${status}`, orderId);
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
            if (msg) {
              s.notifPhones.forEach(phone => {
                fetch('/api/notifications/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ to: phone, message: msg }),
                }).catch(e => console.warn('[notif] status update send failed:', e));
              });
            }
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
                ...(finalizedData.isManualPrice && { isManualPrice: true }),
                ...(originalItem.itemCategory && { itemCategory: originalItem.itemCategory }),
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
            sourceOrderId: order.id,
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
                await addActivityLog('order.update', `Advance recorded for Order ${orderId}`, `Amount: ${amount.toLocaleString()}`, orderId);

                return { ...orderData, advancePayment: newAdvancePayment, grandTotal: newGrandTotal } as Order;
            });
            syncOrderShopify(orderId, 'upsert');
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
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.EXPENSES), expenseData);
          await addActivityLog('expense.create', `Added expense: ${expenseData.description}`, `Category: ${expenseData.category} | Amount: ${expenseData.amount.toLocaleString()}`, docRef.id);
          console.log("[GemsTrack Store addExpense] Expense added with ID:", docRef.id);
          return { id: docRef.id, ...expenseData };
        } catch (error) {
          console.error("[GemsTrack Store addExpense] Error adding expense:", error);
          return null;
        }
      },
      updateExpense: async (id, updatedExpenseData) => {
        if(get().settings.databaseLocked) return;
        console.log(`[GemsTrack Store updateExpense] Attempting to update expense ID ${id}`);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.EXPENSES, id), updatedExpenseData, { merge: true });
          await addActivityLog('expense.update', `Updated expense: ${updatedExpenseData.description}`, `ID: ${id}`, id);
          console.log(`[GemsTrack Store updateExpense] Expense ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateExpense] Error updating expense ID ${id}:`, error);
        }
      },
      deleteExpense: async (id: string) => {
        if(get().settings.databaseLocked) return;
        const expenseDesc = get().expenses.find(e => e.id === id)?.description || id;
        console.log(`[GemsTrack Store deleteExpense] Attempting to delete expense ID ${id}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.EXPENSES, id));
          await addActivityLog('expense.delete', `Deleted expense: ${expenseDesc}`, `ID: ${id}`, id);
          console.log(`[GemsTrack Store deleteExpense] Expense ID ${id} deleted successfully.`);
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

      addGivenItem: async (data) => {
        if (get().settings.databaseLocked) return null;
        try {
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS), data);
          await addActivityLog('given.create', `Given item: ${data.description}`, `To: ${data.recipientName}`, docRef.id);
          return { id: docRef.id, ...data };
        } catch (error) {
          console.error('[GemsTrack Store addGivenItem] Error:', error);
          return null;
        }
      },
      updateGivenItem: async (id, data) => {
        if (get().settings.databaseLocked) return;
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.GIVEN_ITEMS, id), data, { merge: true });
          await addActivityLog('given.update', `Updated given item`, `ID: ${id}`, id);
        } catch (error) {
          console.error(`[GemsTrack Store updateGivenItem] Error:`, error);
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
