
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// --- Firestore Collection Names ---
const FIRESTORE_COLLECTIONS = {
  SETTINGS: "app_settings",
  PRODUCTS: "products",
  CUSTOMERS: "customers",
  KARIGARS: "karigars",
  INVOICES: "invoices",
  ORDERS: "orders",
  CATEGORIES: "categories", // Note: Categories are still managed locally for now
};
const GLOBAL_SETTINGS_DOC_ID = "global";


// --- Helper Functions and Constants ---
const DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = '21k';
const GOLD_COIN_CATEGORY_ID_INTERNAL = 'cat017';

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


function _parseKaratInternal(karat: KaratValue | string | undefined): number {
  const karatToUse = karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
  const karatString = String(karatToUse).trim();

  if (!karatString) {
    return parseInt(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k', ''), 10);
  }
  const numericPart = parseInt(karatString.replace('k', ''), 10);
  if (isNaN(numericPart) || numericPart <= 0) {
    console.warn(`[GemsTrack] _parseKaratInternal: Invalid Karat value encountered: '${karatToUse}'. Defaulting to ${DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL}.`);
    return parseInt(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k', ''), 10);
  }
  return numericPart;
}

function _calculateProductCostsInternal(
  product: {
    categoryId?: string;
    name?: string;
    metalType: MetalType;
    karat?: KaratValue | string;
    metalWeightG: number;
    wastagePercentage: number;
    makingCharges: number;
    hasDiamonds: boolean;
    diamondCharges: number;
    stoneCharges: number;
    miscCharges: number;
  },
  rates: { goldRatePerGram24k: number; palladiumRatePerGram: number; platinumRatePerGram: number }
) {
  let metalCost = 0;
  const currentMetalType = product.metalType || 'gold';
  const metalWeightG = Number(product.metalWeightG) || 0;
  const isActualGoldCoin = product.categoryId === GOLD_COIN_CATEGORY_ID_INTERNAL && currentMetalType === 'gold';

  const wastagePercentage = isActualGoldCoin ? 0 : (Number(product.wastagePercentage) || 0);
  const makingCharges = isActualGoldCoin ? 0 : (Number(product.makingCharges) || 0);
  const hasDiamondsValue = isActualGoldCoin ? false : product.hasDiamonds;
  const diamondChargesValue = hasDiamondsValue ? (Number(product.diamondCharges) || 0) : 0;
  const stoneChargesValue = isActualGoldCoin ? 0 : (Number(product.stoneCharges) || 0);
  const miscChargesValue = isActualGoldCoin ? 0 : (Number(product.miscCharges) || 0);

  const goldRate24k = Number(rates.goldRatePerGram24k) || 0;
  const palladiumRate = Number(rates.palladiumRatePerGram) || 0;
  const platinumRate = Number(rates.platinumRatePerGram) || 0;

  if (currentMetalType === 'gold') {
    const karatToUse = product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
    const karatNumeric = _parseKaratInternal(karatToUse);
    if (karatNumeric > 0 && goldRate24k > 0) {
      const purityFactor = karatNumeric / 24;
      const effectiveGoldRate = purityFactor * goldRate24k;
      metalCost = metalWeightG * effectiveGoldRate;
    } else {
      metalCost = 0;
    }
  } else if (currentMetalType === 'palladium') {
    if (palladiumRate > 0) metalCost = metalWeightG * palladiumRate;
  } else if (currentMetalType === 'platinum') {
    if (platinumRate > 0) metalCost = metalWeightG * platinumRate;
  }

  const validMetalCost = Number(metalCost) || 0;
  const wastageCost = validMetalCost * (wastagePercentage / 100);
  const validWastageCost = Number(wastageCost) || 0;
  const totalPrice = validMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneChargesValue + miscChargesValue;
  
  // CRITICAL FIX: Ensure totalPrice is never NaN.
  if (isNaN(totalPrice)) {
    console.error("[GemsTrack Store _calculateProductCostsInternal] CRITICAL: Produced NaN. Details:", {
        productInputName: product.name,
        productCategoryId: product.categoryId,
        productProcessed: { metalWeightG, wastagePercentage, makingCharges, hasDiamonds: hasDiamondsValue, diamondChargesValue, stoneChargesValue, miscChargesValue, currentMetalType, karat: product.karat },
        ratesInput: rates,
        ratesProcessed: { goldRate24k, palladiumRate, platinumRate },
        derivedCosts: { metalCost: validMetalCost, wastageCost: validWastageCost },
        calculatedTotalPrice: totalPrice
    });
    // Return a safe, zeroed-out object if NaN is detected.
    return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, totalPrice: 0 };
  }

  return {
    metalCost: validMetalCost,
    wastageCost: validWastageCost,
    makingCharges: makingCharges,
    diamondCharges: diamondChargesValue,
    stoneCharges: stoneChargesValue,
    miscCharges: miscChargesValue,
    totalPrice: totalPrice,
  };
}

// --- Type Definitions ---
export type MetalType = 'gold' | 'palladium' | 'platinum';
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

export interface Settings {
  goldRatePerGram: number;
  palladiumRatePerGram: number;
  platinumRatePerGram: number;
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
  metalType: MetalType;
  karat?: KaratValue;
  metalWeightG: number;
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
}

export interface InvoiceItem {
  sku: string;
  name: string;
  categoryId: string;
  metalType: MetalType;
  karat?: KaratValue;
  metalWeightG: number;
  quantity: number;
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
  createdAt: string; // ISO string
  goldRateApplied?: number;
  palladiumRateApplied?: number;
  platinumRateApplied?: number;
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
  karat: KaratValue;
  estimatedWeightG: number;
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
  totalEstimate?: number;
}

export interface Order {
  id: string; // Firestore document ID, e.g., ORD-000001
  createdAt: string; // ISO string
  status: OrderStatus;
  items: OrderItem[];
  goldRate: number;
  subtotal: number;
  advancePayment: number;
  advanceGoldDetails?: string;
  grandTotal: number;
  customerId?: string;
  customerName?: string;
  customerContact?: string;
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
  'cat017': 'GCN',
};

// --- Initial Data Definitions (For reference or one-time seeding, not for store initial state) ---
const initialSettingsData: Settings = {
  goldRatePerGram: 20000, palladiumRatePerGram: 22000, platinumRatePerGram: 25000,
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
];

// --- Store State and Actions ---
type ProductDataForAdd = Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>;
type OrderDataForAdd = Omit<Order, 'id' | 'createdAt' | 'status'> & { subtotal?: number; grandTotal?: number };


export interface CartItem {
  sku: string;
  quantity: number;
}

export interface AppState {
  settings: Settings;
  categories: Category[]; // Still local for now
  products: Product[];
  customers: Customer[];
  cart: CartItem[]; // Persisted locally
  generatedInvoices: Invoice[];
  karigars: Karigar[];
  orders: Order[];

  // Loading states
  isSettingsLoading: boolean;
  isProductsLoading: boolean;
  isCustomersLoading: boolean;
  isKarigarsLoading: boolean;
  isInvoicesLoading: boolean;
  isOrdersLoading: boolean;
  
  // Data loaded flags
  hasProductsLoaded: boolean;
  hasCustomersLoaded: boolean;
  hasKarigarsLoaded: boolean;
  hasInvoicesLoaded: boolean;
  hasOrdersLoaded: boolean;

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
  updateProduct: (sku: string, updatedProductData: Partial<Omit<Product, 'sku' | 'name'>>) => Promise<void>;
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

  addToCart: (sku: string, quantity?: number) => void;
  removeFromCart: (sku: string) => void;
  updateCartQuantity: (sku: string, quantity: number) => void;
  clearCart: () => void;

  loadGeneratedInvoices: () => void;
  generateInvoice: (
    customerId: string | undefined,
    invoiceGoldRate24k: number,
    discountAmount: number
  ) => Promise<Invoice | null>;
  
  loadOrders: () => void;
  addOrder: (orderData: OrderDataForAdd) => Promise<Order | null>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  updateOrderItemStatus: (orderId: string, itemIndex: number, isCompleted: boolean) => Promise<void>;
  
  // Data clearing actions
  clearAllProducts: () => Promise<void>;
  clearAllCustomers: () => Promise<void>;
  clearAllKarigars: () => Promise<void>;
  clearAllInvoices: () => Promise<void>;
  clearAllOrders: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

export type EnrichedCartItem = Product & {
  quantity: number;
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

      isSettingsLoading: true,
      isProductsLoading: false,
      isCustomersLoading: false,
      isKarigarsLoading: false,
      isInvoicesLoading: false,
      isOrdersLoading: false,
      
      hasProductsLoaded: false,
      hasCustomersLoaded: false,
      hasKarigarsLoaded: false,
      hasInvoicesLoaded: false,
      hasOrdersLoaded: false,

      loadSettings: async () => {
        if (!get().isSettingsLoading) {
            return; // Already loaded or in progress
        }
        set({ isSettingsLoading: true });
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
        } catch (error) {
          console.error("[GemsTrack Store loadSettings] Error loading settings from Firestore:", error);
          set((state) => { state.settings = initialSettingsData; }); // Fallback
        } finally {
          set({ isSettingsLoading: false });
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
        if (get().hasProductsLoaded || get().isProductsLoading) return;
        set({ isProductsLoading: true });
        
        const q = query(collection(db, FIRESTORE_COLLECTIONS.PRODUCTS), orderBy("sku"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const productList = snapshot.docs.map(doc => doc.data() as Product);
            set({ products: productList, hasProductsLoaded: true, isProductsLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${productList.length} products loaded.`);
        }, (error) => {
            console.error("[GemsTrack Store] Error in products real-time listener:", error);
            set({ products: [], isProductsLoading: false });
        });
        
        // This is a global listener for the app's lifetime, so we don't return unsubscribe from here.
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
        const autoGeneratedName = `${category.title} - ${generatedSku}`;
        
        const isActualGoldCoin = productData.categoryId === GOLD_COIN_CATEGORY_ID_INTERNAL && productData.metalType === 'gold';
        const finalProductData = { 
          ...productData,
          hasDiamonds: isActualGoldCoin ? false : productData.hasDiamonds,
          diamondCharges: isActualGoldCoin ? 0 : (productData.hasDiamonds ? productData.diamondCharges : 0),
          wastagePercentage: isActualGoldCoin ? 0 : productData.wastagePercentage,
          makingCharges: isActualGoldCoin ? 0 : productData.makingCharges,
          stoneCharges: isActualGoldCoin ? 0 : productData.stoneCharges,
          miscCharges: isActualGoldCoin ? 0 : productData.miscCharges,
        };
        if (finalProductData.metalType !== 'gold') { delete finalProductData.karat; }

        const newProduct: Product = { ...finalProductData, name: autoGeneratedName, sku: generatedSku };
        console.log("[GemsTrack Store addProduct] Attempting to add product:", newProduct);

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, newProduct.sku), newProduct);
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
            const { sku: _s, name: _n, ...payloadToFirestore } = finalUpdatedFields;

          await setDoc(productRef, payloadToFirestore, { merge: true });
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
        if (get().hasCustomersLoaded || get().isCustomersLoading) return;
        set({ isCustomersLoading: true });
        
        const q = query(collection(db, FIRESTORE_COLLECTIONS.CUSTOMERS), orderBy("name"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const customerList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Customer));
            set({ customers: customerList, hasCustomersLoaded: true, isCustomersLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${customerList.length} customers loaded.`);
        }, (error) => {
            console.error("[GemsTrack Store] Error in customers real-time listener:", error);
            set({ customers: [], isCustomersLoading: false });
        });
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
        if (get().hasKarigarsLoaded || get().isKarigarsLoading) return;
        set({ isKarigarsLoading: true });
        
        const q = query(collection(db, FIRESTORE_COLLECTIONS.KARIGARS), orderBy("name"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const karigarList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Karigar));
            set({ karigars: karigarList, hasKarigarsLoaded: true, isKarigarsLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${karigarList.length} karigars loaded.`);
        }, (error) => {
            console.error("[GemsTrack Store] Error in karigars real-time listener:", error);
            set({ karigars: [], isKarigarsLoading: false });
        });
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

      addToCart: (sku, quantity = 1) => set((state) => {
          const existingItem = state.cart.find((item) => item.sku === sku);
          if (existingItem) { existingItem.quantity += quantity; } else { state.cart.push({ sku, quantity }); }
      }),
      removeFromCart: (sku) => set((state) => { state.cart = state.cart.filter((item) => item.sku !== sku); }),
      updateCartQuantity: (sku, quantity) => set((state) => {
          const item = state.cart.find((i) => i.sku === sku);
          if (item) {
            if (quantity <= 0) { state.cart = state.cart.filter((i) => i.sku !== sku); } else { item.quantity = quantity; }
          }
      }),
      clearCart: () => set((state) => { state.cart = []; }),

      loadGeneratedInvoices: () => {
        if (get().hasInvoicesLoaded || get().isInvoicesLoading) return;
        set({ isInvoicesLoading: true });
        
        const q = query(collection(db, FIRESTORE_COLLECTIONS.INVOICES), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const invoiceList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice));
            set({ generatedInvoices: invoiceList, hasInvoicesLoaded: true, isInvoicesLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${invoiceList.length} invoices loaded.`);
        }, (error) => {
            console.error("[GemsTrack Store] Error in invoices real-time listener:", error);
            set({ generatedInvoices: [], isInvoicesLoading: false });
        });
      },
      generateInvoice: async (customerId, invoiceGoldRate24k, discountAmount) => {
        const { products, cart, customers, settings } = get();
        if (cart.length === 0) return null;
        console.log("[GemsTrack Store generateInvoice] Starting invoice generation...");

        let validInvoiceGoldRate24k = Number(invoiceGoldRate24k) || 0;
        const cartProducts = cart.map(ci => products.find(p => p.sku === ci.sku)).filter(Boolean) as Product[];

        const hasGoldItems = cartProducts.some(p => p.metalType === 'gold');
        const hasPalladiumItems = cartProducts.some(p => p.metalType === 'palladium');
        const hasPlatinumItems = cartProducts.some(p => p.metalType === 'platinum');

        if (hasGoldItems && validInvoiceGoldRate24k <= 0) {
            console.error("[GemsTrack Store generateInvoice] Gold items in cart but provided gold rate is invalid.");
            return null;
        }

        const ratesForInvoice = {
            goldRatePerGram24k: validInvoiceGoldRate24k,
            palladiumRatePerGram: Number(settings.palladiumRatePerGram) || 0,
            platinumRatePerGram: Number(settings.platinumRatePerGram) || 0,
        };
        
        console.log("[GemsTrack Store generateInvoice] Using rates for calculation:", ratesForInvoice);

        let subtotal = 0;
        const invoiceItems: InvoiceItem[] = [];

        for (const cartItem of cart) {
            const product = products.find(p => p.sku === cartItem.sku);
            if (!product) {
                console.warn(`[GemsTrack Store generateInvoice] Product SKU ${cartItem.sku} not found in store for invoice.`);
                continue;
            }
            // Deep copy the product object to avoid mutating the original store state
            const productForCostCalc = JSON.parse(JSON.stringify({
                name: product.name, categoryId: product.categoryId, metalType: product.metalType,
                karat: product.metalType === 'gold' ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL) : undefined,
                metalWeightG: product.metalWeightG, wastagePercentage: product.wastagePercentage, makingCharges: product.makingCharges,
                hasDiamonds: product.hasDiamonds, diamondCharges: product.diamondCharges, stoneCharges: product.stoneCharges, miscCharges: product.miscCharges,
            }));
            
            const costs = _calculateProductCostsInternal(productForCostCalc, ratesForInvoice);
            // CRITICAL NaN Check
            if (isNaN(costs.totalPrice)) {
                console.error(`[GemsTrack Store generateInvoice] Calculated cost for product ${product.sku} in cart is NaN. Skipping item.`);
                continue;
            }
            const unitPrice = costs.totalPrice;
            const itemTotal = unitPrice * cartItem.quantity;
            subtotal += itemTotal;
            
            const finalItem: InvoiceItem = {
                sku: product.sku,
                name: product.name,
                categoryId: product.categoryId,
                metalType: product.metalType,
                metalWeightG: product.metalWeightG,
                quantity: cartItem.quantity,
                unitPrice,
                itemTotal,
                metalCost: costs.metalCost,
                wastageCost: costs.wastageCost,
                wastagePercentage: product.wastagePercentage,
                makingCharges: costs.makingCharges,
                diamondChargesIfAny: costs.diamondCharges,
                stoneChargesIfAny: costs.stoneCharges,
                miscChargesIfAny: costs.miscCharges,
                stoneDetails: product.stoneDetails,
                diamondDetails: product.diamondDetails,
            };

            if (product.metalType === 'gold' && productForCostCalc.karat) {
                finalItem.karat = productForCostCalc.karat;
            }

            invoiceItems.push(finalItem);
        }
        
        const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
        const grandTotal = subtotal - calculatedDiscountAmount;
        
        const currentSettings = get().settings;
        const nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
        const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
        
        const newInvoiceData: { [key: string]: any } = {
          items: invoiceItems, 
          subtotal: Number(subtotal) || 0,
          discountAmount: calculatedDiscountAmount, 
          grandTotal: Number(grandTotal) || 0, 
          createdAt: new Date().toISOString(),
        };

        if (hasGoldItems && ratesForInvoice.goldRatePerGram24k > 0) {
            newInvoiceData.goldRateApplied = ratesForInvoice.goldRatePerGram24k;
        }
        if (hasPalladiumItems && ratesForInvoice.palladiumRatePerGram > 0) {
            newInvoiceData.palladiumRateApplied = ratesForInvoice.palladiumRatePerGram;
        }
        if (hasPlatinumItems && ratesForInvoice.platinumRatePerGram > 0) {
            newInvoiceData.platinumRateApplied = ratesForInvoice.platinumRatePerGram;
        }

        if (customerId) {
          const customer = customers.find(c => c.id === customerId);
          if (customer) {
            newInvoiceData.customerId = customer.id;
            if (customer.name) newInvoiceData.customerName = customer.name;
          }
        }
        
        const newInvoice: Invoice = {
            id: invoiceId,
            ...newInvoiceData
        } as Invoice;
        
        console.log("[GemsTrack Store generateInvoice] Generated invoice object for Firestore:", newInvoiceData);

        try {
            const batch = writeBatch(db);
            const invoiceDocRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
            batch.set(invoiceDocRef, newInvoiceData);

            const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
            batch.update(settingsDocRef, { lastInvoiceNumber: nextInvoiceNumber });
            
            await batch.commit();
            console.log("[GemsTrack Store generateInvoice] Invoice and settings successfully committed to Firestore.");

            // No need to manually update state, onSnapshot will handle it.
            // set(state => {
            //     state.generatedInvoices.unshift(newInvoice); 
            //     state.settings.lastInvoiceNumber = nextInvoiceNumber;
            // });
            return newInvoice;
        } catch (error) {
            console.error("[GemsTrack Store generateInvoice] Error committing invoice batch to Firestore:", error);
            return null;
        }
      },

      loadOrders: () => {
        if (get().hasOrdersLoaded || get().isOrdersLoading) return;
        set({ isOrdersLoading: true });
        
        const q = query(collection(db, FIRESTORE_COLLECTIONS.ORDERS), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const orderList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Order));
            set({ orders: orderList, hasOrdersLoaded: true, isOrdersLoading: false });
            console.log(`[GemsTrack Store] Real-time update: ${orderList.length} orders loaded.`);
        }, (error) => {
            console.error("[GemsTrack Store] Error in orders real-time listener:", error);
            set({ orders: [], isOrdersLoading: false });
        });
      },

      addOrder: async (orderData) => {
        const { settings, customers } = get();
        const nextOrderNumber = (settings.lastOrderNumber || 0) + 1;
        const newOrderId = `ORD-${nextOrderNumber.toString().padStart(6, '0')}`;

        let customerNameToSave = orderData.customerName;

        if (orderData.customerId) {
          const customer = customers.find(c => c.id === orderData.customerId);
          if (customer) {
            customerNameToSave = customer.name;
          }
        }
        
        // CRITICAL FIX: Ensure totals are always numbers before saving.
        const finalSubtotal = Number(orderData.subtotal) || 0;
        const finalGrandTotal = Number(orderData.grandTotal) || 0;

        const newOrder: Order = {
          ...(orderData as Omit<OrderDataForAdd, 'subtotal'|'grandTotal'>),
          subtotal: finalSubtotal,
          grandTotal: finalGrandTotal,
          customerName: customerNameToSave,
          id: newOrderId,
          createdAt: new Date().toISOString(),
          status: 'Pending',
        };
        
        console.log("[GemsTrack Store addOrder] Attempting to save order:", newOrder);

        try {
          const batch = writeBatch(db);
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, newOrderId);
          batch.set(orderDocRef, newOrder);

          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          batch.update(settingsDocRef, { lastOrderNumber: nextOrderNumber });

          await batch.commit();
          console.log(`[GemsTrack Store addOrder] Order ${newOrderId} and settings successfully committed.`);
          
          // No need to manually update state, onSnapshot will handle it.
          // set(state => {
          //   state.orders.unshift(newOrder);
          //   state.settings.lastOrderNumber = nextOrderNumber;
          // });
          return newOrder;
        } catch (error) {
          console.error(`[GemsTrack Store addOrder] Error saving order ${newOrderId} to Firestore:`, error);
          return null;
        }
      },

      updateOrderStatus: async (orderId, status) => {
        console.log(`[GemsTrack Store updateOrderStatus] Updating order ${orderId} to status: ${status}`);
        try {
          const orderDocRef = doc(db, FIRESTORE_COLLECTIONS.ORDERS, orderId);
          await setDoc(orderDocRef, { status }, { merge: true });
          // No need to manually update state, onSnapshot will handle it.
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
          // No need to manually update state, onSnapshot will handle it.
          console.log(`Successfully updated item #${itemIndex} status for order ${orderId}.`);
        } catch (error) {
          console.error(`Error updating item status for order ${orderId}:`, error);
          throw error;
        }
      },
      
      // Data Clearing Actions
      clearAllProducts: async () => {
        set({ isProductsLoading: true });
        try {
            await deleteCollection(FIRESTORE_COLLECTIONS.PRODUCTS);
            // No need to clear local state, onSnapshot will receive an empty list
        } finally {
            // isProductsLoading will be set to false by the snapshot listener
        }
      },
      clearAllCustomers: async () => {
          set({ isCustomersLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.CUSTOMERS);
          } finally {
              // isCustomersLoading will be set to false by the snapshot listener
          }
      },
      clearAllKarigars: async () => {
          set({ isKarigarsLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.KARIGARS);
          } finally {
              // isKarigarsLoading will be set to false by the snapshot listener
          }
      },
      clearAllInvoices: async () => {
          set({ isInvoicesLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.INVOICES);
          } finally {
              // isInvoicesLoading will be set to false by the snapshot listener
          }
      },
      clearAllOrders: async () => {
          set({ isOrdersLoading: true });
          try {
              await deleteCollection(FIRESTORE_COLLECTIONS.ORDERS);
          } finally {
              // isOrdersLoading will be set to false by the snapshot listener
          }
      },
      clearAllData: async () => {
          console.warn("CLEARING ALL APPLICATION DATA");
          // Resetting settings does not happen here, only transactional data.
          await Promise.all([
              get().clearAllProducts(),
              get().clearAllCustomers(),
              get().clearAllKarigars(),
              get().clearAllInvoices(),
              get().clearAllOrders(),
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
        settings: { // Persist only a subset of settings
            ...state.settings,
            // Don't persist sensitive or heavyweight data that should be fetched
            allowedDeviceIds: Array.isArray(state.settings?.allowedDeviceIds) ? state.settings.allowedDeviceIds : [], 
            theme: state.settings?.theme || 'default',
        }
      }),
      version: 12,
      migrate: (persistedState, version) => {
        const oldState = persistedState as any;
        if (version < 12) {
          // No specific migration needed from v11 to v12, but this structure allows for future changes.
        }
        return oldState as AppState;
      },
    }
  )
);

