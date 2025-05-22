
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import React from 'react';

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
  karat?: KaratValue; // Optional, only applicable if metalType is 'gold'
  metalWeightG: number;
  wastagePercentage: number;
  makingCharges: number; // Total making charges
  hasDiamonds: boolean;
  diamondCharges: number; // Total diamond charges
  stoneCharges: number; // For non-diamond stones, total charge
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
  createdAt: string;
  // Store all rates used for this invoice for clarity
  goldRateApplied?: number; // The 24k gold rate used for gold items in this invoice
  palladiumRateApplied?: number; // The palladium rate used for palladium items
  platinumRateApplied?: number; // The platinum rate used for platinum items
}

// --- Computed Value Helpers ---
const DEFAULT_KARAT_VALUE_FOR_CALCULATION: KaratValue = '21k';

const parseKarat = (karat: KaratValue | undefined): number => {
  const karatString = karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION;
  const numericPart = parseInt(karatString.replace('k', ''), 10);
  if (isNaN(numericPart) || numericPart <= 0) {
    console.warn(`[GemsTrack] parseKarat received invalid or non-positive karat value: "${karatString}". Defaulting to 21.`);
    return 21; // Default to 21 (e.g., for '21k')
  }
  return numericPart;
};

export const calculateProductCosts = (
  product: Omit<Product, 'sku' | 'categoryId' | 'qrCodeDataUrl' | 'imageUrl' | 'name'> & {
    categoryId?: string;
    name?: string;
  },
  rates: { goldRatePerGram24k: number; palladiumRatePerGram: number; platinumRatePerGram: number }
) => {
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
    const karatToUse = product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION;
    const karatNumeric = parseKarat(karatToUse);
    if (karatNumeric > 0 && !isNaN(karatNumeric)) {
        const purityFactor = karatNumeric / 24;
        const effectiveGoldRate = purityFactor * goldRate24k;
        metalCost = metalWeightG * effectiveGoldRate;
    } else {
        metalCost = 0;
        console.error(`[GemsTrack] Invalid karatNumeric (${karatNumeric}) derived for gold product: ${product.name || JSON.stringify(product)}`);
    }
  } else if (currentMetalType === 'palladium') {
    metalCost = metalWeightG * palladiumRate;
  } else if (currentMetalType === 'platinum') {
    metalCost = metalWeightG * platinumRate;
  }
  
  const validMetalCost = Number(metalCost) || 0;
  const wastageCost = validMetalCost * (wastagePercentage / 100);
  const validWastageCost = Number(wastageCost) || 0;

  const totalPrice = validMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneCharges + miscCharges;
  const finalTotalPrice = Number(totalPrice) || 0;

  if (isNaN(totalPrice) || isNaN(finalTotalPrice)) {
    console.error("[GemsTrack] calculateProductCosts produced or encountered NaN. Details:", {
        productInput: product,
        productProcessed: { metalWeightG, wastagePercentage, makingCharges, hasDiamonds: product.hasDiamonds, diamondCharges: product.diamondCharges, stoneCharges, miscCharges, currentMetalType, karat: product.karat },
        ratesInput: rates,
        ratesProcessed: { goldRate24k, palladiumRate, platinumRate },
        derivedCosts: { metalCost, validMetalCost, wastageCost, validWastageCost, diamondChargesValue },
        calculatedTotalPrice: totalPrice,
        finalTotalPriceReturned: finalTotalPrice
    });
  }

  return {
    metalCost: validMetalCost,
    wastageCost: validWastageCost,
    makingCost: makingCharges, 
    diamondCharges: diamondChargesValue,
    stoneCharges,
    totalPrice: finalTotalPrice,
  };
};


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

const initialCategories: Category[] = [
  { id: 'cat01', title: 'Rings' },
  { id: 'cat02', title: 'Tops' },
  { id: 'cat03', title: 'Balis' },
  { id: 'cat04', title: 'Lockets' },
  { id: 'cat05', title: 'Bracelets' },
  { id: 'cat06', title: 'Bracelet and Ring Set' },
  { id: 'cat07', title: 'Bangles' },
  { id: 'cat08', title: 'Chains' },
  { id: 'cat09', title: 'Bands' },
  { id: 'cat10', title: 'Locket Sets without Bangle' },
  { id: 'cat11', title: 'Locket Set with Bangle' },
  { id: 'cat12', title: 'String Sets' },
  { id: 'cat13', title: 'Stone Necklace Sets without Bracelets' },
  { id: 'cat14', title: 'Stone Necklace Sets with Bracelets' },
  { id: 'cat15', title: 'Gold Necklace Sets with Bracelets' }, // Note typo "Bracelets" from user, kept as is
  { id: 'cat16', title: 'Gold Necklace Sets without Bracelets' },
];


const initialSettings: Settings = {
  goldRatePerGram: 20000,
  palladiumRatePerGram: 22000, 
  platinumRatePerGram: 25000,  
  shopName: "Taheri",
  shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "https://placehold.co/150x50.png?text=Taheri"
};

