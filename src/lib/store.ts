
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// --- Firestore Collection Names ---
const FIRESTORE_COLLECTIONS = {
  SETTINGS: "app_settings",
  PRODUCTS: "products",
  CUSTOMERS: "customers",
  KARIGARS: "karigars",
  INVOICES: "invoices",
  CATEGORIES: "categories", // Note: Categories are still managed locally for now
};
const GLOBAL_SETTINGS_DOC_ID = "global";


// --- Helper Functions and Constants ---
const DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = '21k';
const GOLD_COIN_CATEGORY_ID_INTERNAL = 'cat017';

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
  const finalTotalPrice = Number(totalPrice) || 0;

  if (isNaN(finalTotalPrice)) {
    console.error("[GemsTrack] _calculateProductCostsInternal produced NaN. Details:", {
        productInputName: product.name,
        productCategoryId: product.categoryId,
        productProcessed: { metalWeightG, wastagePercentage, makingCharges, hasDiamonds: hasDiamondsValue, diamondChargesValue, stoneChargesValue, miscChargesValue, currentMetalType, karat: product.karat },
        ratesInput: rates,
        ratesProcessed: { goldRate24k, palladiumRate, platinumRate },
        derivedCosts: { metalCost: validMetalCost, wastageCost: validWastageCost },
        calculatedTotalPrice: totalPrice,
        finalTotalPriceReturned: finalTotalPrice
    });
    return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, totalPrice: 0 };
  }

  return {
    metalCost: validMetalCost,
    wastageCost: validWastageCost,
    makingCharges: makingCharges,
    diamondCharges: diamondChargesValue,
    stoneCharges: stoneChargesValue,
    miscCharges: miscChargesValue,
    totalPrice: finalTotalPrice,
  };
}

// --- Type Definitions ---
export type MetalType = 'gold' | 'palladium' | 'platinum';
export type KaratValue = '18k' | '21k' | '22k' | '24k';

export interface Settings {
  goldRatePerGram: number;
  palladiumRatePerGram: number;
  platinumRatePerGram: number;
  shopName: string;
  shopAddress: string;
  shopContact: string;
  shopLogoUrl?: string;
  lastInvoiceNumber: number;
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
  makingCharges: number;
  diamondChargesIfAny: number;
  stoneChargesIfAny: number;
  miscChargesIfAny: number;
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
  shopLogoUrl: "https://placehold.co/200x80.png?text=Taheri", lastInvoiceNumber: 0,
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

  // Loading states
  isSettingsLoading: boolean;
  isProductsLoading: boolean;
  isCustomersLoading: boolean;
  isKarigarsLoading: boolean;
  isInvoicesLoading: boolean;
  isInitialDataLoadedFromFirestore: boolean; // True after all initial loads complete

  // Zustand specific hydration state
  _zustandHasRehydrated: boolean;
  setZustandHasRehydrated: (hydrated: boolean) => void;

  // Actions
  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;

  addCategory: (title: string) => void; // Local category management
  updateCategory: (id: string, title: string) => void;
  deleteCategory: (id: string) => void;

  loadProducts: () => Promise<void>;
  addProduct: (productData: ProductDataForAdd) => Promise<Product | null>;
  updateProduct: (sku: string, updatedProductData: Partial<Omit<Product, 'sku' | 'name'>>) => Promise<void>;
  deleteProduct: (sku: string) => Promise<void>;
  setProductQrCode: (sku: string, qrCodeDataUrl: string) => Promise<void>; // Will update Firestore then local

