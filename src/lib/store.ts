
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import React from 'react';
import { formatISO, subDays } from 'date-fns';

// --- Type Definitions ---

export type MetalType = 'gold' | 'palladium' | 'platinum';

export interface Settings {
  goldRatePerGram: number; // Assumed to be for 24k gold
  palladiumRatePerGram: number;
  platinumRatePerGram: number;
  shopName: string;
  shopAddress: string;
  shopContact: string;
  shopLogoUrl?: string; // URL to the logo image
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

export type KaratValue = '18k' | '21k' | '22k';

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
  quantity: number;
  unitPrice: number; // Price at the time of invoice generation
  itemTotal: number;
}

export interface Invoice {
  id:string;
  customerId?: string;
  customerName?: string;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  createdAt: string; // ISO Date string
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

// --- Helper Functions and Constants (Internal versions first) ---
const DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = '21k';

function _parseKaratInternal(karat: KaratValue | undefined): number {
  const karatToUse = karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
  const karatString = String(karatToUse); // Ensure it's a string before replace
  if (!karatString || typeof karatString !== 'string') {
    console.warn(`[GemsTrack] _parseKaratInternal received invalid type for karat: "${karatString}". Defaulting to ${parseInt(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k',''))}.`);
    return parseInt(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k',''));
  }
  const numericPart = parseInt(karatString.replace('k', ''), 10);
  if (isNaN(numericPart) || numericPart <= 0) {
    console.warn(`[GemsTrack] _parseKaratInternal received invalid or non-positive karat value: "${karatString}". Defaulting to ${parseInt(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k',''))}.`);
    return parseInt(DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k',''));
  }
  return numericPart;
}

function _calculateProductCostsInternal(
  product: Omit<Product, 'sku' | 'categoryId' | 'qrCodeDataUrl' | 'imageUrl' | 'name'> & {
    categoryId?: string;
    name?: string;
  },
  rates: { goldRatePerGram24k: number; palladiumRatePerGram: number; platinumRatePerGram: number }
) {
  let metalCost = 0;
  const currentMetalType = product.metalType || 'gold';

  const metalWeightG = Number(product.metalWeightG) || 0;
  const wastagePercentage = Number(product.wastagePercentage) || 0;
  const makingCharges = Number(product.makingCharges) || 0;
  const diamondChargesValue = product.hasDiamonds ? (Number(product.diamondCharges) || 0) : 0;
  const stoneCharges = Number(product.stoneCharges) || 0;
  const miscCharges = Number(product.miscCharges) || 0;

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
        if(goldRate24k <=0 && metalWeightG > 0) console.warn(`[GemsTrack] Gold rate (${goldRate24k}) is zero or negative for gold product: ${product.name || JSON.stringify(product)}`);
    }
  } else if (currentMetalType === 'palladium') {
    if (palladiumRate > 0) metalCost = metalWeightG * palladiumRate;
    else if (palladiumRate <=0 && metalWeightG > 0) console.warn(`[GemsTrack] Palladium rate (${palladiumRate}) is zero or negative for palladium product: ${product.name || JSON.stringify(product)}`);
  } else if (currentMetalType === 'platinum') {
    if (platinumRate > 0) metalCost = metalWeightG * platinumRate;
    else if (platinumRate <=0 && metalWeightG > 0) console.warn(`[GemsTrack] Platinum rate (${platinumRate}) is zero or negative for platinum product: ${product.name || JSON.stringify(product)}`);
  }

  const validMetalCost = Number(metalCost) || 0;
  const wastageCost = validMetalCost * (wastagePercentage / 100);
  const validWastageCost = Number(wastageCost) || 0;

  const totalPrice = validMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneCharges + miscCharges;
  const finalTotalPrice = Number(totalPrice) || 0;

  if (isNaN(finalTotalPrice)) {
    console.error("[GemsTrack] _calculateProductCostsInternal produced NaN. Details:", {
        productInput: product,
        productProcessed: { metalWeightG, wastagePercentage, makingCharges, hasDiamonds: product.hasDiamonds, diamondCharges: product.diamondCharges, stoneCharges, miscCharges, currentMetalType, karat: product.karat },
        ratesInput: rates,
        ratesProcessed: { goldRate24k, palladiumRate, platinumRate },
        derivedCosts: { metalCost, validMetalCost, wastageCost, validWastageCost, diamondChargesValue },
        calculatedTotalPrice: totalPrice,
        finalTotalPriceReturned: finalTotalPrice
    });
    return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges:0, totalPrice: 0 };
  }