const initialCustomers: Customer[] = [
  { id: 'cust-001', name: 'Aisha Khan', phone: '0300-1234567', email: 'aisha.khan@example.com', address: '12 Rose Apartments, Clifton, Karachi' },
  { id: 'cust-002', name: 'Bilal Ahmed', phone: '0321-9876543', email: 'bilal.ahmed@example.com', address: '45 Sunshine Villas, DHA Phase 5, Lahore' },
  { id: 'cust-003', name: 'Fatima Ali', email: 'fatima.ali@example.com' },
  { id: 'cust-004', name: 'Zayn Malik', phone: '0333-1122334' },
  { id: 'cust-005', name: 'Sana Mirza', phone: '0345-5556677', email: 'sana.m@example.com', address: 'Apt 7B, Royal Towers, Islamabad' },
];


const initialProducts: Product[] = [
  {
    sku: "RIN-000001", name: "Rings - RIN-000001", categoryId: "cat01", metalType: 'gold', karat: '21k', metalWeightG: 5.2, wastagePercentage: 25,
    makingCharges: 4160, hasDiamonds: true, diamondCharges: 25000, stoneCharges: 0, miscCharges: 500, imageUrl: "https://placehold.co/300x300.png?text=Diamond+Ring"
  },
  {
    sku: "STO-000001", name: "Stone Necklace Sets without Bracelets - STO-000001", categoryId: "cat13", metalType: 'gold', karat: '22k', metalWeightG: 12.5, wastagePercentage: 10,
    makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 112500, miscCharges: 1500, imageUrl: "https://placehold.co/300x300.png?text=Necklace+Set"
  },
  {
    sku: "TOP-000001", name: "Tops - TOP-000001", categoryId: "cat02", metalType: 'gold', karat: '18k', metalWeightG: 3.0, wastagePercentage: 10,
    makingCharges: 1800, hasDiamonds: false, diamondCharges: 0, stoneCharges: 37500, miscCharges: 300, imageUrl: "https://placehold.co/300x300.png?text=Tops"
  },
  {
    sku: "BRA-000001", name: "Bracelets - BRA-000001", categoryId: "cat05", metalType: 'gold', karat: '21k', metalWeightG: 8.0, wastagePercentage: 10,
    makingCharges: 7200, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 700, imageUrl: "https://placehold.co/300x300.png?text=Bracelet"
  },
  {
    sku: "BAN-000001", name: "Bangles - BAN-000001", categoryId: "cat07", metalType: 'gold', karat: '22k', metalWeightG: 15.0, wastagePercentage: 15,
    makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 22500, miscCharges: 800, imageUrl: "https://placehold.co/300x300.png?text=Bangle"
  },
  {
    sku: "GOL-000001", name: "Gold Necklace Sets with Bracelets - GOL-000001", categoryId: "cat15", metalType: 'gold', karat: '21k', metalWeightG: 20.0, wastagePercentage: 25,
    makingCharges: 30000, hasDiamonds: true, diamondCharges: 50000, stoneCharges: 160000, miscCharges: 2000, imageUrl: "https://placehold.co/300x300.png?text=Gold+Set+Diamond"
  },
  {
    sku: "CHA-000001", name: "Chains - CHA-000001", categoryId: "cat08", metalType: 'gold', karat: '22k', metalWeightG: 10.0, wastagePercentage: 15,
    makingCharges: 8000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 400, imageUrl: "https://placehold.co/300x300.png?text=Gold+Chain"
  },
  {
    sku: "PAL-000001", name: "Rings - PAL-000001", categoryId: "cat01", metalType: 'palladium', /* karat: undefined */ metalWeightG: 6.0, wastagePercentage: 10,
    makingCharges: 5000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 10000, miscCharges: 300, imageUrl: "https://placehold.co/300x300.png?text=Palladium+Ring"
  },
   {
    sku: "PLA-000001", name: "Bands - PLA-000001", categoryId: "cat09", metalType: 'platinum', /* karat: undefined */ metalWeightG: 7.5, wastagePercentage: 10,
    makingCharges: 6000, hasDiamonds: true, diamondCharges: 15000, stoneCharges: 0, miscCharges: 250, imageUrl: "https://placehold.co/300x300.png?text=Platinum+Band"
  }
];


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
      generatedInvoices: [],

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
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { name: _name, sku: _sku, ...safeUpdateFields } = updatedFields as any;
            if (safeUpdateFields.hasDiamonds === false) {
                safeUpdateFields.diamondCharges = 0;
            }
            if (safeUpdateFields.metalType !== 'gold' && 'karat' in safeUpdateFields) {
                 delete safeUpdateFields.karat;
            } else if (safeUpdateFields.metalType === 'gold' && !safeUpdateFields.karat) {
                safeUpdateFields.karat = state.products[productIndex].karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION;
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

        const validInvoiceGoldRate24k = Number(invoiceGoldRate24k);
        if (isNaN(validInvoiceGoldRate24k) || validInvoiceGoldRate24k <=0 ) {
             console.warn(`[GemsTrack] Invoice: Invalid invoiceGoldRate24k (${invoiceGoldRate24k}). Defaulting to store setting: ${settings.goldRatePerGram}`);
             if (cart.some(ci => products.find(p=>p.sku === ci.sku)?.metalType === 'gold')) {
                 if(settings.goldRatePerGram <= 0) {
                     console.error("[GemsTrack] Invoice: Store gold rate is also invalid or zero. Cannot proceed with gold item pricing.");
                     return null;
                 }
             }
        }
        
        const ratesForInvoice = {
            goldRatePerGram24k: (isNaN(validInvoiceGoldRate24k) || validInvoiceGoldRate24k <=0) ? settings.goldRatePerGram : validInvoiceGoldRate24k,
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
            karat: product.metalType === 'gold' ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION) : undefined,
            metalWeightG: product.metalWeightG,
            wastagePercentage: product.wastagePercentage,
            makingCharges: product.makingCharges,
            hasDiamonds: product.hasDiamonds,
            diamondCharges: product.diamondCharges,
            stoneCharges: product.stoneCharges,
            miscCharges: product.miscCharges,
          };

          const costs = calculateProductCosts(productForCostCalc, ratesForInvoice);
          if (isNaN(costs.totalPrice)) {
              console.error(`[GemsTrack] Invoice: Calculated NaN unit price for product SKU ${product.sku}. Skipping item.`);
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
      onRehydrateStorage: (_persistedState) => {
        return (state, error) => {
          if (error) {
            console.error('[GemsTrack] Persist: An error occurred during rehydration:', error);
          }
          queueMicrotask(() => { 
            if (state) {
              state.setHasHydrated(true);
            } else {
               useAppStore.getState().setHasHydrated(true);
            }
          });
        };
      },
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _hasHydrated, ...rest } = state;
        return rest;
      },
      version: 3, 
    }
  )
);

