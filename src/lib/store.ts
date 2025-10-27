
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc, query, orderBy, onSnapshot, addDoc, runTransaction, getDocsFromCache } from 'firebase/firestore';
import { db, firebaseConfig } from '@/lib/firebase';
import { summarizeOrderItems, SummarizeOrderItemsInput } from '@/ai/flows/summarize-order-items-flow';


// --- Firestore Collection Names ---
const FIRESTORE_COLLECTIONS = {
  SETTINGS: "app_settings",
  PRODUCTS: "products", // Represents ACTIVE inventory
  SOLD_PRODUCTS: "sold_products", // Archive of sold items
  CUSTOMERS: "customers",
  KARIGARS: "karigars",
  INVOICES: "invoices",
  ORDERS: "orders",
  CATEGORIES: "categories", // Note: Categories are still managed locally for now
  HISAAB: "hisaab",
  EXPENSES: "expenses",
  ACTIVITY_LOG: "activity_log",
};
const GLOBAL_SETTINGS_DOC_ID = "global";


// --- Helper Functions and Constants ---
const DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = '21k';
const GOLD_COIN_CATEGORY_ID_INTERNAL = 'cat017';
const MENS_RING_CATEGORY_ID_INTERNAL = 'cat018';


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

  // The primary metal weight is its gross weight, minus only the stones.
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
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  createdAt: string; // ISO string
  ratesApplied: Partial<Settings>;
  paymentHistory: Payment[];
}

export interface Karigar {
  id: string; // Firestore document ID
  name: string;
  contact?: string;
  notes?: string;
}

export const ORDER_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export interface OrderItem {
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
}

export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Utilities', 'Marketing', 'Supplies', 
  'Repairs & Maintenance', 'Taxes', 'Travel', 'Other'
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export interface Expense {
  id: string;
  date: string; // ISO String
  category: ExpenseCategory | string; // Allow 'Other' as custom string
  description: string;
  amount: number;
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
  shopName: "Taheri", shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "", shopLogoUrlBlack: "", lastInvoiceNumber: 0,
  lastOrderNumber: 0,
  allowedDeviceIds: [],
  weprintApiSkus: [],
  paymentMethods: [],
  theme: 'slate',
  databaseLocked: false,
  firebaseConfig: {
    projectId: "gemstrack-pos",
  }
};

