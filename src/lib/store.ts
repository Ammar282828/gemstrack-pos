
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { formatISO, subDays } from 'date-fns';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface Product {
  sku: string;
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
  id: string;
  customerId?: string;
  customerName?: string;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  createdAt: string;
  goldRateApplied?: number;
  palladiumRateApplied?: number;
  platinumRateApplied?: number;
}

export interface Karigar {
  id: string;
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

// --- Initial Data Definitions (Order matters for IIFE) ---
const initialSettings: Settings = {
  goldRatePerGram: 20000,
  palladiumRatePerGram: 22000,
  platinumRatePerGram: 25000,
  shopName: "Taheri",
  shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "https://placehold.co/200x80.png?text=Taheri",
  lastInvoiceNumber: 5,
};

const initialCategories: Category[] = [
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

const initialCustomers: Customer[] = [
  { id: 'cust-001', name: 'Aisha Khan', phone: '0300-1234567', email: 'aisha.khan@example.com', address: '123 Gulberg, Lahore' },
  { id: 'cust-002', name: 'Bilal Ahmed', phone: '0321-9876543', email: 'bilal.ahmed@example.com', address: '456 DHA, Karachi' },
  { id: 'cust-003', name: 'Fatima Ali', phone: '0333-1122334', email: 'fatima.ali@example.com', address: '789 F-8, Islamabad' },
  { id: 'cust-004', name: 'Sana Mirza', phone: '0345-5566778', email: 'sana.mirza@example.com', address: 'A-1 Cantt, Rawalpindi' },
];

const initialProducts: Product[] = [
  { sku: "RIN-000001", name: "Rings - RIN-000001", categoryId: "cat001", metalType: 'gold', karat: '21k', metalWeightG: 5.2, wastagePercentage: 25, makingCharges: 4160, hasDiamonds: true, diamondCharges: 25000, stoneCharges: 0, miscCharges: 500, imageUrl: "https://placehold.co/300x300.png?text=RIN-001" },
  { sku: "SNX-000001", name: "Stone Necklace Sets without Bracelets - SNX-000001", categoryId: "cat013", metalType: 'gold', karat: '22k', metalWeightG: 12.5, wastagePercentage: 10, makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 112500, miscCharges: 1500, imageUrl: "https://placehold.co/300x300.png?text=SNX-001" },
  { sku: "BRC-000001", name: "Bracelets - BRC-000001", categoryId: "cat005", metalType: 'palladium', metalWeightG: 8.0, wastagePercentage: 10, makingCharges: 7200, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 700, imageUrl: "https://placehold.co/300x300.png?text=BRC-PD" },
  { sku: "BND-000001", name: "Bands - BND-000001", categoryId: "cat009", metalType: 'platinum', metalWeightG: 7.5, wastagePercentage: 25, makingCharges: 6000, hasDiamonds: true, diamondCharges: 15000, stoneCharges: 0, miscCharges: 250, imageUrl: "https://placehold.co/300x300.png?text=BND-PT" },
  { sku: "GCN-000001", name: "Gold Coins - GCN-000001", categoryId: "cat017", metalType: 'gold', karat: '24k', metalWeightG: 11.6638, wastagePercentage: 0, makingCharges: 0, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: "https://placehold.co/300x300.png?text=GCN-1Tola" },
  { sku: "GCN-000002", name: "Gold Coins - GCN-000002", categoryId: "cat017", metalType: 'gold', karat: '18k', metalWeightG: 1.0, wastagePercentage: 0, makingCharges: 0, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: "https://placehold.co/300x300.png?text=GCN-1g18k" },
];

const initialKarigars: Karigar[] = [
    { id: 'karigar-001', name: 'Ustad Karim Baksh', contact: '0301-1112233', notes: 'Specializes in intricate gold work.'},
    { id: 'karigar-002', name: 'Ali Bhai', contact: '0302-4445566', notes: 'Good with modern designs and platinum.'},
];

// --- Helper function for initialGeneratedInvoices (IIFE) ---
function _createInitialInvoices(): Invoice[] {
    const invoices: Invoice[] = [];
    const ratesForCalc = {
        goldRatePerGram24k: initialSettings.goldRatePerGram,
        palladiumRatePerGram: initialSettings.palladiumRatePerGram,
        platinumRatePerGram: initialSettings.platinumRatePerGram,
    };

    const product1_inv1 = initialProducts.find(p => p.sku === "RIN-000001");
    if (product1_inv1) {
        const costs1_inv1 = _calculateProductCostsInternal(product1_inv1, ratesForCalc);
        const items_inv1: InvoiceItem[] = [{
            sku: product1_inv1.sku, name: product1_inv1.name, categoryId: product1_inv1.categoryId, metalType: product1_inv1.metalType, karat: product1_inv1.karat, metalWeightG: product1_inv1.metalWeightG, quantity: 1, unitPrice: costs1_inv1.totalPrice, itemTotal: costs1_inv1.totalPrice * 1,
            metalCost: costs1_inv1.metalCost, wastageCost: costs1_inv1.wastageCost, makingCharges: costs1_inv1.makingCharges, diamondChargesIfAny: costs1_inv1.diamondCharges, stoneChargesIfAny: costs1_inv1.stoneCharges, miscChargesIfAny: costs1_inv1.miscCharges,
        }];
        const subtotal_inv1 = items_inv1.reduce((sum, item) => sum + item.itemTotal, 0);
        invoices.push({
            id: "INV-000001", customerId: "cust-001", customerName: "Aisha Khan", items: items_inv1, subtotal: subtotal_inv1, discountAmount: 1000, grandTotal: subtotal_inv1 - 1000, createdAt: formatISO(subDays(new Date(), 10)),
            goldRateApplied: ratesForCalc.goldRatePerGram24k,
        });
    }
    // ... more initial invoices ...
    return invoices;
}
const initialGeneratedInvoices = _createInitialInvoices();


// --- Store State and Actions ---
type ProductDataForAdd = Omit<Product, 'sku' | 'qrCodeDataUrl' | 'name'>;
type ProductDataForUpdate = Partial<Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>>;

export interface CartItem {
  sku: string;
  quantity: number;
}

export interface AppState {
  settings: Settings;
  categories: Category[];
  products: Product[];
  customers: Customer[];
  cart: CartItem[];
  generatedInvoices: Invoice[];
  karigars: Karigar[];

  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;

  addCategory: (title: string) => void;
  updateCategory: (id: string, title: string) => void;
  deleteCategory: (id: string) => void;

  addProduct: (productData: ProductDataForAdd) => Product | null;
  updateProduct: (sku: string, updatedProduct: ProductDataForUpdate) => void;
  deleteProduct: (sku: string) => void;
  setProductQrCode: (sku: string, qrCodeDataUrl: string) => void;

  addCustomer: (customer: Omit<Customer, 'id'>) => void;
  updateCustomer: (id: string, updatedCustomer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  addKarigar: (karigarData: Omit<Karigar, 'id'>) => Karigar;
  updateKarigar: (id: string, updatedKarigarData: Partial<Karigar>) => void;
  deleteKarigar: (id: string) => void;

  addToCart: (sku: string, quantity?: number) => void;
  removeFromCart: (sku: string) => void;
  updateCartQuantity: (sku: string, quantity: number) => void;
  clearCart: () => void;

  generateInvoice: (
    customerId: string | undefined,
    invoiceGoldRate24k: number,
    discountAmount: number
  ) => Invoice | null;
  clearGeneratedInvoices: () => void;

  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

// NEW: Define the structure of the enriched cart item
export type EnrichedCartItem = Product & {
  quantity: number;
  totalPrice: number; // This is the unit price calculated with current store rates
  lineItemTotal: number;
};

const ssrDummyStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const SETTINGS_DOC_PATH = "app_settings/global";

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (hydrated) => {
        console.log(`[GemsTrack] Store: setHasHydrated ACTION called with: ${hydrated}. Current _hasHydrated before: ${get()._hasHydrated}`);
        set((state) => { state._hasHydrated = hydrated; });
        console.log(`[GemsTrack] Store: _hasHydrated set. Current _hasHydrated after: ${get()._hasHydrated}`);
      },
      settings: initialSettings, // Initial fallback
      categories: initialCategories,
      products: initialProducts,
      customers: initialCustomers,
      cart: [],
      generatedInvoices: initialGeneratedInvoices,
      karigars: initialKarigars,

      loadSettings: async () => {
        console.log("[GemsTrack] Store: Attempting to load settings from Firestore.");
        try {
          const settingsDocRef = doc(db, SETTINGS_DOC_PATH);
          const docSnap = await getDoc(settingsDocRef);
          if (docSnap.exists()) {
            const firestoreSettings = docSnap.data() as Settings;
            set((state) => {
              state.settings = { ...initialSettings, ...firestoreSettings }; // Merge with defaults to ensure all keys exist
            });
            console.log("[GemsTrack] Store: Settings loaded from Firestore.", get().settings);
          } else {
            console.log("[GemsTrack] Store: No settings document found in Firestore. Using initial settings and saving them.");
            set((state) => { state.settings = initialSettings; });
            await setDoc(settingsDocRef, initialSettings);
            console.log("[GemsTrack] Store: Initial settings saved to Firestore.");
          }
        } catch (error) {
          console.error("[GemsTrack] Store: Error loading settings from Firestore:", error);
          // Fallback to initialSettings if Firestore load fails
          set((state) => { state.settings = initialSettings; });
        }
      },
      updateSettings: async (newSettings) => {
        let updatedSettingsGlobal: Settings | null = null;
        set((state) => {
          state.settings = { ...state.settings, ...newSettings };
          updatedSettingsGlobal = state.settings; // Capture for Firestore
        }, false, '[GemsTrack] Settings: updateSettings (local)');
        
        if (updatedSettingsGlobal) {
          try {
            const settingsDocRef = doc(db, SETTINGS_DOC_PATH);
            await setDoc(settingsDocRef, updatedSettingsGlobal, { merge: true });
            console.log("[GemsTrack] Store: Settings updated in Firestore.");
          } catch (error) {
            console.error("[GemsTrack] Store: Error updating settings in Firestore:", error);
          }
        }
      },

      addCategory: (title) =>
        set((state) => {
          const newCategory: Category = { id: `cat-${Date.now()}`, title };
          state.categories.push(newCategory);
        }, false, '[GemsTrack] Categories: addCategory'),
      updateCategory: (id, title) =>
        set((state) => {
          const category = state.categories.find((c) => c.id === id);
          if (category) { category.title = title; }
        }, false, '[GemsTrack] Categories: updateCategory'),
      deleteCategory: (id) =>
        set((state) => {
          state.categories = state.categories.filter((c) => c.id !== id);
          state.products = state.products.map(p => p.categoryId === id ? {...p, categoryId: ''} : p);
        }, false, '[GemsTrack] Categories: deleteCategory'),

      addProduct: (productData) => {
        let newProduct: Product | null = null;
        set((state) => {
          const category = state.categories.find(c => c.id === productData.categoryId);
          if (!category) {
            console.error(`[GemsTrack] Products: Category with id ${productData.categoryId} not found. Product not added.`);
            return;
          }
          const prefix = CATEGORY_SKU_PREFIXES[productData.categoryId] || "XXX";
          let maxNum = 0;
          state.products.forEach(p => {
            if (p.sku.startsWith(prefix + "-")) {
              const numPart = parseInt(p.sku.substring(prefix.length + 1), 10);
              if (!isNaN(numPart) && numPart > maxNum) { maxNum = numPart; }
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
          newProduct = { ...finalProductData, name: autoGeneratedName, sku: generatedSku };
          state.products.push(newProduct);
        }, false, '[GemsTrack] Products: addProduct');
        return newProduct;
      },
      updateProduct: (sku, updatedFields) =>
        set((state) => {
          const productIndex = state.products.findIndex((p) => p.sku === sku);
          if (productIndex !== -1) {
            const currentProduct = state.products[productIndex];
            const isActualGoldCoin = (updatedFields.categoryId || currentProduct.categoryId) === GOLD_COIN_CATEGORY_ID_INTERNAL && 
                                     (updatedFields.metalType || currentProduct.metalType) === 'gold';
            let finalUpdatedFields = { ...updatedFields };
            if (isActualGoldCoin) {
                finalUpdatedFields = {
                    ...finalUpdatedFields,
                    hasDiamonds: false, diamondCharges: 0, wastagePercentage: 0,
                    makingCharges: 0, stoneCharges: 0, miscCharges: 0,
                };
            } else {
                 if (updatedFields.hasDiamonds === false) { finalUpdatedFields.diamondCharges = 0; }
                 if (updatedFields.metalType && updatedFields.metalType !== 'gold' && 'karat' in finalUpdatedFields) {
                    delete finalUpdatedFields.karat;
                 } else if (updatedFields.metalType === 'gold' && !finalUpdatedFields.karat) {
                     if (!('karat' in updatedFields) && !currentProduct.karat) {
                         finalUpdatedFields.karat = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
                    }
                 }
            }
            state.products[productIndex] = { ...currentProduct, ...finalUpdatedFields };
          }
        }, false, '[GemsTrack] Products: updateProduct'),
      deleteProduct: (sku) =>
        set((state) => {
          state.products = state.products.filter((p) => p.sku !== sku);
          state.cart = state.cart.filter(item => item.sku !== sku);
        }, false, '[GemsTrack] Products: deleteProduct'),
      setProductQrCode: (sku, qrCodeDataUrl) =>
        set((state) => {
          const product = state.products.find((p) => p.sku === sku);
          if (product) { product.qrCodeDataUrl = qrCodeDataUrl; }
        }, false, '[GemsTrack] Products: setProductQrCode'),

      addCustomer: (customerData) =>
        set((state) => {
          const newCustomer: Customer = { ...customerData, id: `cust-${Date.now()}` };
          state.customers.push(newCustomer);
        }, false, '[GemsTrack] Customers: addCustomer'),
      updateCustomer: (id, updatedFields) =>
        set((state) => {
          const customerIndex = state.customers.findIndex((c) => c.id === id);
          if (customerIndex !== -1) { state.customers[customerIndex] = { ...state.customers[customerIndex], ...updatedFields }; }
        }, false, '[GemsTrack] Customers: updateCustomer'),
      deleteCustomer: (id) =>
        set((state) => {
          state.customers = state.customers.filter((c) => c.id !== id);
        }, false, '[GemsTrack] Customers: deleteCustomer'),

      addKarigar: (karigarData) => {
        let newKarigar: Karigar | null = null;
        set((state) => {
            newKarigar = { ...karigarData, id: `karigar-${Date.now()}-${Math.random().toString(36).substring(2,7)}` };
            state.karigars.push(newKarigar);
        }, false, '[GemsTrack] Karigars: addKarigar');
        return newKarigar!;
      },
      updateKarigar: (id, updatedKarigarData) => {
        set((state) => {
            const karigarIndex = state.karigars.findIndex(k => k.id === id);
            if (karigarIndex !== -1) { state.karigars[karigarIndex] = { ...state.karigars[karigarIndex], ...updatedKarigarData }; }
        }, false, '[GemsTrack] Karigars: updateKarigar');
      },
      deleteKarigar: (id) => {
        set((state) => { state.karigars = state.karigars.filter(k => k.id !== id); }, false, '[GemsTrack] Karigars: deleteKarigar');
      },

      addToCart: (sku, quantity = 1) =>
        set((state) => {
          const existingItem = state.cart.find((item) => item.sku === sku);
          if (existingItem) { existingItem.quantity += quantity; } else { state.cart.push({ sku, quantity }); }
        }, false, '[GemsTrack] Cart: addToCart'),
      removeFromCart: (sku) =>
        set((state) => { state.cart = state.cart.filter((item) => item.sku !== sku); }, false, '[GemsTrack] Cart: removeFromCart'),
      updateCartQuantity: (sku, quantity) =>
        set((state) => {
          const item = state.cart.find((i) => i.sku === sku);
          if (item) {
            if (quantity <= 0) { state.cart = state.cart.filter((i) => i.sku !== sku); } else { item.quantity = quantity; }
          }
        }, false, '[GemsTrack] Cart: updateCartQuantity'),
      clearCart: () =>
        set((state) => { state.cart = []; }, false, '[GemsTrack] Cart: clearCart'),

      generateInvoice: ( customerId: string | undefined, invoiceGoldRate24k: number, discountAmount: number ) => {
        let newInvoice: Invoice | null = null;
        set(state => {
            const { products, cart, customers, settings } = state;
            if (cart.length === 0) { newInvoice = null; return; }
            let validInvoiceGoldRate24k = Number(invoiceGoldRate24k);
            if (isNaN(validInvoiceGoldRate24k) || validInvoiceGoldRate24k <=0 ) {
                 if (cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'gold')) {
                     if(settings.goldRatePerGram <= 0) { newInvoice = null; return; }
                     validInvoiceGoldRate24k = settings.goldRatePerGram;
                 } else { validInvoiceGoldRate24k = 0; }
            }
            const ratesForInvoice = { goldRatePerGram24k: validInvoiceGoldRate24k, palladiumRatePerGram: Number(settings.palladiumRatePerGram) || 0, platinumRatePerGram: Number(settings.platinumRatePerGram) || 0 };
            if (isNaN(ratesForInvoice.goldRatePerGram24k) || isNaN(ratesForInvoice.palladiumRatePerGram) || isNaN(ratesForInvoice.platinumRatePerGram)) { newInvoice = null; return; }
            let subtotal = 0;
            const invoiceItems: InvoiceItem[] = [];
            for (const cartItem of cart) {
              const product = products.find(p => p.sku === cartItem.sku);
              if (!product) { continue; }
              const productForCostCalc = {
                name: product.name, categoryId: product.categoryId, metalType: product.metalType,
                karat: product.metalType === 'gold' ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL) : undefined,
                metalWeightG: product.metalWeightG, wastagePercentage: product.wastagePercentage, makingCharges: product.makingCharges,
                hasDiamonds: product.hasDiamonds, diamondCharges: product.diamondCharges, stoneCharges: product.stoneCharges, miscCharges: product.miscCharges,
              };
              const costs = _calculateProductCostsInternal(productForCostCalc, ratesForInvoice);
              if (isNaN(costs.totalPrice)) { continue; }
              const unitPrice = costs.totalPrice;
              const itemTotal = unitPrice * cartItem.quantity;
              subtotal += itemTotal;
              invoiceItems.push({
                sku: product.sku, name: product.name, categoryId: product.categoryId, metalType: product.metalType, karat: productForCostCalc.karat, metalWeightG: product.metalWeightG, quantity: cartItem.quantity, unitPrice, itemTotal,
                metalCost: costs.metalCost, wastageCost: costs.wastageCost, makingCharges: costs.makingCharges, diamondChargesIfAny: costs.diamondCharges, stoneChargesIfAny: costs.stoneCharges, miscChargesIfAny: costs.miscCharges,
              });
            }
            if (invoiceItems.length === 0 && cart.length > 0) { newInvoice = null; return; }
            const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
            const grandTotal = subtotal - calculatedDiscountAmount;
            const customer = customers.find(c => c.id === customerId);
            const nextInvoiceNumber = (state.settings.lastInvoiceNumber || 0) + 1;
            const invoiceId = `INV-${nextInvoiceNumber.toString().padStart(6, '0')}`;
            state.settings.lastInvoiceNumber = nextInvoiceNumber;
            const generated: Invoice = {
              id: invoiceId, customerId, customerName: customer?.name, items: invoiceItems, subtotal: Number(subtotal) || 0,
              discountAmount: calculatedDiscountAmount, grandTotal: Number(grandTotal) || 0, createdAt: new Date().toISOString(),
              goldRateApplied: cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'gold') ? ratesForInvoice.goldRatePerGram24k : undefined,
              palladiumRateApplied: cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'palladium') ? ratesForInvoice.palladiumRatePerGram : undefined,
              platinumRateApplied: cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'platinum') ? ratesForInvoice.platinumRatePerGram : undefined,
            };
            state.generatedInvoices.push(generated);
            newInvoice = generated;
        }, false, '[GemsTrack] Invoice: generateInvoice');
        return newInvoice;
      },
      clearGeneratedInvoices: () => {
        set(state => { state.generatedInvoices = []; }, false, '[GemsTrack] Invoice: clearGeneratedInvoices');
      },
    })),
    {
      name: 'gemstrack-pos-storage',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') { return ssrDummyStorage; }
        return localStorage;
      }),
      onRehydrateStorage: () => (state, error) => {
        console.log("[GemsTrack] Persist: onRehydrateStorage_OPTION_INVOKED.");
        if (error) {
          console.error('[GemsTrack] Persist: REHYDRATION_ERROR:', error);
        } else {
          if (state) { console.log('[GemsTrack] Persist: REHYDRATION_SUCCESS_FROM_STORAGE.'); }
          else { console.log('[GemsTrack] Persist: NO_PERSISTED_STATE_USING_INITIAL.'); }
        }
        queueMicrotask(() => {
          useAppStore.getState().setHasHydrated(true);
          console.log(`[GemsTrack] Persist: SET_HAS_HYDRATED_SUCCESS (to true)`);
        });
      },
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { settings, _hasHydrated, ...rest } = state; // Exclude settings from local storage
        return rest;
      },
      version: 7, // Incremented due to settings being removed from local persistence
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