  return {
    metalCost: validMetalCost,
    wastageCost: validWastageCost,
    makingCharges: makingCharges,
    diamondCharges: diamondChargesValue,
    stoneCharges,
    miscCharges,
    totalPrice: finalTotalPrice,
  };
}

// --- Initial Data Definitions ---
const initialSettings: Settings = {
  goldRatePerGram: 20000,
  palladiumRatePerGram: 22000,
  platinumRatePerGram: 25000,
  shopName: "Taheri",
  shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "https://placehold.co/150x50.png?text=Taheri"
};

const initialCategories: Category[] = [
  { id: 'cat001', title: 'Rings' },
  { id: 'cat002', title: 'Tops' },
  { id: 'cat003', title: 'Balis' },
  { id: 'cat004', title: 'Lockets' },
  { id: 'cat005', title: 'Bracelets' },
  { id: 'cat006', title: 'Bracelet and Ring Set' },
  { id: 'cat007', title: 'Bangles' },
  { id: 'cat008', title: 'Chains' },
  { id: 'cat009', title: 'Bands' },
  { id: 'cat010', title: 'Locket Sets without Bangle' },
  { id: 'cat011', title: 'Locket Set with Bangle' },
  { id: 'cat012', title: 'String Sets' },
  { id: 'cat013', title: 'Stone Necklace Sets without Bracelets' },
  { id: 'cat014', title: 'Stone Necklace Sets with Bracelets' },
  { id: 'cat015', title: 'Gold Necklace Sets with Bracelets' }, // Corrected typo: Bracelets
  { id: 'cat016', title: 'Gold Necklace Sets without Bracelets' },
];

const initialCustomers: Customer[] = [
  { id: 'cust-001', name: 'Aisha Khan', phone: '0300-1234567', email: 'aisha.khan@example.com', address: '123 Gulberg, Lahore' },
  { id: 'cust-002', name: 'Bilal Ahmed', phone: '0321-9876543', email: 'bilal.ahmed@example.com', address: '456 DHA, Karachi' },
  { id: 'cust-003', name: 'Fatima Ali', phone: '0333-1122334', email: 'fatima.ali@example.com', address: '789 F-8, Islamabad' },
  { id: 'cust-004', name: 'Sana Mirza', phone: '0345-5566778', email: 'sana.mirza@example.com', address: 'A-1 Cantt, Rawalpindi' },
];