const staticCategories: Category[] = [
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
  | 'invoice.create' | 'invoice.payment' | 'invoice.delete'
  | 'order.create' | 'order.update' | 'order.delete'
  | 'expense.create' | 'expense.update' | 'expense.delete';

export interface ActivityLog {
    id: string;
    timestamp: string; // ISO string
    eventType: LogEventType;
    description: string; // e.g., "Created new product: RIN-000001"
    details: string; // e.g., "Product: Gold Ring | By: Murtaza"
    entityId: string; // ID of the product, customer, etc.
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
  orders: Order[];
  hisaabEntries: HisaabEntry[];
  expenses: Expense[];
  soldProducts: Product[];
  activityLog: ActivityLog[];

  // Loading states
  isSettingsLoading: boolean;
  isProductsLoading: boolean;
  isSoldProductsLoading: boolean;
  isCustomersLoading: boolean;
  isKarigarsLoading: boolean;
  isInvoicesLoading: boolean;
  isOrdersLoading: boolean;
  isHisaabLoading: boolean;
  isExpensesLoading: boolean;
  isActivityLogLoading: boolean;
  
  // Data loaded flags
  hasSettingsLoaded: boolean;
  hasProductsLoaded: boolean;
  hasSoldProductsLoaded: boolean;
  hasCustomersLoaded: boolean;
  hasKarigarsLoaded: boolean;
  hasInvoicesLoaded: boolean;
  hasOrdersLoaded: boolean;
  hasHisaabLoaded: boolean;
  hasExpensesLoaded: boolean;
  hasActivityLogLoaded: boolean;

  // Error states
  settingsError: string | null;
  productsError: string | null;
  soldProductsError: string | null;
  customersError: string | null;
  invoicesError: string | null;
  ordersError: string | null;
  karigarsError: string | null;
  hisaabError: string | null;
  expensesError: string | null;
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

  loadKarigars: () => void;
  addKarigar: (karigarData: Omit<Karigar, 'id'>) => Promise<Karigar | null>;
  updateKarigar: (id: string, updatedKarigarData: Partial<Omit<Karigar, 'id'>>) => Promise<void>;
  deleteKarigar: (id: string) => Promise<void>;

  addToCart: (sku: string) => void;
  removeFromCart: (sku: string) => void;
  updateCartItem: (sku: string, updatedProductData: Partial<Product>) => void;
  clearCart: () => void;
  loadCartFromInvoice: (invoice: Invoice) => void;


  loadGeneratedInvoices: () => void;
  generateInvoice: (
    customerInfo: { id?: string; name: string; phone?: string },
    invoiceRates: Partial<Settings>,
    discountAmount: number
  ) => Promise<Invoice | null>;
  updateInvoicePayment: (invoiceId: string, paymentAmount: number, paymentDate: string) => Promise<Invoice | null>;
  deleteInvoice: (invoiceId: string, isEditing?: boolean) => Promise<void>;
  
  loadOrders: () => void;
  addOrder: (orderData: OrderDataForAdd) => Promise<Order | null>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  updateOrderItemStatus: (orderId: string, itemIndex: number, isCompleted: boolean) => Promise<void>;
  updateOrder: (orderId: string, updatedOrderData: Partial<Order>) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  generateInvoiceFromOrder: (
    order: Order,
    finalizedItems: FinalizedOrderItemData[],
    additionalDiscount: number
  ) => Promise<Invoice | null>;

  loadHisaab: () => void;
  addHisaabEntry: (entryData: Omit<HisaabEntry, 'id'>) => Promise<HisaabEntry | null>;
  deleteHisaabEntry: (entryId: string) => Promise<void>;
  
  loadExpenses: () => void;
  addExpense: (expenseData: Omit<Expense, 'id'>) => Promise<Expense | null>;
  updateExpense: (id: string, updatedExpenseData: Partial<Omit<Expense, 'id'>>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  
  loadActivityLog: () => void;
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
      orders: [],
      hisaabEntries: [],
      expenses: [],
      activityLog: [],

      isSettingsLoading: true,
      isProductsLoading: true,
      isSoldProductsLoading: true,
      isCustomersLoading: true,
      isKarigarsLoading: true,
      isInvoicesLoading: true,
      isOrdersLoading: true,
      isHisaabLoading: true,
      isExpensesLoading: true,
      isActivityLogLoading: true,
      
      hasSettingsLoaded: false,
      hasProductsLoaded: false,
      hasSoldProductsLoaded: false,
      hasCustomersLoaded: false,
      hasKarigarsLoaded: false,
      hasInvoicesLoaded: false,
      hasOrdersLoaded: false,
      hasHisaabLoaded: false,
      hasExpensesLoaded: false,
      hasActivityLogLoaded: false,

      settingsError: null,
      productsError: null,
      soldProductsError: null,
      customersError: null,
      invoicesError: null,
      ordersError: null,
      karigarsError: null,
      hisaabError: null,
      expensesError: null,
      activityLogError: null,


      loadSettings: async () => {
        if (get().hasSettingsLoaded) return;
        set({ isSettingsLoading: true, settingsError: null });
        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          const docSnap = await getDoc(settingsDocRef);
          
          let loadedSettings: Settings;

          if (docSnap.exists()) {
            const firestoreSettings = docSnap.data() as Partial<Settings>;
            loadedSettings = {
              ...initialSettingsData,
              ...firestoreSettings,
              firebaseConfig: firebaseConfig, // Always use the imported config
              allowedDeviceIds: Array.isArray(firestoreSettings.allowedDeviceIds)
                ? firestoreSettings.allowedDeviceIds
                : [],
              weprintApiSkus: Array.isArray(firestoreSettings.weprintApiSkus)
                ? firestoreSettings.weprintApiSkus
                : [],
               paymentMethods: Array.isArray(firestoreSettings.paymentMethods)
                ? firestoreSettings.paymentMethods
                : [],
              theme: firestoreSettings.theme || 'slate',
            };
          } else {
            console.log("[GemsTrack Store loadSettings] No settings found, creating with initial data.");
            const settingsWithConfig = {...initialSettingsData, firebaseConfig: firebaseConfig};
            await setDoc(settingsDocRef, settingsWithConfig);
            loadedSettings = settingsWithConfig;
          }

          if (loadedSettings.databaseLocked) {
              set({ settingsError: "Database access is locked by an administrator." });
          }

          set((state) => { state.settings = loadedSettings; });
          console.log("[GemsTrack Store loadSettings] Settings loaded.");

        } catch (error: any) {
          console.error("[GemsTrack Store loadSettings] Error loading settings from Firestore:", error);
          set({ settingsError: error.message || 'Failed to connect to the database.' });
          set((state) => { state.settings = initialSettingsData; }); // Fallback
        } finally {
          set({ isSettingsLoading: false, hasSettingsLoaded: true });
        }
      },
      updateSettings: async (newSettings: Partial<Settings>) => {
        const {databaseLocked} = get().settings;
        if(databaseLocked) {
            console.warn("[updateSettings] Blocked: Database is locked.");
            return;
        }

        const currentSettings = get().settings;
        const updatedSettings = { ...currentSettings, ...newSettings };
        console.log("[GemsTrack Store updateSettings] Attempting to update settings:", updatedSettings);
        set((state) => { state.settings = updatedSettings; });
        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          await setDoc(settingsDocRef, updatedSettings, { merge: true });
          console.log("[GemsTrack Store updateSettings] Settings updated successfully in Firestore.");
        } catch (error) {
          console.error("[GemsTrack Store updateSettings] Error updating settings in Firestore:", error);
          set((state) => { state.settings = currentSettings; }); // Revert on error
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

      loadProducts: () => {
        if (get().hasProductsLoaded || get().settings.databaseLocked) return;
        set({ isProductsLoading: true, productsError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.PRODUCTS), orderBy("sku"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const productList = snapshot.docs.map(doc => doc.data() as Product);
            set(state => {
                state.products = productList;
                state.isProductsLoading = false;
                state.hasProductsLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${productList.length} products loaded.`);
          }, 
          (error) => {
            console.error("[GemsTrack Store] Error in products real-time listener:", error);
            set({ products: [], isProductsLoading: false, productsError: error.message || 'Failed to load products.' });
          }
        );
      },
      loadSoldProducts: () => {
        if (get().hasSoldProductsLoaded || get().settings.databaseLocked) return;
        set({ isSoldProductsLoading: true, soldProductsError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS));
        onSnapshot(q, 
          (snapshot) => {
            const productList = snapshot.docs.map(doc => doc.data() as Product);
            set({ soldProducts: productList, isSoldProductsLoading: false, hasSoldProductsLoaded: true });
            console.log(`[GemsTrack Store] Real-time update: ${productList.length} sold products loaded.`);
          }, 
          (error) => {
            console.error("[GemsTrack Store] Error in sold products real-time listener:", error);
            set({ soldProducts: [], isSoldProductsLoading: false, soldProductsError: error.message || 'Failed to load sold products.' });
          }
        );
      },
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

      loadCustomers: () => {
        if (get().hasCustomersLoaded || get().settings.databaseLocked) return;
        set({ isCustomersLoading: true, customersError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.CUSTOMERS), orderBy("name"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const customerList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Customer));
            set(state => {
              state.customers = customerList;
              state.isCustomersLoading = false;
              state.hasCustomersLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${customerList.length} customers loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in customers real-time listener:", error);
            set({ customers: [], isCustomersLoading: false, customersError: error.message || 'Failed to load customers.' });
          }
        );
      },
      addCustomer: async (customerData) => {
        if(get().settings.databaseLocked) return null;
        const newCustomerId = `cust-${Date.now()}`;
        const newCustomer: Customer = { 
          name: customerData.name || 'Unnamed Customer',
          phone: customerData.phone,
          email: customerData.email,
          address: customerData.address,
          id: newCustomerId 
        };
        console.log("[GemsTrack Store addCustomer] Attempting to add customer:", newCustomer);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustomerId), newCustomer);
          await addActivityLog('customer.create', `Created customer: ${newCustomer.name}`, `ID: ${newCustomerId}`, newCustomerId);
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

      loadKarigars: () => {
        if (get().hasKarigarsLoaded || get().settings.databaseLocked) return;
        set({ isKarigarsLoading: true, karigarsError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.KARIGARS), orderBy("name"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const karigarList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Karigar));
            set(state => {
              state.karigars = karigarList;
              state.isKarigarsLoading = false;
              state.hasKarigarsLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${karigarList.length} karigars loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in karigars real-time listener:", error);
            set({ karigars: [], isKarigarsLoading: false, karigarsError: error.message || 'Failed to load karigars.' });
          }
        );
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

      addToCart: (sku) => set((state) => {
          const existingItem = state.cart.find((item) => item.sku === sku);
          if (!existingItem) {
            const productToAdd = state.products.find(p => p.sku === sku);
            if(productToAdd) {
                state.cart.push({ ...productToAdd, quantity: 1 });
            }
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
                quantity: 1
            };
        });
      }),

      loadGeneratedInvoices: () => {
        if (get().hasInvoicesLoaded || get().settings.databaseLocked) return;
        set({ isInvoicesLoading: true, invoicesError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.INVOICES), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const invoiceList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice));
            set(state => {
              state.generatedInvoices = invoiceList;
              state.isInvoicesLoading = false;
              state.hasInvoicesLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${invoiceList.length} invoices loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in invoices real-time listener:", error);
            set({ generatedInvoices: [], isInvoicesLoading: false, invoicesError: error.message || 'Failed to load invoices.' });
          }
        );
      },
      generateInvoice: async (customerInfo, invoiceRates, discountAmount) => {
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
                
                // --- WRITES SECOND ---
                let finalCustomerId = customerInfo.id;
                let finalCustomerName = customerInfo.name;

                if (!finalCustomerId && customerInfo.name) {
                    const newCustId = `cust-${Date.now()}`;
                    const newCustomerData: Omit<Customer, 'id'> = { name: customerInfo.name, phone: customerInfo.phone || "" };
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

                    invoiceItems.push(cleanObject(itemToAdd as InvoiceItem));

                    transaction.set(doc(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS, cartItem.sku), cleanObject(cartItem));
                    transaction.delete(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, cartItem.sku));
                }

                const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
                const grandTotal = subtotal - calculatedDiscountAmount;
                const nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
                const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;

                const newInvoiceData: Omit<Invoice, 'id'> = {
                    items: invoiceItems, subtotal, discountAmount: calculatedDiscountAmount, grandTotal,
                    amountPaid: 0, balanceDue: grandTotal, createdAt: new Date().toISOString(),
                    ratesApplied: ratesForInvoice, 
                    paymentHistory: [],
                    customerName: finalCustomerName || 'Walk-in Customer',
                    customerId: finalCustomerId,
                    customerContact: customerInfo.phone
                };
                
                const cleanInvoiceData = cleanObject(newInvoiceData as Invoice);
                
                transaction.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), cleanInvoiceData);
                transaction.update(settingsDocRef, { lastInvoiceNumber: nextInvoiceNumber });

                const hisaabEntry: Omit<HisaabEntry, 'id'> = {
                    entityId: finalCustomerId || 'walk-in',
                    entityType: 'customer',
                    entityName: finalCustomerName || 'Walk-in Customer',
                    date: newInvoiceData.createdAt!,
                    description: `Invoice ${invoiceId}`,
                    cashDebit: grandTotal, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0,
                };
                transaction.set(doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB)), hisaabEntry);
                
                addActivityLog('invoice.create', `Created invoice ${invoiceId}`, `Customer: ${finalCustomerName || 'Walk-in'} | Total: ${grandTotal.toLocaleString()}`, invoiceId);
                
                const finalInvoice = { ...cleanInvoiceData, id: invoiceId } as Invoice;
                if(finalInvoice.items && typeof finalInvoice.items === 'object' && !Array.isArray(finalInvoice.items)){
                  finalInvoice.items = Object.values(finalInvoice.items);
                }

                return finalInvoice;
            });

            // This line should be outside the transaction, in the main function body.
            set(state => { state.cart = []; });

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
                
                // Add to Hisaab as well
                const hisaabEntry: Omit<HisaabEntry, 'id'> = {
                    entityId: invoiceData.customerId || 'walk-in',
                    entityType: 'customer',
                    entityName: invoiceData.customerName,
                    date: paymentDate,
                    description: `Payment for Invoice ${invoiceId}`,
                    cashDebit: 0,
                    cashCredit: paymentAmount,
                    goldDebitGrams: 0,
                    goldCreditGrams: 0,
                };
                transaction.set(doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB)), hisaabEntry);
                addActivityLog('invoice.payment', `Payment received for invoice ${invoiceId}`, `Amount: ${paymentAmount.toLocaleString()} | Customer: ${invoiceData.customerName}`, invoiceId);


                return { ...invoiceData, ...updatedFields, id: invoiceId };
            });
            return updatedInvoice;
        } catch (error) {
            console.error(`Error updating invoice payment for ${invoiceId}:`, error);
            return null;
        }
      },

      deleteInvoice: async (invoiceId, isEditing = false) => {
          if(get().settings.databaseLocked) return;
          console.log(`[deleteInvoice] Attempting to delete invoice ${invoiceId}. Is editing flow: ${isEditing}`);
          try {
              const invoiceDocRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
              const invoiceDoc = await getDoc(invoiceDocRef);
              if (!invoiceDoc.exists()) {
                  console.warn(`Invoice ${invoiceId} not found for deletion.`);
                  return;
              }
              const invoiceData = invoiceDoc.data() as Invoice;

              const batch = writeBatch(db);
              
              // Only move products back if it's NOT an edit-and-replace operation
              if (!isEditing) {
                  for(const item of invoiceData.items) {
                      const soldProductRef = doc(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS, item.sku);
                      // In a real-world scenario with more complex data, you would fetch before setting
                      // But since we are recreating from invoice data, this is acceptable.
                      const productData = {
                          // Reconstruct product data from invoice item
                          sku: item.sku, name: item.name, categoryId: item.categoryId,
                          metalType: item.metalType, karat: item.karat, metalWeightG: item.metalWeightG,
                          stoneWeightG: item.stoneWeightG, wastagePercentage: item.wastagePercentage,
                          makingCharges: item.makingCharges, hasDiamonds: item.diamondChargesIfAny > 0,
                          diamondCharges: item.diamondChargesIfAny, stoneCharges: item.stoneChargesIfAny,
                          miscCharges: item.miscChargesIfAny, stoneDetails: item.stoneDetails, diamondDetails: item.diamondDetails
                      };
                      batch.set(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, item.sku), productData);
                      batch.delete(soldProductRef);
                  }
              }

              const hisaabQuery = query(collection(db, FIRESTORE_COLLECTIONS.HISAAB));
              const hisaabSnapshot = await getDocs(hisaabQuery);
              const hisaabEntriesToDelete = hisaabSnapshot.docs.filter(doc => doc.data().description.includes(invoiceId));
              hisaabEntriesToDelete.forEach(doc => batch.delete(doc.ref));

              batch.delete(invoiceDocRef);
              await batch.commit();

              await addActivityLog('invoice.delete', `Deleted invoice ${invoiceId}`, `Customer: ${invoiceData.customerName}`, invoiceId);
              console.log(`Successfully deleted invoice ${invoiceId} and related data.`);

          } catch (e) {
              console.error(`Failed to delete invoice ${invoiceId}:`, e);
              throw e;
          }
      },

      loadOrders: () => {
        if (get().hasOrdersLoaded || get().settings.databaseLocked) return;
        set({ isOrdersLoading: true, ordersError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.ORDERS), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const orderList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Order));
            set(state => {
              state.orders = orderList;
              state.isOrdersLoading = false;
              state.hasOrdersLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${orderList.length} orders loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in orders real-time listener:", error);
            set({ orders: [], isOrdersLoading: false, ordersError: error.message || 'Failed to load orders.' });
          }
        );
      },

      addOrder: async (orderData) => {
        if(get().settings.databaseLocked) return null;
        const { settings, addCustomer, customers } = get();
        const nextOrderNumber = (settings.lastOrderNumber || 0) + 1;
        const newOrderId = `ORD-${nextOrderNumber.toString().padStart(6, '0')}`;

        let finalCustomerId = orderData.customerId;
        let finalCustomerName = orderData.customerName;

        if (!finalCustomerId && orderData.customerName) {
            const newCustomer = await addCustomer({ 
                name: orderData.customerName, 
                phone: orderData.customerContact 
            });
            if (newCustomer) {
                finalCustomerId = newCustomer.id;
            }
        } else if (finalCustomerId) {
             const customer = customers.find(c => c.id === finalCustomerId);
             if (customer) {
                finalCustomerName = customer.name;
             }
        }
        
        const finalSubtotal = Number(orderData.subtotal) || 0;
        const finalGrandTotal = Number(orderData.grandTotal) || 0;
        
        const summaryInput: SummarizeOrderItemsInput = {
            items: orderData.items.map(item => ({
                description: item.description,
                karat: item.karat,
                estimatedWeightG: item.estimatedWeightG,
            })),
        };
        const summaryResult = await summarizeOrderItems(summaryInput);
        
        const ratesApplied = {
            goldRatePerGram18k: settings.goldRatePerGram18k,
            goldRatePerGram21k: settings.goldRatePerGram21k,
            goldRatePerGram22k: settings.goldRatePerGram22k,
            goldRatePerGram24k: settings.goldRatePerGram24k,
            palladiumRatePerGram: settings.palladiumRatePerGram,
            platinumRatePerGram: settings.platinumRatePerGram,
            silverRatePerGram: settings.silverRatePerGram
        };

        const newOrder: Omit<Order, 'id'> = {
          ...orderData,
          customerId: finalCustomerId,
          customerName: finalCustomerName,
          subtotal: finalSubtotal,
          grandTotal: finalGrandTotal,
          createdAt: new Date().toISOString(),
          status: 'Pending',
          summary: summaryResult.summary,
          ratesApplied: ratesApplied,
        };
        
        const finalOrder: Order = { ...newOrder, id: newOrderId };
        console.log("[GemsTrack Store addOrder] Attempting to save order:", finalOrder);

        try {
          const batch = writeBatch(db);
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, newOrderId);
          batch.set(orderDocRef, finalOrder);

          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          batch.update(settingsDocRef, { lastOrderNumber: nextOrderNumber });
          
          await addActivityLog('order.create', `Created order: ${newOrderId}`, `Customer: ${finalCustomerName || 'Walk-in'} | Total: ${finalGrandTotal.toLocaleString()}`, newOrderId);

          await batch.commit();
          console.log(`[GemsTrack Store addOrder] Order ${newOrderId} and settings successfully committed.`);
          
          return finalOrder;
        } catch (error) {
          console.error(`[GemsTrack Store addOrder] Error saving order ${newOrderId} to Firestore:`, error);
          return null;
        }
      },
      updateOrder: async (orderId, updatedOrderData) => {
        if(get().settings.databaseLocked) return;
        const orderRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
        await setDoc(orderRef, updatedOrderData, { merge: true });
        await addActivityLog('order.update', `Updated order: ${orderId}`, `Details updated`, orderId);
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
          console.log(`[GemsTrack Store updateOrderStatus] Successfully updated status for order ${orderId}.`);
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
        const updatedItems = [...order.items];
        if (updatedItems[itemIndex]) {
          updatedItems[itemIndex].isCompleted = isCompleted;
        } else {
            throw new Error("Item index out of bounds");
        }
    
        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
          await setDoc(orderDocRef, { items: updatedItems }, { merge: true });
          console.log(`Successfully updated item #${itemIndex} status for order ${orderId}.`);
        } catch (error) {
          console.error(`Error updating item status for order ${orderId}:`, error);
          throw error;
        }
      },
      generateInvoiceFromOrder: async (order, finalizedItems, additionalDiscount) => {
        if(get().settings.databaseLocked) return null;
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
            const finalizedData = finalizedItems.find(fi => fi.description === originalItem.description);
            if (!finalizedData) {
                console.error(`Could not find finalized data for item: ${originalItem.description}`);
                throw new Error(`Finalized data for item "${originalItem.description}" not found.`);
            }

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
            finalSubtotal += costs.totalPrice;
    
            const itemToAdd: InvoiceItem = {
                sku: `ORD-${order.id}-${index + 1}`,
                name: originalItem.description,
                categoryId: '',
                metalType: originalItem.metalType,
                karat: originalItem.karat,
                metalWeightG: finalizedData.finalWeightG,
                stoneWeightG: originalItem.stoneWeightG,
                quantity: 1,
                unitPrice: costs.totalPrice,
                itemTotal: costs.totalPrice,
                metalCost: costs.metalCost,
                wastageCost: costs.wastageCost,
                wastagePercentage: originalItem.wastagePercentage,
                makingCharges: costs.makingCharges,
                diamondChargesIfAny: costs.diamondCharges,
                stoneChargesIfAny: costs.stoneCharges,
                miscChargesIfAny: 0,
                stoneDetails: originalItem.stoneDetails,
                diamondDetails: originalItem.diamondDetails,
            };
             // Clean the item of any undefined values before pushing
            Object.keys(itemToAdd).forEach(key => {
                if (itemToAdd[key as keyof InvoiceItem] === undefined) {
                    delete itemToAdd[key as keyof InvoiceItem];
                }
            });
            finalInvoiceItems.push(itemToAdd);
        });
    
        const totalDiscount = additionalDiscount;
        const grandTotal = finalSubtotal - totalDiscount;

        const advancePayment: Payment = {
            amount: order.advancePayment + (order.advanceInExchangeValue || 0),
            date: order.createdAt, // Assume advance was paid on order creation date
            notes: `Advance from Order. Cash: ${order.advancePayment}. Exchange: ${order.advanceInExchangeValue || 0} (${order.advanceInExchangeDescription || ''})`,
        };

        const paymentHistory: Payment[] = advancePayment.amount > 0 ? [advancePayment] : [];
        const amountPaid = advancePayment.amount;
        const balanceDue = finalSubtotal - amountPaid - totalDiscount;
    
        const nextInvoiceNumber = (settings.lastInvoiceNumber || 0) + 1;
        const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
    
        const newInvoiceData: Omit<Invoice, 'id'> = {
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
        };
    
        const newInvoice: Invoice = { id: invoiceId, ...newInvoiceData };
    
        try {
            const batch = writeBatch(db);
            const finalInvoicePayload = cleanObject({ ...newInvoiceData });

            batch.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), finalInvoicePayload);
            batch.update(doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID), { lastInvoiceNumber: nextInvoiceNumber });
            batch.update(doc(db, FIRESTORE_COLLECTIONS.ORDERS, order.id), { status: 'Completed' });
            
            const hisaabEntry: Omit<HisaabEntry, 'id'> = {
              entityId: order.customerId || 'walk-in',
              entityType: 'customer',
              entityName: order.customerName || 'Walk-in Customer',
              date: newInvoice.createdAt,
              description: `Final Invoice ${newInvoice.id} from Order ${order.id}`,
              cashDebit: newInvoice.grandTotal,
              cashCredit: newInvoice.amountPaid, // Credit the advance payment immediately in hisaab
              goldDebitGrams: 0, goldCreditGrams: 0,
            };
            batch.set(doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB)), hisaabEntry);
            
            await addActivityLog('invoice.create', `Created invoice ${invoiceId} from order ${order.id}`, `Customer: ${newInvoice.customerName} | Total: ${newInvoice.grandTotal.toLocaleString()}`, newInvoice.id);

            await batch.commit();
            
            set(state => { state.clearCart(); });
            
            return newInvoice;
        } catch (error) {
            console.error("Error finalizing order into invoice:", error);
            return null;
        }
      },

      loadHisaab: () => {
        if (get().hasHisaabLoaded || get().settings.databaseLocked) return;
        set({ isHisaabLoading: true, hisaabError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.HISAAB), orderBy("date", "desc"));
        const unsubscribe = onSnapshot(q,
          (snapshot) => {
            const entryList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as HisaabEntry));
            set(state => {
              state.hisaabEntries = entryList;
              state.isHisaabLoading = false;
              state.hasHisaabLoaded = true;
            });
             console.log(`[GemsTrack Store] Real-time update: ${entryList.length} hisaab entries loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in hisaab real-time listener:", error);
            set({ hisaabEntries: [], isHisaabLoading: false, hisaabError: error.message || 'Failed to load hisaab.' });
          }
        );
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
      
      loadExpenses: () => {
        if (get().hasExpensesLoaded || get().settings.databaseLocked) return;
        set({ isExpensesLoading: true, expensesError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.EXPENSES), orderBy("date", "desc"));
        const unsubscribe = onSnapshot(q,
          (snapshot) => {
            const expenseList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Expense));
            set(state => {
                state.expenses = expenseList;
                state.isExpensesLoading = false;
                state.hasExpensesLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${expenseList.length} expenses loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in expenses real-time listener:", error);
            set({ expenses: [], isExpensesLoading: false, expensesError: error.message || 'Failed to load expenses.' });
          }
        );
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
      
      loadActivityLog: () => {
        if (get().hasActivityLogLoaded || get().settings.databaseLocked) return;
        set({ isActivityLogLoading: true, activityLogError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.ACTIVITY_LOG), orderBy("timestamp", "desc"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const logList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ActivityLog));
            set(state => {
                state.activityLog = logList;
                state.isActivityLogLoading = false;
                state.hasActivityLogLoaded = true;
            });
            console.log(`[GemsTrack Store] Real-time update: ${logList.length} activity logs loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in activity log real-time listener:", error);
            set({ activityLog: [], isActivityLogLoading: false, activityLogError: error.message || 'Failed to load activity log.' });
          }
        );
      },
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
        settings: { 
            ...state.settings,
            theme: state.settings?.theme || 'default',
        }
      }),
      version: 15, // Incremented version
      migrate: (persistedState, version) => {
        const oldState = persistedState as any;
        if (version < 15) {
            if (oldState.settings && !oldState.settings.paymentMethods) {
                oldState.settings.paymentMethods = [];
            }
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