// --- Hydration Hook ---
// IMPORTANT: Ensure React is imported if using its types or useEffect/useState directly here.
// For this hook, only useState and useEffect from React are strictly needed.
import React, { useEffect, useState } from 'react';

export const useIsStoreHydrated = () => {
  console.log("[GemsTrack] useIsStoreHydrated: HOOK_INVOKED. Getting initial _hasHydrated from store.");
  const [isHydrated, setIsHydrated] = useState(useAppStore.getState()._hasHydrated);
  console.log(`[GemsTrack] useIsStoreHydrated: Initial local isHydrated state: ${isHydrated}`);

  useEffect(() => {
    console.log("[GemsTrack] useIsStoreHydrated: useEffect mounted.");
    const storeAlreadyHydrated = useAppStore.getState()._hasHydrated;
    if (storeAlreadyHydrated) {
      setIsHydrated(true);
      console.log("[GemsTrack] useIsStoreHydrated: Store was already hydrated on mount. Set local isHydrated to true.");
      return; 
    }

    console.log("[GemsTrack] useIsStoreHydrated: Subscribing to store's _hasHydrated changes.");
    const unsubscribe = useAppStore.subscribe(
      (currentState) => currentState._hasHydrated, // Select the value to listen to
      (newHydratedValue) => { // Callback when the selected value changes
        console.log(`[GemsTrack] useIsStoreHydrated: Subscription fired. Store _hasHydrated is now: ${newHydratedValue}`);
        if (newHydratedValue) {
          setIsHydrated(true);
          console.log("[GemsTrack] useIsStoreHydrated: Subscription - Set local isHydrated to true. Unsubscribing.");
          unsubscribe(); 
        }
      }
    );

    return () => {
      console.log("[GemsTrack] useIsStoreHydrated: useEffect cleanup. Unsubscribing.");
      unsubscribe();
    };
  }, []); 

  console.log(`[GemsTrack] useIsStoreHydrated: HOOK_RENDERING. Returning: ${isHydrated}`);
  return isHydrated;
};