const initialProducts: Product[] = [
  {
    sku: "RIN-000001", name: "Rings - RIN-000001", categoryId: "cat001",
    metalType: 'gold', karat: '21k', metalWeightG: 5.2, wastagePercentage: 25,
    makingCharges: 4160, hasDiamonds: true, diamondCharges: 25000, stoneCharges: 0, miscCharges: 500,
    imageUrl: "https://placehold.co/300x300.png?text=Diamond+Ring"
  },
  {
    sku: "STO-000001", name: "Stone Necklace Sets without Bracelets - STO-000001", categoryId: "cat013",
    metalType: 'gold', karat: '22k', metalWeightG: 12.5, wastagePercentage: 10,
    makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 112500, miscCharges: 1500,
    imageUrl: "https://placehold.co/300x300.png?text=Necklace+Set"
  },
  {
    sku: "TOP-000001", name: "Tops - TOP-000001", categoryId: "cat002",
    metalType: 'gold', karat: '18k', metalWeightG: 3.0, wastagePercentage: 10,
    makingCharges: 1800, hasDiamonds: false, diamondCharges: 0, stoneCharges: 37500, miscCharges: 300,
    imageUrl: "https://placehold.co/300x300.png?text=Tops"
  },
  {
    sku: "BRA-000001", name: "Bracelets - BRA-000001", categoryId: "cat005",
    metalType: 'gold', karat: '21k', metalWeightG: 8.0, wastagePercentage: 10,
    makingCharges: 7200, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 700,
    imageUrl: "https://placehold.co/300x300.png?text=Bracelet"
  },
  {
    sku: "BAN-000001", name: "Bangles - BAN-000001", categoryId: "cat007",
    metalType: 'gold', karat: '22k', metalWeightG: 15.0, wastagePercentage: 15, // Bangles = 15%
    makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 22500, miscCharges: 800,
    imageUrl: "https://placehold.co/300x300.png?text=Bangle"
  },
  {
    sku: "GOL-000001", name: "Gold Necklace Sets with Bracelets - GOL-000001", categoryId: "cat015",
    metalType: 'gold', karat: '21k', metalWeightG: 20.0, wastagePercentage: 15, // Gold necklace set, plain = 15%
    makingCharges: 30000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 160000, miscCharges: 2000,
    imageUrl: "https://placehold.co/300x300.png?text=Gold+Set"
  },
  {
    sku: "CHA-000001", name: "Chains - CHA-000001", categoryId: "cat008",
    metalType: 'gold', karat: '22k', metalWeightG: 10.0, wastagePercentage: 15, // Chains = 15%
    makingCharges: 8000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 400,
    imageUrl: "https://placehold.co/300x300.png?text=Gold+Chain"
  },
  {
    sku: "RIN-000002", name: "Rings - RIN-000002", categoryId: "cat001",
    metalType: 'palladium', metalWeightG: 6.0, wastagePercentage: 10, // Palladium default 10%
    makingCharges: 5000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 10000, miscCharges: 300,
    imageUrl: "https://placehold.co/300x300.png?text=Palladium+Ring"
  },
   {
    sku: "BAN-000002", name: "Bands - BAN-000002", categoryId: "cat009",
    metalType: 'platinum', metalWeightG: 7.5, wastagePercentage: 25, // Platinum with diamonds 25%
    makingCharges: 6000, hasDiamonds: true, diamondCharges: 15000, stoneCharges: 0, miscCharges: 250,
    imageUrl: "https://placehold.co/300x300.png?text=Platinum+Band"
  }
];

