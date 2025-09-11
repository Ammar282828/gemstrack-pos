

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc, query, orderBy, onSnapshot, addDoc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
  EXPENSES: "expenses", // New collection for expenses
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
  theme: ThemeKey;
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

export interface Invoice {
  id: string; // Firestore document ID
  customerId?: string;
  customerName?: string;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  createdAt: string; // ISO string
  ratesApplied: Partial<Settings>;
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
  shopLogoUrl: "https://placehold.co/200x80.png", lastInvoiceNumber: 0,
  lastOrderNumber: 0,
  allowedDeviceIds: [],
  theme: 'slate',
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
  cart: CartItem[]; // The cart now holds full product objects, not just SKUs.
  generatedInvoices: Invoice[];
  karigars: Karigar[];
  orders: Order[];
  hisaabEntries: HisaabEntry[];
  expenses: Expense[];

  // Loading states
  isSettingsLoading: boolean;
  isProductsLoading: boolean;
  isCustomersLoading: boolean;
  isKarigarsLoading: boolean;
  isInvoicesLoading: boolean;
  isOrdersLoading: boolean;
  isHisaabLoading: boolean;
  isExpensesLoading: boolean;
  
  // Data loaded flags
  hasSettingsLoaded: boolean;
  hasProductsLoaded: boolean;
  hasCustomersLoaded: boolean;
  hasKarigarsLoaded: boolean;
  hasInvoicesLoaded: boolean;
  hasOrdersLoaded: boolean;
  hasHisaabLoaded: boolean;
  hasExpensesLoaded: boolean;

  // Error states
  settingsError: string | null;
  productsError: string | null;
  customersError: string | null;
  invoicesError: string | null;
  ordersError: string | null;
  karigarsError: string | null;
  hisaabError: string | null;
  expensesError: string | null;


  // Zustand specific hydration state
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  // Actions
  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;

  addCategory: (title: string) => void; // Local category management
  updateCategory: (id: string, title: string) => void;
  deleteCategory: (id: string) => void;

  loadProducts: () => void;
  addProduct: (productData: ProductDataForAdd) => Promise<Product | null>;
  updateProduct: (sku: string, updatedProductData: Partial<Omit<Product, 'sku'>>) => Promise<void>;
  deleteProduct: (sku: string) => Promise<void>;
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
  updateInvoicePayment: (invoiceId: string, paymentAmount: number) => Promise<Invoice | null>;
  deleteInvoice: (invoiceId: string, isEditing?: boolean) => Promise<void>;
  
  loadOrders: () => void;
  addOrder: (orderData: OrderDataForAdd) => Promise<Order | null>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  updateOrderItemStatus: (orderId: string, itemIndex: number, isCompleted: boolean) => Promise<void>;
  updateOrder: (orderId: string, updatedOrderData: Partial<Order>) => Promise<void>;
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