// --- Initialize default image URLs and AI hints ---
initialProducts.forEach(p => {
    if(!p.imageUrl || !p.imageUrl.startsWith('https://placehold.co')) {
        p.imageUrl = `https://placehold.co/300x300.png?text=${encodeURIComponent(p.sku.substring(0,8))}`;
    }
    const pAsAny = p as any;
    if (!pAsAny['data-ai-hint']) {
        let hint = "jewelry";
        if (p.name.toLowerCase().includes('ring')) hint += " ring";
        else if (p.name.toLowerCase().includes('necklace')) hint += " necklace";
        else if (p.name.toLowerCase().includes('earring') || p.name.toLowerCase().includes('tops')) hint += " earrings";
        else if (p.name.toLowerCase().includes('bracelet')) hint += " bracelet";
        else if (p.name.toLowerCase().includes('bangle')) hint += " bangle";
        else if (p.name.toLowerCase().includes('chain')) hint += " chain";
        else if (p.name.toLowerCase().includes('band')) hint += " band";
        else if (p.name.toLowerCase().includes('locket')) hint += " locket";
        else if (p.name.toLowerCase().includes('coin')) hint += " coin";
        pAsAny['data-ai-hint'] = hint.trim().substring(0,30);
    }
});

if (!initialSettings.shopLogoUrl || !initialSettings.shopLogoUrl.startsWith('https://placehold.co')) {
    initialSettings.shopLogoUrl = "https://placehold.co/200x80.png?text=Taheri";
}