  loadCustomers: () => Promise<void>;
  addCustomer: (customerData: Omit<Customer, 'id'>) => Promise<Customer | null>;
  updateCustomer: (id: string, updatedCustomerData: Partial<Omit<Customer, 'id'>>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;

  loadKarigars: () => Promise<void>;
  addKarigar: (karigarData: Omit<Karigar, 'id'>) => Promise<Karigar | null>;
  updateKarigar: (id: string, updatedKarigarData: Partial<Omit<Karigar, 'id'>>) => Promise<void>;
  deleteKarigar: (id: string) => Promise<void>;

  addToCart: (sku: string, quantity?: number) => void;
  removeFromCart: (sku: string) => void;
  updateCartQuantity: (sku: string, quantity: number) => void;
  clearCart: () => void;

  loadGeneratedInvoices: () => Promise<void>;
  generateInvoice: (
    customerId: string | undefined,
    invoiceGoldRate24k: number,
    discountAmount: number
  ) => Promise<Invoice | null>;
  
  fetchAllInitialData: () => Promise<void>;
}

export type EnrichedCartItem = Product & {
  quantity: number;
  totalPrice: number;
  lineItemTotal: number;
};

const ssrDummyStorage: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, };

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get) => ({
      _zustandHasRehydrated: false,
      setZustandHasRehydrated: (hydrated) => {
        set((state) => { state._zustandHasRehydrated = hydrated; });
      },
      settings: initialSettingsData, // Fallback, will be overwritten by loadSettings
      categories: staticCategories, // Categories remain local for now
      products: [],
      customers: [],
      cart: [], // This will be persisted
      generatedInvoices: [],
      karigars: [],

      isSettingsLoading: true,
      isProductsLoading: true,
      isCustomersLoading: true,
      isKarigarsLoading: true,
      isInvoicesLoading: true,
      isInitialDataLoadedFromFirestore: false,

      fetchAllInitialData: async () => {
        console.log("[GemsTrack Store] Fetching all initial data from Firestore...");
        set({
          isSettingsLoading: true, isProductsLoading: true, isCustomersLoading: true,
          isKarigarsLoading: true, isInvoicesLoading: true, isInitialDataLoadedFromFirestore: false
        });
        try {
          await Promise.all([
            get().loadSettings(),
            get().loadProducts(),
            get().loadCustomers(),
            get().loadKarigars(),
            get().loadGeneratedInvoices(),
          ]);
          set({ isInitialDataLoadedFromFirestore: true });
          console.log("[GemsTrack Store] All initial data fetched successfully.");
        } catch (error) {
          console.error("[GemsTrack Store] Error fetching all initial data:", error);
          // Individual loading flags will remain false if their specific load failed
        } finally {
            // Ensure all individual loading flags are false regardless of overall success/failure
            set(state => {
                state.isSettingsLoading = false;
                state.isProductsLoading = false;
                state.isCustomersLoading = false;
                state.isKarigarsLoading = false;
                state.isInvoicesLoading = false;
            });
        }
      },

      loadSettings: async () => {
        set({ isSettingsLoading: true });
        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          const docSnap = await getDoc(settingsDocRef);
          if (docSnap.exists()) {
            const firestoreSettings = docSnap.data() as Settings;
            set((state) => { state.settings = { ...initialSettingsData, ...firestoreSettings }; });
          } else {
            await setDoc(settingsDocRef, initialSettingsData);
            set((state) => { state.settings = initialSettingsData; });
          }
        } catch (error) {
          console.error("Error loading settings from Firestore:", error);
          set((state) => { state.settings = initialSettingsData; }); // Fallback
        } finally {
          set({ isSettingsLoading: false });
        }
      },
      updateSettings: async (newSettings) => {
        const currentSettings = get().settings;
        const updatedSettings = { ...currentSettings, ...newSettings };
        set((state) => { state.settings = updatedSettings; });
        try {
          const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
          await setDoc(settingsDocRef, updatedSettings, { merge: true });
        } catch (error) {
          console.error("Error updating settings in Firestore:", error);
          set((state) => { state.settings = currentSettings; }); // Revert on error
          throw error;
        }
      },

      addCategory: (title) => set((state) => {
          const newCategory: Category = { id: `cat-${Date.now()}`, title };
          state.categories.push(newCategory);
      }),
      updateCategory: (id, title) => set((state) => {
          const category = state.categories.find((c) => c.id === id);
          if (category) category.title = title;
      }),
      deleteCategory: (id) => set((state) => {
          state.categories = state.categories.filter((c) => c.id !== id);
          // Optionally update products linked to this category if needed
      }),

      loadProducts: async () => {
        set({ isProductsLoading: true });
        try {
          const q = query(collection(db, FIRESTORE_COLLECTIONS.PRODUCTS), orderBy("sku"));
          const snapshot = await getDocs(q);
          const productList = snapshot.docs.map(doc => doc.data() as Product);
          set({ products: productList });
        } catch (error) {
          console.error("Error loading products:", error);
        } finally {
          set({ isProductsLoading: false });
        }
      },
      addProduct: async (productData) => {
        const { categories, products } = get();
        const category = categories.find(c => c.id === productData.categoryId);
        if (!category) {
          console.error(`Category with id ${productData.categoryId} not found.`);
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

        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, newProduct.sku), newProduct);
          set(state => { state.products.push(newProduct); state.products.sort((a,b) => a.sku.localeCompare(b.sku)); });
          return newProduct;
        } catch (error) {
          console.error("Error adding product to Firestore:", error);
          return null;
        }
      },
      updateProduct: async (sku, updatedProductData) => {
        const productRef = doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku);
        try {
            const currentProduct = get().products.find(p => p.sku === sku);
            if (!currentProduct) throw new Error("Product not found for update");

            // Merge carefully to handle undefined fields from partial updates
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
                 // If metal type changed away from gold, ensure karat is removed or undefined
                 if (updatedProductData.metalType && updatedProductData.metalType !== 'gold' && 'karat' in finalUpdatedFields) {
                    finalUpdatedFields.karat = undefined;
                 } else if (updatedProductData.metalType === 'gold' && !finalUpdatedFields.karat) {
                     // If metal type is gold and karat isn't being set, preserve current or default
                     if (!('karat' in updatedProductData) && !currentProduct.karat) {
                         finalUpdatedFields.karat = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
                    }
                 }
            }
            // Remove 'sku' and 'name' from the update payload to Firestore if they were accidentally included
            const { sku: _s, name: _n, ...payloadToFirestore } = finalUpdatedFields;


          await setDoc(productRef, payloadToFirestore, { merge: true });
          set(state => {
            const index = state.products.findIndex(p => p.sku === sku);
            if (index !== -1) state.products[index] = { ...state.products[index], ...finalUpdatedFields };
          });
        } catch (error) {
          console.error("Error updating product in Firestore:", error);
        }
      },
      deleteProduct: async (sku) => {
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku));
          set(state => {
            state.products = state.products.filter(p => p.sku !== sku);
            state.cart = state.cart.filter(item => item.sku !== sku);
          });
        } catch (error) {
          console.error("Error deleting product from Firestore:", error);
        }
      },
       setProductQrCode: async (sku, qrCodeDataUrl) => {
        try {
            await setDoc(doc(db, FIRESTORE_COLLECTIONS.PRODUCTS, sku), { qrCodeDataUrl }, { merge: true });
            set(state => {
                const product = state.products.find(p => p.sku === sku);
                if (product) product.qrCodeDataUrl = qrCodeDataUrl;
            });
        } catch (error) {
            console.error("Error saving QR code URL to Firestore:", error);
        }
      },

      loadCustomers: async () => {
        set({ isCustomersLoading: true });
        try {
          const q = query(collection(db, FIRESTORE_COLLECTIONS.CUSTOMERS), orderBy("name"));
          const snapshot = await getDocs(q);
          const customerList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Customer));
          set({ customers: customerList });
        } catch (error) {
          console.error("Error loading customers:", error);
        } finally {
          set({ isCustomersLoading: false });
        }
      },
      addCustomer: async (customerData) => {
        const newCustomerId = `cust-${Date.now()}`;
        const newCustomer: Customer = { ...customerData, id: newCustomerId };
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, newCustomerId), newCustomer);
          set(state => { state.customers.push(newCustomer); state.customers.sort((a,b) => a.name.localeCompare(b.name)); });
          return newCustomer;
        } catch (error) {
          console.error("Error adding customer to Firestore:", error);
          return null;
        }
      },
      updateCustomer: async (id, updatedCustomerData) => {
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id), updatedCustomerData, { merge: true });
          set(state => {
            const index = state.customers.findIndex(c => c.id === id);
            if (index !== -1) state.customers[index] = { ...state.customers[index], ...updatedCustomerData };
          });
        } catch (error) {
          console.error("Error updating customer in Firestore:", error);
        }
      },
      deleteCustomer: async (id) => {
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.CUSTOMERS, id));
          set(state => { state.customers = state.customers.filter(c => c.id !== id); });
        } catch (error) {
          console.error("Error deleting customer from Firestore:", error);
        }
      },

      loadKarigars: async () => {
        set({ isKarigarsLoading: true });
        try {
          const q = query(collection(db, FIRESTORE_COLLECTIONS.KARIGARS), orderBy("name"));
          const snapshot = await getDocs(q);
          const karigarList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Karigar));
          set({ karigars: karigarList });
        } catch (error) {
          console.error("Error loading karigars:", error);
        } finally {
          set({ isKarigarsLoading: false });
        }
      },
      addKarigar: async (karigarData) => {
        const newKarigarId = `karigar-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        const newKarigar: Karigar = { ...karigarData, id: newKarigarId };
        try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, newKarigarId), newKarigar);
          set(state => { state.karigars.push(newKarigar); state.karigars.sort((a,b) => a.name.localeCompare(b.name));});
          return newKarigar;
        } catch (error) {
          console.error("Error adding karigar to Firestore:", error);
          return null;
        }
      },
      updateKarigar: async (id, updatedKarigarData) => {
         try {
          await setDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id), updatedKarigarData, { merge: true });
          set(state => {
            const index = state.karigars.findIndex(k => k.id === id);
            if (index !== -1) state.karigars[index] = { ...state.karigars[index], ...updatedKarigarData };
          });
        } catch (error) {
          console.error("Error updating karigar in Firestore:", error);
        }
      },
      deleteKarigar: async (id) => {
        try {
          await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.KARIGARS, id));
          set(state => { state.karigars = state.karigars.filter(k => k.id !== id); });
        } catch (error) {
          console.error("Error deleting karigar from Firestore:", error);
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

      loadGeneratedInvoices: async () => {
        set({ isInvoicesLoading: true });
        try {
          const q = query(collection(db, FIRESTORE_COLLECTIONS.INVOICES), orderBy("createdAt", "desc"));
          const snapshot = await getDocs(q);
          const invoiceList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice));
          set({ generatedInvoices: invoiceList });
        } catch (error) {
          console.error("Error loading invoices:", error);
        } finally {
          set({ isInvoicesLoading: false });
        }
      },
      generateInvoice: async (customerId, invoiceGoldRate24k, discountAmount) => {
        const { products, cart, customers, settings, generatedInvoices } = get();
        if (cart.length === 0) return null;

        let validInvoiceGoldRate24k = Number(invoiceGoldRate24k);
        if (isNaN(validInvoiceGoldRate24k) || validInvoiceGoldRate24k <= 0) {
            if (cart.some(ci => products.find(p => p.sku === ci.sku)?.metalType === 'gold')) {
                if (settings.goldRatePerGram <= 0) return null;
                validInvoiceGoldRate24k = settings.goldRatePerGram;
            } else {
                validInvoiceGoldRate24k = 0;
            }
        }

        const ratesForInvoice = {
            goldRatePerGram24k: validInvoiceGoldRate24k,
            palladiumRatePerGram: Number(settings.palladiumRatePerGram) || 0,
            platinumRatePerGram: Number(settings.platinumRatePerGram) || 0,
        };

        if (isNaN(ratesForInvoice.goldRatePerGram24k) || isNaN(ratesForInvoice.palladiumRatePerGram) || isNaN(ratesForInvoice.platinumRatePerGram)) {
            return null;
        }

        let subtotal = 0;
        const invoiceItems: InvoiceItem[] = [];

        for (const cartItem of cart) {
            const product = products.find(p => p.sku === cartItem.sku);
            if (!product) continue;
            const productForCostCalc = {
                name: product.name, categoryId: product.categoryId, metalType: product.metalType,
                karat: product.metalType === 'gold' ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL) : undefined,
                metalWeightG: product.metalWeightG, wastagePercentage: product.wastagePercentage, makingCharges: product.makingCharges,
                hasDiamonds: product.hasDiamonds, diamondCharges: product.diamondCharges, stoneCharges: product.stoneCharges, miscCharges: product.miscCharges,
            };
            const costs = _calculateProductCostsInternal(productForCostCalc, ratesForInvoice);
            if (isNaN(costs.totalPrice)) continue;
            const unitPrice = costs.totalPrice;
            const itemTotal = unitPrice * cartItem.quantity;
            subtotal += itemTotal;
            invoiceItems.push({
                sku: product.sku, name: product.name, categoryId: product.categoryId, metalType: product.metalType, karat: productForCostCalc.karat, metalWeightG: product.metalWeightG, quantity: cartItem.quantity, unitPrice, itemTotal,
                metalCost: costs.metalCost, wastageCost: costs.wastageCost, makingCharges: costs.makingCharges, diamondChargesIfAny: costs.diamondCharges, stoneChargesIfAny: costs.stoneCharges, miscChargesIfAny: costs.miscCharges,
            });
        }

        if (invoiceItems.length === 0 && cart.length > 0) return null;

        const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
        const grandTotal = subtotal - calculatedDiscountAmount;
        const customer = customers.find(c => c.id === customerId);
        
        const currentSettings = get().settings;
        const nextInvoiceNumber = (currentSettings.lastInvoiceNumber || 0) + 1;
        const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
        
        const newInvoice: Invoice = {
            id: invoiceId, customerId, customerName: customer?.name, items: invoiceItems, subtotal: Number(subtotal) || 0,
            discountAmount: calculatedDiscountAmount, grandTotal: Number(grandTotal) || 0, createdAt: new Date().toISOString(),
            goldRateApplied: cart.some(ci => products.find(p => p.sku === ci.sku)?.metalType === 'gold') ? ratesForInvoice.goldRatePerGram24k : undefined,
            palladiumRateApplied: cart.some(ci => products.find(p => p.sku === ci.sku)?.metalType === 'palladium') ? ratesForInvoice.palladiumRatePerGram : undefined,
            platinumRateApplied: cart.some(ci => products.find(p => p.sku === ci.sku)?.metalType === 'platinum') ? ratesForInvoice.platinumRatePerGram : undefined,
        };

        try {
            const batch = writeBatch(db);
            const invoiceDocRef = doc(db, FIRESTORE_COLLECTIONS.INVOICES, invoiceId);
            batch.set(invoiceDocRef, newInvoice);

            const settingsDocRef = doc(db, FIRESTORE_COLLECTIONS.SETTINGS, GLOBAL_SETTINGS_DOC_ID);
            batch.update(settingsDocRef, { lastInvoiceNumber: nextInvoiceNumber });
            
            await batch.commit();

            set(state => {
                state.generatedInvoices.unshift(newInvoice); // Add to start for descending order
                state.settings.lastInvoiceNumber = nextInvoiceNumber;
            });
            return newInvoice;
        } catch (error) {
            console.error("Error generating invoice and saving to Firestore:", error);
            return null;
        }
      },
    })),
    {
      name: 'gemstrack-pos-storage',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') return ssrDummyStorage;
        return localStorage;
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('[GemsTrack Store] Persist: REHYDRATION_ERROR:', error);
        else if (state) console.log('[GemsTrack Store] Persist: REHYDRATION_SUCCESS_FROM_STORAGE.');
        else console.log('[GemsTrack Store] Persist: NO_PERSISTED_STATE_USING_INITIAL.');
        
        queueMicrotask(() => {
          useAppStore.getState().setZustandHasRehydrated(true);
        });
      },
      partialize: (state) => ({
        cart: state.cart,
        _zustandHasRehydrated: state._zustandHasRehydrated,
      }),
      version: 8, // Incremented due to Firestore migration for most data
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
import React, { useEffect, useState } from 'react';

export const useZustandRehydrated = () => {
  const [isHydrated, setIsHydrated] = useState(useAppStore.getState()._zustandHasRehydrated);
  useEffect(() => {
    const storeAlreadyHydrated = useAppStore.getState()._zustandHasRehydrated;
    if (storeAlreadyHydrated) {
      setIsHydrated(true);
      return; 
    }
    const unsubscribe = useAppStore.subscribe(
      (currentState) => currentState._zustandHasRehydrated,
      (newHydratedValue) => {
        if (newHydratedValue) {
          setIsHydrated(true);
          unsubscribe(); 
        }
      }
    );
    return () => unsubscribe();
  }, []); 
  return isHydrated;
};

export const useAppReady = () => {
    const isFirestoreDataLoaded = useAppStore(state => state.isInitialDataLoadedFromFirestore);
    const isZustandRehydrated = useZustandRehydrated();
    return isZustandRehydrated && isFirestoreDataLoaded;
}

// --- SELECTOR DEFINITIONS ---
export const selectCartDetails = (state: AppState): EnrichedCartItem[] => {
  if (!state.cart || !Array.isArray(state.cart)) {
    console.warn("[GemsTrack] selectCartDetails: state.cart is not an array.", state.cart);
    return [];
  }
  if (!state.products || !Array.isArray(state.products)) {
    console.warn("[GemsTrack] selectCartDetails: state.products is not an array.", state.products);
    return [];
  }
  if (!state.settings) {
    console.warn("[GemsTrack] selectCartDetails: state.settings is missing.");
    return [];
  }

  return state.cart
    .map((cartItem) => {
      const product = state.products.find((p) => p.sku === cartItem.sku);
      if (!product) {
        console.warn(`[GemsTrack] Product with SKU ${cartItem.sku} not found in cart for selectCartDetails.`);
        return null; 
      }
      const ratesForCalc = {
        goldRatePerGram24k: state.settings.goldRatePerGram,
        palladiumRatePerGram: state.settings.palladiumRatePerGram,
        platinumRatePerGram: state.settings.platinumRatePerGram,
      };
      const costs = calculateProductCosts(product, ratesForCalc);
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
    console.error("[GemsTrack] selectCartSubtotal: selectCartDetails did not return an array.");
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

    