const initialGeneratedInvoices: Invoice[] = (() => {
    const invoices: Invoice[] = [];
    const { goldRatePerGram, palladiumRatePerGram, platinumRatePerGram } = initialSettings;

    const ratesForCalc = {
        goldRatePerGram24k: goldRatePerGram,
        palladiumRatePerGram: palladiumRatePerGram,
        platinumRatePerGram: platinumRatePerGram,
    };

    const product1_inv1 = initialProducts.find(p => p.sku === "RIN-000001");
    const product2_inv1 = initialProducts.find(p => p.sku === "TOP-000001");
    if (product1_inv1 && product2_inv1) {
        const costs1_inv1 = _calculateProductCostsInternal(product1_inv1, ratesForCalc);
        const costs2_inv1 = _calculateProductCostsInternal(product2_inv1, ratesForCalc);
        const items_inv1: InvoiceItem[] = [
            { sku: product1_inv1.sku, name: product1_inv1.name, categoryId: product1_inv1.categoryId, metalType: product1_inv1.metalType, karat: product1_inv1.karat, quantity: 1, unitPrice: costs1_inv1.totalPrice, itemTotal: costs1_inv1.totalPrice * 1 },
            { sku: product2_inv1.sku, name: product2_inv1.name, categoryId: product2_inv1.categoryId, metalType: product2_inv1.metalType, karat: product2_inv1.karat, quantity: 2, unitPrice: costs2_inv1.totalPrice, itemTotal: costs2_inv1.totalPrice * 2 },
        ];
        const subtotal_inv1 = items_inv1.reduce((sum, item) => sum + item.itemTotal, 0);
        invoices.push({
            id: "inv-dummy-001", customerId: "cust-001", customerName: "Aisha Khan", items: items_inv1,
            subtotal: subtotal_inv1, discountAmount: 1000, grandTotal: subtotal_inv1 - 1000,
            createdAt: formatISO(subDays(new Date(), 10)),
            goldRateApplied: goldRatePerGram,
        });
    }

    const product1_inv2 = initialProducts.find(p => p.sku === "BRA-000001");
    const product2_inv2 = initialProducts.find(p => p.sku === "RIN-000002");
     if (product1_inv2 && product2_inv2) {
        const costs1_inv2 = _calculateProductCostsInternal(product1_inv2, ratesForCalc);
        const costs2_inv2 = _calculateProductCostsInternal(product2_inv2, ratesForCalc);
        const items_inv2: InvoiceItem[] = [
            { sku: product1_inv2.sku, name: product1_inv2.name, categoryId: product1_inv2.categoryId, metalType: product1_inv2.metalType, karat: product1_inv2.karat, quantity: 1, unitPrice: costs1_inv2.totalPrice, itemTotal: costs1_inv2.totalPrice * 1 },
            { sku: product2_inv2.sku, name: product2_inv2.name, categoryId: product2_inv2.categoryId, metalType: product2_inv2.metalType, quantity: 1, unitPrice: costs2_inv2.totalPrice, itemTotal: costs2_inv2.totalPrice * 1 },
        ];
        const subtotal_inv2 = items_inv2.reduce((sum, item) => sum + item.itemTotal, 0);
        invoices.push({
            id: "inv-dummy-002", customerId: "cust-002", customerName: "Bilal Ahmed", items: items_inv2,
            subtotal: subtotal_inv2, discountAmount: 0, grandTotal: subtotal_inv2,
            createdAt: formatISO(subDays(new Date(), 5)),
            goldRateApplied: goldRatePerGram, palladiumRateApplied: palladiumRatePerGram,
        });
    }

    const product1_inv3 = initialProducts.find(p => p.sku === "BAN-000002");
     if (product1_inv3) {
        const costs1_inv3 = _calculateProductCostsInternal(product1_inv3, ratesForCalc);
        const items_inv3: InvoiceItem[] = [
            { sku: product1_inv3.sku, name: product1_inv3.name, categoryId: product1_inv3.categoryId, metalType: product1_inv3.metalType, quantity: 1, unitPrice: costs1_inv3.totalPrice, itemTotal: costs1_inv3.totalPrice * 1 },
        ];
        const subtotal_inv3 = items_inv3.reduce((sum, item) => sum + item.itemTotal, 0);
        invoices.push({
            id: "inv-dummy-003", customerName: "Walk-in Customer", items: items_inv3,
            subtotal: subtotal_inv3, discountAmount: 500, grandTotal: subtotal_inv3 - 500,
            createdAt: formatISO(subDays(new Date(), 2)),
            platinumRateApplied: platinumRatePerGram,
        });
    }

    const product1_inv4 = initialProducts.find(p => p.sku === "CHA-000001");
     if (product1_inv4) {
        const costs1_inv4 = _calculateProductCostsInternal(product1_inv4, ratesForCalc);
        const items_inv4: InvoiceItem[] = [
            { sku: product1_inv4.sku, name: product1_inv4.name, categoryId: product1_inv4.categoryId, metalType: product1_inv4.metalType, karat: product1_inv4.karat, quantity: 1, unitPrice: costs1_inv4.totalPrice, itemTotal: costs1_inv4.totalPrice * 1 },
        ];
        const subtotal_inv4 = items_inv4.reduce((sum, item) => sum + item.itemTotal, 0);
        invoices.push({
            id: "inv-dummy-004", customerId: "cust-001", customerName: "Aisha Khan", items: items_inv4,
            subtotal: subtotal_inv4, discountAmount: 0, grandTotal: subtotal_inv4,
            createdAt: formatISO(subDays(new Date(), 1)),
            goldRateApplied: goldRatePerGram,
        });
    }
    const product1_inv5 = initialProducts.find(p => p.sku === "GOL-000001");
    if (product1_inv5) {
        const costs1_inv5 = _calculateProductCostsInternal(product1_inv5, ratesForCalc);
        const items_inv5: InvoiceItem[] = [
            { sku: product1_inv5.sku, name: product1_inv5.name, categoryId: product1_inv5.categoryId, metalType: product1_inv5.metalType, karat: product1_inv5.karat, quantity: 1, unitPrice: costs1_inv5.totalPrice, itemTotal: costs1_inv5.totalPrice * 1 },
        ];
        const subtotal_inv5 = items_inv5.reduce((sum, item) => sum + item.itemTotal, 0);
        invoices.push({
            id: "inv-dummy-005", customerId: "cust-003", customerName: "Fatima Ali", items: items_inv5,
            subtotal: subtotal_inv5, discountAmount: 2000, grandTotal: subtotal_inv5 - 2000,
            createdAt: formatISO(subDays(new Date(), 15)),
            goldRateApplied: goldRatePerGram,
        });
    }
    return invoices;
})();