// --- Sanity checks for critical functions/variables ---
if (typeof _calculateProductCostsInternal !== 'function') { console.error("[GemsTrack] CRITICAL: _calculateProductCostsInternal is not defined before IIFE."); }
if (typeof _parseKaratInternal !== 'function') { console.error("[GemsTrack] CRITICAL: _parseKaratInternal is not defined before IIFE."); }
if (typeof DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL === 'undefined') { console.error("[GemsTrack] CRITICAL: DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL is not defined."); }
if (typeof initialProducts === 'undefined') { console.error("[GemsTrack] CRITICAL: initialProducts is not defined before IIFE."); }
if (typeof initialSettings === 'undefined') { console.error("[GemsTrack] CRITICAL: initialSettings is not defined before IIFE."); }
if (typeof formatISO !== 'function' || typeof subDays !== 'function') { console.error("[GemsTrack] CRITICAL: date-fns functions are not available for IIFE."); }
if (typeof CATEGORY_SKU_PREFIXES === 'undefined') { console.error("[GemsTrack] CRITICAL: CATEGORY_SKU_PREFIXES is not defined."); }

// --- SELECTOR DEFINITIONS ---
export const selectCartDetails = (state: AppState): EnrichedCartItem[] => {
  if (!state.cart || !Array.isArray(state.cart)) {
    // This case should ideally not happen if the store is initialized correctly.
    console.warn("[GemsTrack] selectCartDetails: state.cart is not an array. Returning empty array.", state.cart);
    return [];
  }
  if (!state.products || !Array.isArray(state.products)) {
    // Products might not be hydrated yet, or an error occurred.
    console.warn("[GemsTrack] selectCartDetails: state.products is not an array. Returning empty array.", state.products);
    return [];
  }
  if (!state.settings) {
    // Settings might not be loaded from Firestore yet.
    console.warn("[GemsTrack] selectCartDetails: state.settings is missing. Returning empty array.");
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
        totalPrice: costs.totalPrice, // This is the unit price based on current store settings
        lineItemTotal: costs.totalPrice * cartItem.quantity,
      };
    })
    .filter((item): item is EnrichedCartItem => item !== null); // Type guard to filter out nulls
};

export const selectCartSubtotal = (state: AppState): number => {
  const detailedCartItems = selectCartDetails(state);
  if (!Array.isArray(detailedCartItems)) {
    // This should not happen if selectCartDetails is correctly implemented
    console.error("[GemsTrack] selectCartSubtotal: selectCartDetails did not return an array.");
    return 0;
  }
  return detailedCartItems.reduce((total, item) => total + item.lineItemTotal, 0);
};


// --- Store Selector Exports ---
// (No specific selectors like selectProductWithCosts are explicitly defined for export here,
// they are used internally or would be page-specific if needed more broadly)
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


console.log("[GemsTrack] store.ts: Module fully evaluated.");