// --- Exported Helper Functions ---
export const DEFAULT_KARAT_VALUE_FOR_CALCULATION: KaratValue = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
export const GOLD_COIN_CATEGORY_ID: string = GOLD_COIN_CATEGORY_ID_INTERNAL;
export function calculateProductCosts(
  product: Omit<Product, 'sku' | 'qrCodeDataUrl' | 'imageUrl' | 'name'> & {
    categoryId?: string;
    name?: string;
  },
  rates: { goldRatePerGram24k: number; palladiumRatePerGram: number; platinumRatePerGram: number }
) {
  return _calculateProductCostsInternal(product, rates);
}

// --- Hydration Hooks ---
import React, { useEffect, useState, useSyncExternalStore } from 'react';

function useZustandRehydrated() {
    const hasHydrated = useSyncExternalStore(
        useAppStore.subscribe,
        () => useAppStore.getState()._hasHydrated,
        () => false
    );
    return hasHydrated;
}

export const useAppReady = () => {
    const isSettingsLoaded = !useAppStore(state => state.isSettingsLoading);
    const isZustandRehydrated = useZustandRehydrated();
    return isZustandRehydrated && isSettingsLoaded;
};

// --- SELECTOR DEFINITIONS ---
export const selectCartDetails = (state: AppState): EnrichedCartItem[] => {
  if (!state.cart || !Array.isArray(state.cart)) {
    console.warn("[GemsTrack selectCartDetails] state.cart is not an array or undefined:", state.cart);
    return [];
  }
  if (!state.products || !Array.isArray(state.products)) {
    console.warn("[GemsTrack selectCartDetails] state.products is not an array or undefined:", state.products);
    return [];
  }
  if (!state.settings) {
    console.warn("[GemsTrack selectCartDetails] state.settings is missing.");
    return [];
  }

  return state.cart
    .map((cartItem) => {
      const product = state.products.find((p) => p.sku === cartItem.sku);
      if (!product) {
        console.warn(`[GemsTrack selectCartDetails] Product with SKU ${cartItem.sku} not found in cart.`);
        return null; 
      }
      const ratesForCalc = {
        goldRatePerGram24k: state.settings.goldRatePerGram,
        palladiumRatePerGram: state.settings.palladiumRatePerGram,
        platinumRatePerGram: state.settings.platinumRatePerGram,
      };
      const costs = calculateProductCosts(product, ratesForCalc);
      if (isNaN(costs.totalPrice)) {
        console.error(`[GemsTrack selectCartDetails] Calculated cost for product ${product.sku} in cart is NaN.`);
        return null;
      }
      return {
        ...product,
        quantity: cartItem.quantity,
        totalPrice: costs.totalPrice,
        lineItemTotal: costs.totalPrice * cartItem.quantity,
      };
    })
    .filter((item): item is EnrichedCartItem => item !== null);
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
    const rates = {
        goldRatePerGram24k: state.settings.goldRatePerGram,
        palladiumRatePerGram: state.settings.palladiumRatePerGram,
        platinumRatePerGram: state.settings.platinumRatePerGram,
    };
    const costs = calculateProductCosts(product, rates);
    return { ...product, ...costs };
};

export const selectAllProductsWithCosts = (state: AppState): (Product & ReturnType<typeof calculateProductCosts>)[] => {
    if (!state.products || !Array.isArray(state.products) || !state.settings) {
        // console.warn("[GemsTrack selectAllProductsWithCosts] Products or settings not available. Returning empty array.");
        return [];
    }
    const rates = {
        goldRatePerGram24k: state.settings.goldRatePerGram,
        palladiumRatePerGram: state.settings.palladiumRatePerGram,
        platinumRatePerGram: state.settings.platinumRatePerGram,
    };
    return state.products.map(product => {
        const costs = calculateProductCosts(product, rates);
        return { ...product, ...costs };
    });
};
console.log("[GemsTrack Store] store.ts: Module fully evaluated.");

// Hook to check hydration status, useful for client-side only rendering logic or avoiding hydration mismatches.
export const useIsStoreHydrated = () => {
    return useSyncExternalStore<boolean>(
        useAppStore.subscribe,
        () => useAppStore.getState()._hasHydrated,
        () => false
    );
};