const initialKarigars: Karigar[] = [
    { id: 'karigar-001', name: 'Ustad Karim Baksh', contact: '0301-1112233', notes: 'Specializes in intricate gold work.'},
    { id: 'karigar-002', name: 'Ali Bhai', contact: '0302-4445566', notes: 'Good with modern designs and platinum.'},
];

// --- Store State and Actions ---
type ProductDataForAdd = Omit<Product, 'sku' | 'qrCodeDataUrl' | 'name'>;
type ProductDataForUpdate = Partial<Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>>;


export interface AppState {
  settings: Settings;
  categories: Category[];
  products: Product[];
  customers: Customer[];
  cart: CartItem[];
  generatedInvoices: Invoice[];
  karigars: Karigar[];

  updateSettings: (newSettings: Partial<Settings>) => void;

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


const ssrDummyStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (hydrated) => {
        set((state) => {
          state._hasHydrated = hydrated;
        }, false, '[GemsTrack] Store: setHasHydrated');
      },
      settings: initialSettings,
      categories: initialCategories,
      products: initialProducts,
      customers: initialCustomers,
      cart: [],
      generatedInvoices: initialGeneratedInvoices,
      karigars: initialKarigars,

      updateSettings: (newSettings) =>
        set((state) => {
          state.settings = { ...state.settings, ...newSettings };
        }, false, '[GemsTrack] Settings: updateSettings'),