export const selectProductWithCosts = (sku: string, state: AppState) => {
  const product = state.products.find(p => p.sku === sku);
  if (!product) return null;
  const productWithDefaultedKarat = {
    ...product,
    metalType: product.metalType || 'gold',
    karat: (product.metalType === 'gold' || !product.metalType)
      ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION) 
      : undefined,
  };
  const ratesForCalculation = {
    goldRatePerGram24k: state.settings.goldRatePerGram,
    palladiumRatePerGram: state.settings.palladiumRatePerGram,
    platinumRatePerGram: state.settings.platinumRatePerGram,
  };
  const costs = calculateProductCosts(productWithDefaultedKarat, ratesForCalculation);
  return { ...productWithDefaultedKarat, ...costs };
};

export const selectAllProductsWithCosts = (state: AppState) => {
  return state.products.map(product => {
    const productWithDefaultedKarat = {
      ...product,
      metalType: product.metalType || 'gold',
      karat: (product.metalType === 'gold' || !product.metalType)
        ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION)
        : undefined,
    };
    const ratesForCalculation = {
      goldRatePerGram24k: state.settings.goldRatePerGram,
      palladiumRatePerGram: state.settings.palladiumRatePerGram,
      platinumRatePerGram: state.settings.platinumRatePerGram,
    };
    const costs = calculateProductCosts(productWithDefaultedKarat, ratesForCalculation);
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
        ? (product.karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION) 
        : undefined,
    };
    const ratesForCalculation = {
      goldRatePerGram24k: state.settings.goldRatePerGram,
      palladiumRatePerGram: state.settings.palladiumRatePerGram,
      platinumRatePerGram: state.settings.platinumRatePerGram,
    };
    const costs = calculateProductCosts(productWithDefaultedKarat, ratesForCalculation); 
    return {
      ...productWithDefaultedKarat,
      ...costs,
      quantity: cartItem.quantity,
      lineItemTotal: (Number(costs.totalPrice) || 0) * cartItem.quantity,
    };
  }).filter(item => item !== null) as (Product & ReturnType<typeof calculateProductCosts> & { quantity: number, lineItemTotal: number })[];
};


export const selectCartSubtotal = (state: AppState) => {
  const cartDetails = selectCartDetails(state);
  return cartDetails.reduce((sum, item) => sum + (Number(item.lineItemTotal) || 0), 0);
};

export const useIsStoreHydrated = () => {
  const isHydrated = useAppStore(React.useCallback((s: AppState) => s._hasHydrated, []));
  
  React.useEffect(() => {
    // This effect ensures that if the store hydrates after the initial render,
    // the component re-renders.
    // It also handles the case where the hook mounts *after* hydration.
    const unsub = useAppStore.subscribe(
      (s) => s._hasHydrated,
      (hydratedState) => {
        if (hydratedState && !isHydrated) {
         // The store has hydrated, and this hook's state is stale.
         // The selector itself should trigger a re-render when _hasHydrated changes in the store.
         // No direct setState call is needed here if the selector is correctly subscribed.
        }
      }
    );
    return unsub;
  }, [isHydrated]);

  return isHydrated;
};