  // Data clearing actions
  clearAllProducts: () => Promise<void>;
  clearAllCustomers: () => Promise<void>;
  clearAllKarigars: () => Promise<void>;
  clearAllInvoices: () => Promise<void>;
  clearAllOrders: () => Promise<void>;
  clearAllExpenses: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

export type EnrichedCartItem = Product & {
  quantity: number; // Always 1
  totalPrice: number; // Price for one unit at current store rates
  lineItemTotal: number; // totalPrice * quantity
};

const ssrDummyStorage: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, };

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
      customers: [],
      cart: [], // This will be persisted
      generatedInvoices: [],
      karigars: [],
      orders: [],
      hisaabEntries: [],
      expenses: [],

      isSettingsLoading: true,
      isProductsLoading: true,
      isCustomersLoading: true,
      isKarigarsLoading: true,
      isInvoicesLoading: true,
      isOrdersLoading: true,
      isHisaabLoading: true,
      isExpensesLoading: true,
      
      hasSettingsLoaded: false,
      hasProductsLoaded: false,
      hasCustomersLoaded: false,
      hasKarigarsLoaded: false,
      hasInvoicesLoaded: false,
      hasOrdersLoaded: false,
      hasHisaabLoaded: false,
      hasExpensesLoaded: false,

      settingsError: null,
      productsError: null,
      customersError: null,
      invoicesError: null,
      ordersError: null,
      karigarsError: null,
      hisaabError: null,
      expensesError: null,


      loadSettings: async () => {
        if (get().hasSettingsLoaded) return;
        set({ isSettingsLoading: true, settingsError: null });
        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          const docSnap = await getDoc(settingsDocRef);
          if (docSnap.exists()) {
            const firestoreSettings = docSnap.data() as Partial<Settings>;
            // Ensure allowedDeviceIds is always an array
            const finalSettings = {
              ...initialSettingsData,
              ...firestoreSettings,
              firebaseConfig: {
                ...initialSettingsData.firebaseConfig,
                projectId: "gemstrack-pos",
              },
              allowedDeviceIds: Array.isArray(firestoreSettings.allowedDeviceIds)
                ? firestoreSettings.allowedDeviceIds
                : [],
              theme: firestoreSettings.theme || 'slate',
            };
            set((state) => { state.settings = finalSettings; });
            console.log("[GemsTrack Store loadSettings] Settings loaded successfully from Firestore:", finalSettings);
          } else {
            console.log("[GemsTrack Store loadSettings] No settings found in Firestore, creating with initial data.");
            await setDoc(settingsDocRef, initialSettingsData);
            set((state) => { state.settings = initialSettingsData; });
          }
        } catch (error: any) {
          console.error("[GemsTrack Store loadSettings] Error loading settings from Firestore:", error);
          set({ settingsError: error.message || 'Failed to connect to the database.' });
          set((state) => { state.settings = initialSettingsData; }); // Fallback
        } finally {
          set({ isSettingsLoading: false, hasSettingsLoaded: true });
        }
      },
      updateSettings: async (newSettings) => {
        const currentSettings = get().settings;
        const updatedSettings = { ...currentSettings, ...newSettings };
        console.log("[GemsTrack Store updateSettings] Attempting to update settings:", updatedSettings);
        set((state) => { state.settings = updatedSettings; });
        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          await setDoc(settingsDocRef, updatedSettings, { merge: true });
          console.log("[GemsTrack Store updateSettings] Settings updated successfully in Firestore.");
        } catch (error)
        {
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
        if (get().hasProductsLoaded) return;
        set({ isProductsLoading: true, hasProductsLoaded: true, productsError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.PRODUCTS), orderBy("sku"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const productList = snapshot.docs.map(doc => doc.data() as Product);
            set({ products: productList, isProductsLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${productList.length} products loaded.`);
          }, 
          (error) => {
            console.error("[GemsTrack Store] Error in products real-time listener:", error);
            set({ products: [], isProductsLoading: false, productsError: error.message || 'Failed to load products.' }); // Mark as not loading
          }
        );
      },
      addProduct: async (productData) => {
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
            autoGeneratedName = productData.description || 'Custom Priced Item';
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
        
        // Remove undefined fields before sending to Firestore
        const cleanProduct = Object.fromEntries(Object.entries(newProduct).filter(([_, v]) => v !== undefined));

        console.log("[GemsTrack Store addProduct] Attempting to add product:", cleanProduct);

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, newProduct.sku), cleanProduct);
          console.log("[GemsTrack Store addProduct] Product added successfully to Firestore:", newProduct.sku);
          return newProduct;
        } catch (error) {
          console.error("[GemsTrack Store addProduct] Error adding product to Firestore:", error);
          return null;
        }
      },
      updateProduct: async (sku, updatedProductData) => {
        const productRef = doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku);
        console.log(`[GemsTrack Store updateProduct] Attempting to update product SKU ${sku} with:`, updatedProductData);
        try {
            const currentProduct = get().products.find(p => p.sku === sku);
            if (!currentProduct) throw new Error("Product not found for update");

            const mergedData = {...currentProduct, ...updatedProductData};
            
            const isActualGoldCoin = (mergedData.categoryId) === GOLD_COIN_CATEGORY_ID_INTERNAL && 
                                     (mergedData.metalType) === 'gold';

            let finalUpdatedFields: Partial<Product> = { ...updatedProductData };
            
            // If it is a custom price product, set its name from the description field
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
            
             // Remove undefined fields before sending to Firestore
            const cleanPayload = Object.fromEntries(Object.entries(payloadToFirestore).filter(([_, v]) => v !== undefined));


          await setDoc(productRef, cleanPayload, { merge: true });
          console.log(`[GemsTrack Store updateProduct] Product SKU ${sku} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateProduct] Error updating product SKU ${sku} in Firestore:`, error);
        }
      },
      deleteProduct: async (sku) => {
        console.log(`[GemsTrack Store deleteProduct] Attempting to delete product SKU ${sku}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku));
          set(state => {
            state.cart = state.cart.filter(item => item.sku !== sku);
          });
          console.log(`[GemsTrack Store deleteProduct] Product SKU ${sku} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteProduct] Error deleting product SKU ${sku} from Firestore:`, error);
        }
      },
       setProductQrCode: async (sku, qrCodeDataUrl) => {
        console.log(`[GemsTrack Store setProductQrCode] Setting QR for SKU ${sku}.`);
        try {
            await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku), { qrCodeDataUrl }, { merge: true });
        } catch (error) {
            console.error(`[GemsTrack Store setProductQrCode] Error saving QR code URL for SKU ${sku} to Firestore:`, error);
        }
      },

      loadCustomers: () => {
        if (get().hasCustomersLoaded) return;
        set({ isCustomersLoading: true, hasCustomersLoaded: true, customersError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.CUSTOMERS), orderBy("name"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const customerList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Customer));
            set({ customers: customerList, isCustomersLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${customerList.length} customers loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in customers real-time listener:", error);
            set({ customers: [], isCustomersLoading: false, customersError: error.message || 'Failed to load customers.' });
          }
        );
      },
      addCustomer: async (customerData) => {
        const newCustomerId = `cust-${Date.now()}`;
        const newCustomer: Customer = { ...customerData, id: newCustomerId };
        console.log("[GemsTrack Store addCustomer] Attempting to add customer:", newCustomer);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustomerId), newCustomer);
          console.log("[GemsTrack Store addCustomer] Customer added successfully:", newCustomerId);
          return newCustomer;
        } catch (error) {
          console.error("[GemsTrack Store addCustomer] Error adding customer to Firestore:", error);
          return null;
        }
      },
      updateCustomer: async (id, updatedCustomerData) => {
        console.log(`[GemsTrack Store updateCustomer] Attempting to update customer ID ${id} with:`, updatedCustomerData);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id), updatedCustomerData, { merge: true });
          console.log(`[GemsTrack Store updateCustomer] Customer ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateCustomer] Error updating customer ID ${id} in Firestore:`, error);
        }
      },
      deleteCustomer: async (id) => {
        console.log(`[GemsTrack Store deleteCustomer] Attempting to delete customer ID ${id}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id));
          console.log(`[GemsTrack Store deleteCustomer] Customer ID ${id} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteCustomer] Error deleting customer ID ${id} from Firestore:`, error);
        }
      },

      loadKarigars: () => {
        if (get().hasKarigarsLoaded) return;
        set({ isKarigarsLoading: true, hasKarigarsLoaded: true, karigarsError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.KARIGARS), orderBy("name"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const karigarList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Karigar));
            set({ karigars: karigarList, isKarigarsLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${karigarList.length} karigars loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in karigars real-time listener:", error);
            set({ karigars: [], isKarigarsLoading: false, karigarsError: error.message || 'Failed to load karigars.' });
          }
        );
      },
      addKarigar: async (karigarData) => {
        const newKarigarId = `karigar-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        const newKarigar: Karigar = { ...karigarData, id: newKarigarId };
        console.log("[GemsTrack Store addKarigar] Attempting to add karigar:", newKarigar);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, newKarigarId), newKarigar);
          console.log("[GemsTrack Store addKarigar] Karigar added successfully:", newKarigarId);
          return newKarigar;
        } catch (error) {
          console.error("[GemsTrack Store addKarigar] Error adding karigar to Firestore:", error);
          return null;
        }
      },
      updateKarigar: async (id, updatedKarigarData) => {
        console.log(`[GemsTrack Store updateKarigar] Attempting to update karigar ID ${id} with:`, updatedKarigarData);
         try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id), updatedKarigarData, { merge: true });
          console.log(`[GemsTrack Store updateKarigar] Karigar ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateKarigar] Error updating karigar ID ${id} in Firestore:`, error);
        }
      },
      deleteKarigar: async (id) => {
        console.log(`[GemsTrack Store deleteKarigar] Attempting to delete karigar ID ${id}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id));
          console.log(`[GemsTrack Store deleteKarigar] Karigar ID ${id} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteKarigar] Error deleting karigar ID ${id} from Firestore:`, error);
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
        if (get().hasInvoicesLoaded) return;
        set({ isInvoicesLoading: true, hasInvoicesLoaded: true, invoicesError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.INVOICES), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const invoiceList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice));
            set({ generatedInvoices: invoiceList, isInvoicesLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${invoiceList.length} invoices loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in invoices real-time listener:", error);
            set({ generatedInvoices: [], isInvoicesLoading: false, invoicesError: error.message || 'Failed to load invoices.' });
          }
        );
      },
      generateInvoice: async (customerInfo, invoiceRates, discountAmount) => {
        const { cart } = get();
        if (cart.length === 0) return null;
        console.log("[GemsTrack Store generateInvoice] Starting invoice generation...");
    
        try {
            return await runTransaction(db, async (transaction) => {
                let finalCustomerId = customerInfo.id;
                let customerName = customerInfo.name;

                // If it's a walk-in customer with a name, create a new customer profile.
                if (!finalCustomerId && customerName) {
                    const newCustId = `cust-${Date.now()}`;
                    const newCustomer: Customer = { 
                        id: newCustId, 
                        name: customerName, 
                        phone: customerInfo.phone || "" 
                    };
                    transaction.set(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustId), newCustomer);
                    finalCustomerId = newCustId;
                } else if (finalCustomerId) {
                    const custDoc = await transaction.get(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, finalCustomerId));
                    if(custDoc.exists()) {
                        customerName = custDoc.data().name;
                    }
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
                const productsToMove = [];
    
                for (const cartItem of cart) {
                    const productDocRef = doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, cartItem.sku);
                    const productDoc = await transaction.get(productDocRef);
    
                    if (!productDoc.exists()) {
                        console.log(`Product with SKU ${cartItem.sku} does not exist in inventory. Treating as custom item for this invoice.`);
                    } else {
                       productsToMove.push(cartItem);
                    }
                    
                    const product = cartItem; // Use the (potentially edited) cart item for calculation
    
                    const costs = _calculateProductCostsInternal(product, ratesForInvoice);
                    if (isNaN(costs.totalPrice)) {
                        throw new Error(`Calculated cost for product ${product.sku} is NaN.`);
                    }
    
                    const itemTotal = costs.totalPrice;
                    subtotal += itemTotal;
    
                    invoiceItems.push({
                        sku: product.sku, name: product.name, categoryId: product.categoryId,
                        metalType: product.metalType, metalWeightG: product.metalWeightG, stoneWeightG: product.stoneWeightG,
                        quantity: 1, unitPrice: itemTotal, itemTotal: itemTotal,
                        metalCost: costs.metalCost, wastageCost: costs.wastageCost,
                        wastagePercentage: product.wastagePercentage, makingCharges: costs.makingCharges,
                        diamondChargesIfAny: costs.diamondCharges, stoneChargesIfAny: costs.stoneCharges,
                        miscChargesIfAny: costs.miscCharges, stoneDetails: product.stoneDetails,
                        diamondDetails: product.diamondDetails, karat: product.karat
                    });
                }
    
                const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
                const grandTotal = subtotal - calculatedDiscountAmount;
                const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
                const settingsDoc = await transaction.get(settingsDocRef);
                const currentSettings = settingsDoc.data() as Settings;

                const nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
                const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
    
                const newInvoiceData: Omit<Invoice, 'id'> = {
                    items: invoiceItems, subtotal, discountAmount: calculatedDiscountAmount, grandTotal,
                    amountPaid: 0, balanceDue: grandTotal, createdAt: new Date().toISOString(),
                    ratesApplied: ratesForInvoice, 
                    customerId: finalCustomerId, customerName: customerName || 'Walk-in Customer'
                };
    
                // --- Transactional Writes ---
                transaction.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), newInvoiceData);
    
                for (const product of productsToMove) {
                    transaction.set(doc(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS, product.sku), product);
                    transaction.delete(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, product.sku));
                }
    
                transaction.update(settingsDocRef, { lastInvoiceNumber: nextInvoiceNumber });
    
                const hisaabEntry: Omit<HisaabEntry, 'id'> = {
                    entityId: finalCustomerId || 'walk-in', entityType: 'customer',
                    entityName: newInvoiceData.customerName || 'Walk-in Customer', date: newInvoiceData.createdAt,
                    description: `Invoice ${invoiceId}`, cashDebit: grandTotal, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0,
                };
                transaction.set(doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB)), hisaabEntry);
                
                set({ cart: [] });

                return { id: invoiceId, ...newInvoiceData } as Invoice;
            });
        } catch (error) {
            console.error("[GemsTrack Store generateInvoice] Transaction failed: ", error);
            return null;
        }
      },

      updateInvoicePayment: async (invoiceId, paymentAmount) => {
        const invoice = get().generatedInvoices.find(inv => inv.id === invoiceId);
        if (!invoice) {
            console.error(`[updateInvoicePayment] Invoice with ID ${invoiceId} not found.`);
            return null;
        }
        
        const newAmountPaid = invoice.amountPaid + paymentAmount;
        const newBalanceDue = invoice.grandTotal - newAmountPaid;

        const updatedFields = {
            amountPaid: newAmountPaid,
            balanceDue: newBalanceDue,
        };

        try {
            const invoiceDocRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
            await setDoc(invoiceDocRef, updatedFields, { merge: true });
            console.log(`[updateInvoicePayment] Invoice ${invoiceId} updated with payment of ${paymentAmount}.`);
            
            return { ...invoice, ...updatedFields };

        } catch (error) {
            console.error(`[updateInvoicePayment] Error updating invoice ${invoiceId} in Firestore:`, error);
            return null;
        }
      },

      deleteInvoice: async (invoiceId, isEditing = false) => {
          console.log(`[deleteInvoice] Attempting to delete invoice ${invoiceId}. Is editing flow: ${isEditing}`);
          try {
              await runTransaction(db, async (transaction) => {
                  const invoiceDocRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
                  const invoiceDoc = await transaction.get(invoiceDocRef);
                  if (!invoiceDoc.exists()) throw new Error("Invoice not found");

                  const invoiceData = invoiceDoc.data() as Invoice;
                  
                  // Restore sold products back to active inventory
                  for(const item of invoiceData.items) {
                      const soldProductRef = doc(db, FIRESTORE_COLLECTIONS.SOLD_PRODUCTS, item.sku);
                      const soldProductDoc = await transaction.get(soldProductRef);
                      if (soldProductDoc.exists()) {
                          const productData = soldProductDoc.data();
                          transaction.set(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, item.sku), productData);
                          transaction.delete(soldProductRef);
                      }
                  }

                  // Find and delete the corresponding hisaab entry
                  const hisaabQuery = query(collection(db, FIRESTORE_COLLECTIONS.HISAAB), 
                    orderBy("date", "desc"));
                  const hisaabSnapshot = await getDocs(hisaabQuery);
                  const hisaabEntryToDelete = hisaabSnapshot.docs.find(doc => doc.data().description === `Invoice ${invoiceId}`);
                  if (hisaabEntryToDelete) {
                      transaction.delete(hisaabEntryToDelete.ref);
                  }

                  // Delete the invoice itself
                  transaction.delete(invoiceDocRef);
              });
              
              if (!isEditing) {
                // If it's a full delete, we can also decrement the invoice counter, but it can lead to reuse.
                // It might be safer to not decrement it to avoid ID clashes if an old invoice is referenced somewhere.
              }

          } catch (e) {
              console.error(`Failed to delete invoice ${invoiceId}:`, e);
              throw e;
          }
      },

      loadOrders: () => {
        if (get().hasOrdersLoaded) return;
        set({ isOrdersLoading: true, ordersError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.ORDERS), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const orderList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Order));
            set(state => {
              state.orders = orderList;
              state.isOrdersLoading = false;
              if (!state.hasOrdersLoaded) {
                 state.hasOrdersLoaded = true;
              }
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

          await batch.commit();
          console.log(`[GemsTrack Store addOrder] Order ${newOrderId} and settings successfully committed.`);
          
          return finalOrder;
        } catch (error) {
          console.error(`[GemsTrack Store addOrder] Error saving order ${newOrderId} to Firestore:`, error);
          return null;
        }
      },
      updateOrder: async (orderId: string, updatedOrderData: Partial<Order>) => {
        const orderRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
        await setDoc(orderRef, updatedOrderData, { merge: true });
      },
      updateOrderStatus: async (orderId, status) => {
        console.log(`[GemsTrack Store updateOrderStatus] Updating order ${orderId} to status: ${status}`);
        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
          await setDoc(orderDocRef, { status }, { merge: true });
          console.log(`[GemsTrack Store updateOrderStatus] Successfully updated status for order ${orderId}.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateOrderStatus] Error updating status for order ${orderId}:`, error);
          throw error;
        }
      },

      updateOrderItemStatus: async (orderId, itemIndex, isCompleted) => {
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
    
        const finalInvoiceItems = order.items.map((originalItem, index) => {
            const finalizedData = finalizedItems.find(fi => fi.description === originalItem.description);
            if (!finalizedData) {
                console.error(`Could not find finalized data for item: ${originalItem.description}`);
                // This is a critical error, we should probably stop.
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
    
            return {
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
        });
    
        const totalDiscount = order.advancePayment + additionalDiscount;
        const grandTotal = finalSubtotal - totalDiscount;
    
        const nextInvoiceNumber = (settings.lastInvoiceNumber || 0) + 1;
        const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
    
        const newInvoiceData: Omit<Invoice, 'id'> = {
            items: finalInvoiceItems,
            subtotal: finalSubtotal,
            discountAmount: totalDiscount,
            grandTotal: grandTotal,
            amountPaid: 0,
            balanceDue: grandTotal,
            createdAt: new Date().toISOString(),
            ratesApplied: ratesForInvoice,
            customerId: order.customerId,
            customerName: order.customerName,
        };
    
        const newInvoice: Invoice = { id: invoiceId, ...newInvoiceData };
    
        try {
            const batch = writeBatch(db);
            batch.set(doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId), newInvoiceData);
            batch.update(doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID), { lastInvoiceNumber: nextInvoiceNumber });
            batch.update(doc(db, FIRESTORE_COLLECTIONS.ORDERS, order.id), { status: 'Completed' });
            
            const hisaabEntry: Omit<HisaabEntry, 'id'> = {
              entityId: order.customerId || 'walk-in',
              entityType: 'customer',
              entityName: order.customerName || 'Walk-in Customer',
              date: newInvoice.createdAt,
              description: `Final Invoice ${newInvoice.id} from Order ${order.id}`,
              cashDebit: newInvoice.grandTotal,
              cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0,
            };
            batch.set(doc(collection(db, FIRESTORE_COLLECTIONS.HISAAB)), hisaabEntry);

            await batch.commit();
            
            set(state => { state.clearCart(); });
            
            return newInvoice;
        } catch (error) {
            console.error("Error finalizing order into invoice:", error);
            return null;
        }
      },

      loadHisaab: () => {
        if (get().hasHisaabLoaded) return;
        set({ isHisaabLoading: true, hasHisaabLoaded: true, hisaabError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.HISAAB), orderBy("date", "desc"));
        const unsubscribe = onSnapshot(q,
          (snapshot) => {
            const entryList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as HisaabEntry));
            set({ hisaabEntries: entryList, isHisaabLoading: false });
             console.log(`[GemsTrack Store] Real-time update: ${entryList.length} hisaab entries loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in hisaab real-time listener:", error);
            set({ hisaabEntries: [], isHisaabLoading: false, hisaabError: error.message || 'Failed to load hisaab.' });
          }
        );
      },
      addHisaabEntry: async (entryData) => {
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
        if (get().hasExpensesLoaded) return;
        set({ isExpensesLoading: true, hasExpensesLoaded: true, expensesError: null });
        const q = query(collection(db, FIRESTORE_COLLECTIONS.EXPENSES), orderBy("date", "desc"));
        const unsubscribe = onSnapshot(q,
          (snapshot) => {
            const expenseList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Expense));
            set({ expenses: expenseList, isExpensesLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${expenseList.length} expenses loaded.`);
          },
          (error) => {
            console.error("[GemsTrack Store] Error in expenses real-time listener:", error);
            set({ expenses: [], isExpensesLoading: false, expensesError: error.message || 'Failed to load expenses.' });
          }
        );
      },
      addExpense: async (expenseData) => {
        try {
          const docRef = await addDoc(collection(db, FIRESTORE_COLLECTIONS.EXPENSES), expenseData);
          console.log("[GemsTrack Store addExpense] Expense added with ID:", docRef.id);
          return { id: docRef.id, ...expenseData };
        } catch (error) {
          console.error("[GemsTrack Store addExpense] Error adding expense:", error);
          return null;
        }
      },
      updateExpense: async (id, updatedExpenseData) => {
        console.log(`[GemsTrack Store updateExpense] Attempting to update expense ID ${id}`);
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.EXPENSES, id), updatedExpenseData, { merge: true });
          console.log(`[GemsTrack Store updateExpense] Expense ID ${id} updated successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store updateExpense] Error updating expense ID ${id}:`, error);
        }
      },
      deleteExpense: async (id: string) => {
        console.log(`[GemsTrack Store deleteExpense] Attempting to delete expense ID ${id}.`);
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.EXPENSES, id));
          console.log(`[GemsTrack Store deleteExpense] Expense ID ${id} deleted successfully.`);
        } catch (error) {
          console.error(`[GemsTrack Store deleteExpense] Error deleting expense ID ${id}:`, error);
          throw error;
        }
      },


      // Data Clearing Actions
      clearAllProducts: async () => {
        set({ isProductsLoading: true });
        try {
            await deleteCollection(FIRESTORE_COLLECTIONS.PRODUCTS);
            await deleteCollection(FIRESTORE_COLLECTIONS.SOLD_PRODUCTS);
        } finally {
        }
      },
      clearAllCustomers: async () => {
          set({ isCustomersLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.CUSTOMERS);
          } finally {
          }
      },
      clearAllKarigars: async () => {
          set({ isKarigarsLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.KARIGARS);
          } finally {
          }
      },
      clearAllInvoices: async () => {
          set({ isInvoicesLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.INVOICES);
          } finally {
          }
      },
      clearAllOrders: async () => {
          set({ isOrdersLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.ORDERS);
          } finally {
          }
      },
      clearAllExpenses: async () => {
          set({ isExpensesLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.EXPENSES);
          } finally {
          }
      },
      clearAllData: async () => {
          console.warn("CLEARING ALL APPLICATION DATA");
          await Promise.all([
              get().clearAllProducts(),
              get().clearAllCustomers(),
              get().clearAllKarigars(),
              get().clearAllInvoices(),
              get().clearAllOrders(),
              get().clearAllExpenses(),
              deleteCollection(FIRESTORE_COLLECTIONS.HISAAB), 
          ]);
          get().clearCart();
          console.warn("ALL APPLICATION DATA CLEARED.");
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
            allowedDeviceIds: Array.isArray(state.settings?.allowedDeviceIds) ? state.settings.allowedDeviceIds : [], 
            theme: state.settings?.theme || 'default',
        }
      }),
      version: 14, // Incremented version
      migrate: (persistedState, version) => {
        const oldState = persistedState as any;
        if (version < 14) {
            // No specific migrations needed for this version bump,
            // but the structure is here for future use.
            // For example, if we added a new setting that needed a default in persisted state:
            // if (!oldState.settings.newField) {
            //   oldState.settings.newField = 'default value';
            // }
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