      addCategory: (title) =>
        set((state) => {
          const newCategory: Category = { id: `cat-${Date.now()}`, title };
          state.categories.push(newCategory);
        }, false, '[GemsTrack] Categories: addCategory'),
      updateCategory: (id, title) =>
        set((state) => {
          const category = state.categories.find((c) => c.id === id);
          if (category) {
            category.title = title;
          }
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

          const prefix = category.title.substring(0, 3).toUpperCase();
          let maxNum = 0;
          state.products.forEach(p => {
            if (p.sku.startsWith(prefix + "-")) {
              const numPart = parseInt(p.sku.substring(prefix.length + 1), 10);
              if (!isNaN(numPart) && numPart > maxNum) {
                maxNum = numPart;
              }
            }
          });
          const newNum = (maxNum + 1).toString().padStart(6, '0');
          const generatedSku = `${prefix}-${newNum}`;
          const autoGeneratedName = `${category.title} - ${generatedSku}`;

          const finalProductData = { ...productData };
          if (finalProductData.metalType !== 'gold') {
            delete finalProductData.karat;
          }
          if (!finalProductData.hasDiamonds) {
            finalProductData.diamondCharges = 0;
          }


          newProduct = {
            ...finalProductData,
            name: autoGeneratedName,
            sku: generatedSku,
          };
          state.products.push(newProduct);
        }, false, '[GemsTrack] Products: addProduct');
        return newProduct;
      },
      updateProduct: (sku, updatedFields) =>
        set((state) => {
          const productIndex = state.products.findIndex((p) => p.sku === sku);
          if (productIndex !== -1) {
            const safeUpdateFields = { ...updatedFields };
            if (safeUpdateFields.hasDiamonds === false) {
                safeUpdateFields.diamondCharges = 0;
            }
            if (safeUpdateFields.metalType !== 'gold' && 'karat' in safeUpdateFields) {
                 delete safeUpdateFields.karat;
            } else if (safeUpdateFields.metalType === 'gold' && !safeUpdateFields.karat) {
                // If karat is being explicitly set to undefined for a gold item, allow it,
                // but the calculation logic will use a default.
                // If it's not in updatedFields, it keeps its old value.
                if (!('karat' in safeUpdateFields) && !state.products[productIndex].karat) {
                    safeUpdateFields.karat = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;
                }
            }
            state.products[productIndex] = { ...state.products[productIndex], ...safeUpdateFields };
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
          if (product) {
            product.qrCodeDataUrl = qrCodeDataUrl;
          }
        }, false, '[GemsTrack] Products: setProductQrCode'),

      addCustomer: (customerData) =>
        set((state) => {
          const newCustomer: Customer = { ...customerData, id: `cust-${Date.now()}` };
          state.customers.push(newCustomer);
        }, false, '[GemsTrack] Customers: addCustomer'),
      updateCustomer: (id, updatedFields) =>
        set((state) => {
          const customerIndex = state.customers.findIndex((c) => c.id === id);
          if (customerIndex !== -1) {
            state.customers[customerIndex] = { ...state.customers[customerIndex], ...updatedFields };
          }
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
            if (karigarIndex !== -1) {
                state.karigars[karigarIndex] = { ...state.karigars[karigarIndex], ...updatedKarigarData };
            }
        }, false, '[GemsTrack] Karigars: updateKarigar');
      },
      deleteKarigar: (id) => {
        set((state) => {
            state.karigars = state.karigars.filter(k => k.id !== id);
        }, false, '[GemsTrack] Karigars: deleteKarigar');
      },


      addToCart: (sku, quantity = 1) =>
        set((state) => {
          const existingItem = state.cart.find((item) => item.sku === sku);
          if (existingItem) {
            existingItem.quantity += quantity;
          } else {
            state.cart.push({ sku, quantity });
          }
        }, false, '[GemsTrack] Cart: addToCart'),
      removeFromCart: (sku) =>
        set((state) => {
          state.cart = state.cart.filter((item) => item.sku !== sku);
        }, false, '[GemsTrack] Cart: removeFromCart'),
      updateCartQuantity: (sku, quantity) =>
        set((state) => {
          const item = state.cart.find((i) => i.sku === sku);
          if (item) {
            if (quantity <= 0) {
              state.cart = state.cart.filter((i) => i.sku !== sku);
            } else {
              item.quantity = quantity;
            }
          }
        }, false, '[GemsTrack] Cart: updateCartQuantity'),
      clearCart: () =>
        set((state) => {
          state.cart = [];
        }, false, '[GemsTrack] Cart: clearCart'),

      generateInvoice: (customerId, invoiceGoldRate24k, discountAmount) => {
        const { products, cart, customers, settings } = get();
        if (cart.length === 0) {
            console.warn("[GemsTrack] Invoice: Cart is empty, cannot generate invoice.");
            return null;
        }

        let validInvoiceGoldRate24k = Number(invoiceGoldRate24k);
        if (isNaN(validInvoiceGoldRate24k) || validInvoiceGoldRate24k <=0 ) {
             if (cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'gold')) {
                 if(settings.goldRatePerGram <= 0) {
                     console.error("[GemsTrack] Invoice: Store gold rate is also invalid or zero. Cannot proceed with gold item pricing.");
                     return null;
                 }
                 console.warn(`[GemsTrack] Invoice: Invalid invoiceGoldRate24k (${invoiceGoldRate24k}). Defaulting to store setting: ${settings.goldRatePerGram}`);
                 validInvoiceGoldRate24k = settings.goldRatePerGram;
             } else {
                validInvoiceGoldRate24k = 0; // No gold items, so this rate won't be used for calculation but might be stored.
             }
        }

        const ratesForInvoice = {
            goldRatePerGram24k: validInvoiceGoldRate24k,
            palladiumRatePerGram: Number(settings.palladiumRatePerGram) || 0,
            platinumRatePerGram: Number(settings.platinumRatePerGram) || 0,
        };
        if (isNaN(ratesForInvoice.goldRatePerGram24k) || isNaN(ratesForInvoice.palladiumRatePerGram) || isNaN(ratesForInvoice.platinumRatePerGram)) {
            console.error("[GemsTrack] Invoice: One or more metal rates for invoice calculation are NaN.", ratesForInvoice);
            return null;
        }


        let subtotal = 0;
        const invoiceItems: InvoiceItem[] = [];

        for (const cartItem of cart) {
          const product = products.find(p => p.sku === cartItem.sku);
          if (!product) {
              console.error(`[GemsTrack] Invoice: Product with SKU ${cartItem.sku} not found.`);
              continue;
          }

          const productForCostCalc = {
            name: product.name,
            metalType: product.metalType,
            karat: product.metalType === 'gold' ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL) : undefined,
            metalWeightG: product.metalWeightG,
            wastagePercentage: product.wastagePercentage,
            makingCharges: product.makingCharges,
            hasDiamonds: product.hasDiamonds,
            diamondCharges: product.diamondCharges,
            stoneCharges: product.stoneCharges,
            miscCharges: product.miscCharges,
          };

          const costs = _calculateProductCostsInternal(productForCostCalc, ratesForInvoice);
          if (isNaN(costs.totalPrice)) {
              console.error(`[GemsTrack] Invoice: Calculated NaN unit price for product SKU ${product.sku}. Skipping item. Costs:`, costs);
              continue;
          }
          const unitPrice = costs.totalPrice;
          const itemTotal = unitPrice * cartItem.quantity;
          subtotal += itemTotal;

          invoiceItems.push({
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId,
            metalType: product.metalType,
            karat: productForCostCalc.karat,
            quantity: cartItem.quantity,
            unitPrice,
            itemTotal,
          });
        }

        if (invoiceItems.length === 0 && cart.length > 0) {
            console.error("[GemsTrack] Invoice: All cart items resulted in NaN prices or were not found. Cannot generate invoice.");
            return null;
        }


        const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, Number(discountAmount) || 0));
        const grandTotal = subtotal - calculatedDiscountAmount;

        const customer = customers.find(c => c.id === customerId);

        const newInvoice: Invoice = {
          id: `inv-${Date.now()}`,
          customerId,
          customerName: customer?.name,
          items: invoiceItems,
          subtotal: Number(subtotal) || 0,
          discountAmount: calculatedDiscountAmount,
          grandTotal: Number(grandTotal) || 0,
          createdAt: new Date().toISOString(),
          goldRateApplied: cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'gold') ? ratesForInvoice.goldRatePerGram24k : undefined,
          palladiumRateApplied: cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'palladium') ? ratesForInvoice.palladiumRatePerGram : undefined,
          platinumRateApplied: cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'platinum') ? ratesForInvoice.platinumRatePerGram : undefined,
        };

        set(state => {
          state.generatedInvoices.push(newInvoice);
        }, false, '[GemsTrack] Invoice: generateInvoice');
        return newInvoice;
      },
      clearGeneratedInvoices: () => {
        set(state => {
          state.generatedInvoices = [];
        }, false, '[GemsTrack] Invoice: clearGeneratedInvoices');
      },
    })),
    {
      name: 'gemstrack-pos-storage',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return ssrDummyStorage;
        }
        return localStorage;
      }),
      onRehydrateStorage: (_state) => {
        console.log("[GemsTrack] Persist: Hydration preparing to start.");
        return (finalState, error) => {
          if (error) {
            console.error('[GemsTrack] Persist: An error occurred during rehydration:', error);
          } else {
            console.log("[GemsTrack] Persist: Hydration finished. Final state object:", finalState);
             if (finalState) {
              queueMicrotask(() => {
                useAppStore.getState().setHasHydrated(true); 
              });
            } else {
                queueMicrotask(() => {
                    useAppStore.getState().setHasHydrated(true);
                });
            }
          }
        };
      },
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _hasHydrated, ...rest } = state;
        return rest;
      },
      version: 5, 
    }
  )
);

// --- Exported Helper Functions ---
export const DEFAULT_KARAT_VALUE_FOR_CALCULATION: KaratValue = DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL;

export function calculateProductCosts(
  product: Omit<Product, 'sku' | 'categoryId' | 'qrCodeDataUrl' | 'imageUrl' | 'name'> & {
    categoryId?: string;
    name?: string;
  },
  rates: { goldRatePerGram24k: number; palladiumRatePerGram: number; platinumRatePerGram: number }
) {
  return _calculateProductCostsInternal(product, rates);
}


// --- Selectors ---
export const selectProductWithCosts = (sku: string, state: AppState) => {
  const product = state.products.find(p => p.sku === sku);
  if (!product) return null;
  const productWithDefaultedKarat = {
    ...product,
    metalType: product.metalType || 'gold',
    karat: (product.metalType === 'gold' || !product.metalType)
      ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL)
      : undefined,
  };
  const ratesForCalculation = {
    goldRatePerGram24k: state.settings.goldRatePerGram,
    palladiumRatePerGram: state.settings.palladiumRatePerGram,
    platinumRatePerGram: state.settings.platinumRatePerGram,
  };
  const costs = _calculateProductCostsInternal(productWithDefaultedKarat, ratesForCalculation);
  return { ...productWithDefaultedKarat, ...costs };
};

export const selectAllProductsWithCosts = (state: AppState) => {
  return state.products.map(product => {
    const productWithDefaultedKarat = {
      ...product,
      metalType: product.metalType || 'gold',
      karat: (product.metalType === 'gold' || !product.metalType)
        ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL)
        : undefined,
    };
    const ratesForCalculation = {
      goldRatePerGram24k: state.settings.goldRatePerGram,
      palladiumRatePerGram: state.settings.palladiumRatePerGram,
      platinumRatePerGram: state.settings.platinumRatePerGram,
    };
    const costs = _calculateProductCostsInternal(productWithDefaultedKarat, ratesForCalculation);
    return { ...productWithDefaultedKarat, ...costs };
  });
};

export const selectCategoryTitleById = (categoryId: string, state: AppState) => {
  const category = state.categories.find(c => c.id === categoryId);
  return category ? category.title : 'Uncategorized';
};

export interface CartItem {
  sku: string;
  quantity: number;
}

export const selectCartDetails = (state: AppState) => {
  return state.cart.map(cartItem => {
    const product = state.products.find(p => p.sku === cartItem.sku);
    if (!product) return null;
    const productWithDefaultedKarat = {
      ...product,
      metalType: product.metalType || 'gold',
      karat: (product.metalType === 'gold' || !product.metalType)
        ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL)
        : undefined,
    };
    const ratesForCalculation = {
      goldRatePerGram24k: state.settings.goldRatePerGram,
      palladiumRatePerGram: state.settings.palladiumRatePerGram,
      platinumRatePerGram: state.settings.platinumRatePerGram,
    };
    const costs = _calculateProductCostsInternal(productWithDefaultedKarat, ratesForCalculation);
    return {
      ...productWithDefaultedKarat,
      ...costs,
      quantity: cartItem.quantity,
      lineItemTotal: (Number(costs.totalPrice) || 0) * cartItem.quantity,
    };
  }).filter(item => item !== null) as (Product & ReturnType<typeof _calculateProductCostsInternal> & { quantity: number, lineItemTotal: number })[];
};


export const selectCartSubtotal = (state: AppState) => {
  const cartDetails = selectCartDetails(state);
  return cartDetails.reduce((sum, item) => sum + (Number(item.lineItemTotal) || 0), 0);
};

export const useIsStoreHydrated = () => {
  const [isHydrated, setIsHydratedInternal] = React.useState(useAppStore.getState()._hasHydrated);

  React.useEffect(() => {
    const unsubscribe = useAppStore.subscribe(
      (state) => state._hasHydrated,
      (hydratedStateFromStore) => {
         queueMicrotask(() => setIsHydratedInternal(hydratedStateFromStore));
      }
    );
    // Sync again in case it hydrated between initial state read and subscription
    setIsHydratedInternal(useAppStore.getState()._hasHydrated);
    
    return () => {
      unsubscribe();
    };
  }, []); 

  return isHydrated;
};

// Add data-ai-hint to initialProducts
initialProducts.forEach(product => {
    let hint = "jewelry";
    if (product.name.toLowerCase().includes('ring')) hint += " ring";
    else if (product.name.toLowerCase().includes('necklace')) hint += " necklace";
    else if (product.name.toLowerCase().includes('earring') || product.name.toLowerCase().includes('tops')) hint += " earrings";
    else if (product.name.toLowerCase().includes('bracelet')) hint += " bracelet";
    else if (product.name.toLowerCase().includes('bangle')) hint += " bangle";
    else if (product.name.toLowerCase().includes('chain')) hint += " chain";
    else if (product.name.toLowerCase().includes('band')) hint += " band";
    else hint += " piece";

    if(product.hasDiamonds) hint += " diamond";
    (product as any)['data-ai-hint'] = hint.trim().substring(0,20); 
});

initialSettings.shopLogoUrl = "https://placehold.co/150x50.png?text=Taheri";
initialProducts.forEach(p => {
    if(p.imageUrl && p.imageUrl.includes('placehold.co') && !p.imageUrl.includes('text=')){
        p.imageUrl = `https://placehold.co/300x300.png?text=${encodeURIComponent(p.name.substring(0,10))}`
    }
});

    