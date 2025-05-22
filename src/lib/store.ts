
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import React from 'react';

// --- Type Definitions ---

export interface Settings {
  goldRatePerGram: number; // Assumed to be for 24k gold
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
  karat: KaratValue;
  metalWeightG: number;
  wastagePercentage: number;
  makingCharges: number; // Total making charges
  hasDiamonds: boolean;
  diamondCharges: number;
  stoneCharges: number; // For non-diamond stones, total charge
  miscCharges: number;
  qrCodeDataUrl?: string;
  imageUrl?: string;
}

export interface InvoiceItem {
  sku: string;
  name: string;
  categoryId: string;
  karat: KaratValue;
  quantity: number;
  unitPrice: number; // Price at the time of invoice generation, reflects product's karat
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
  goldRateApplied: number; // The 24k gold rate used for this invoice's calculations
}

// --- Computed Value Helpers ---
const parseKarat = (karat: KaratValue): number => {
  return parseInt(karat.replace('k', ''), 10);
};

export const calculateProductCosts = (
  product: Omit<Product, 'sku' | 'categoryId' | 'qrCodeDataUrl' | 'imageUrl' | 'name'> & { categoryId?: string, name?: string, karat: KaratValue },
  goldRatePerGram24k: number
) => {
  const karatNumeric = parseKarat(product.karat);
  const purityFactor = karatNumeric / 24;
  const effectiveGoldRate = purityFactor * goldRatePerGram24k;

  const metalCost = product.metalWeightG * effectiveGoldRate;
  const wastageCost = metalCost * (product.wastagePercentage / 100);
  const makingCost = product.makingCharges;
  const totalDiamondCharges = product.hasDiamonds ? product.diamondCharges : 0;
  const totalStoneCharges = product.stoneCharges;
  const totalPrice = metalCost + wastageCost + makingCost + totalDiamondCharges + totalStoneCharges + product.miscCharges;
  return { metalCost, wastageCost, makingCost, diamondCharges: totalDiamondCharges, stoneCharges: totalStoneCharges, totalPrice };
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

  generateInvoice: (customerId: string | undefined, invoiceGoldRate24k: number, discountAmount: number) => Invoice | null;
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
  { id: 'cat15', title: 'Gold Necklace Sets with Bracelets' },
  { id: 'cat16', title: 'Gold Necklace Sets without Bracelets' },
];


const initialSettings: Settings = {
  goldRatePerGram: 20000, // Assumed to be for 24k gold
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
    sku: "RIN-000001", name: "Rings - RIN-000001", categoryId: "cat01", karat: '21k', metalWeightG: 5.2, wastagePercentage: 25,
    makingCharges: 4160, hasDiamonds: true, diamondCharges: 25000, stoneCharges: 0, miscCharges: 500, imageUrl: "https://placehold.co/300x300.png?text=Diamond+Ring"
  },
  {
    sku: "STO-000001", name: "Stone Necklace Sets without Bracelets - STO-000001", categoryId: "cat13", karat: '22k', metalWeightG: 12.5, wastagePercentage: 10,
    makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 112500, miscCharges: 1500, imageUrl: "https://placehold.co/300x300.png?text=Necklace+Set"
  },
  {
    sku: "TOP-000001", name: "Tops - TOP-000001", categoryId: "cat02", karat: '18k', metalWeightG: 3.0, wastagePercentage: 10,
    makingCharges: 1800, hasDiamonds: false, diamondCharges: 0, stoneCharges: 37500, miscCharges: 300, imageUrl: "https://placehold.co/300x300.png?text=Tops"
  },
  {
    sku: "BRA-000001", name: "Bracelets - BRA-000001", categoryId: "cat05", karat: '21k', metalWeightG: 8.0, wastagePercentage: 10,
    makingCharges: 7200, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 700, imageUrl: "https://placehold.co/300x300.png?text=Bracelet"
  },
  {
    sku: "BAN-000001", name: "Bangles - BAN-000001", categoryId: "cat07", karat: '22k', metalWeightG: 15.0, wastagePercentage: 15,
    makingCharges: 15000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 22500, miscCharges: 800, imageUrl: "https://placehold.co/300x300.png?text=Bangle"
  },
  {
    sku: "GOL-000001", name: "Gold Necklace Sets with Bracelets - GOL-000001", categoryId: "cat15", karat: '21k', metalWeightG: 20.0, wastagePercentage: 15,
    makingCharges: 30000, hasDiamonds: true, diamondCharges: 50000, stoneCharges: 160000, miscCharges: 2000, imageUrl: "https://placehold.co/300x300.png?text=Gold+Set+Diamond"
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

          newProduct = {
            ...productData,
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
            const { name: _name, sku: _sku, ...safeUpdateFields } = updatedFields as any;
            if (safeUpdateFields.hasDiamonds === false) {
                safeUpdateFields.diamondCharges = 0;
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

        const goldRateForInvoice = invoiceGoldRate24k > 0 ? invoiceGoldRate24k : settings.goldRatePerGram;
        if (goldRateForInvoice <= 0) {
            console.error("[GemsTrack] Invoice: Gold rate for invoice must be positive.");
            return null;
        }

        let subtotal = 0;
        const invoiceItems: InvoiceItem[] = cart.map(cartItem => {
          const product = products.find(p => p.sku === cartItem.sku);
          if (!product) {
              console.error(`[GemsTrack] Invoice: Product with SKU ${cartItem.sku} not found.`);
              throw new Error(`Product with SKU ${cartItem.sku} not found for invoice.`);
          }

          const costs = calculateProductCosts(product, goldRateForInvoice);
          const unitPrice = costs.totalPrice;
          const itemTotal = unitPrice * cartItem.quantity;
          subtotal += itemTotal;

          return {
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId,
            karat: product.karat,
            quantity: cartItem.quantity,
            unitPrice,
            itemTotal,
          };
        });

        const calculatedDiscountAmount = Math.max(0, Math.min(subtotal, discountAmount));
        const grandTotal = subtotal - calculatedDiscountAmount;

        const customer = customers.find(c => c.id === customerId);

        const newInvoice: Invoice = {
          id: `inv-${Date.now()}`,
          customerId,
          customerName: customer?.name,
          items: invoiceItems,
          subtotal,
          discountAmount: calculatedDiscountAmount,
          grandTotal,
          createdAt: new Date().toISOString(),
          goldRateApplied: goldRateForInvoice,
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
          } else if (state) {
            // Use queueMicrotask to ensure this runs after the current event loop cycle
            // and after the store has been fully initialized with the persisted state.
            queueMicrotask(() => {
              useAppStore.getState().setHasHydrated(true);
              console.log('[GemsTrack] Persist: _hasHydrated flag set to true via onRehydrateStorage.');
            });
          }
        };
      },
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _hasHydrated, ...rest } = state;
        return rest;
      },
      version: 2, // Increment version if schema changes significantly
    }
  )
);

export const selectProductWithCosts = (sku: string, state: AppState) => {
  const product = state.products.find(p => p.sku === sku);
  if (!product) return null;
  const costs = calculateProductCosts(product, state.settings.goldRatePerGram);
  return { ...product, ...costs };
};

export const selectAllProductsWithCosts = (state: AppState) => {
  return state.products.map(product => {
    const costs = calculateProductCosts(product, state.settings.goldRatePerGram);
    return { ...product, ...costs };
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
    // Use the gold rate from settings for cart display (invoice rate is applied at invoice generation)
    const costs = calculateProductCosts(product, state.settings.goldRatePerGram);
    return {
      ...product,
      ...costs,
      quantity: cartItem.quantity,
      lineItemTotal: costs.totalPrice * cartItem.quantity,
    };
  }).filter(item => item !== null) as (Product & ReturnType<typeof calculateProductCosts> & { quantity: number, lineItemTotal: number })[];
};


export const selectCartSubtotal = (state: AppState) => {
  const cartDetails = selectCartDetails(state);
  return cartDetails.reduce((sum, item) => sum + item.lineItemTotal, 0);
};

export const useIsStoreHydrated = () => {
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    const setHydrated = () => setIsHydrated(true);
    const store = useAppStore.getState();

    if (store._hasHydrated) {
      setHydrated();
    } else {
      // Subscribe to future hydration
      const unsub = useAppStore.subscribe(
        (currentState) => currentState._hasHydrated,
        (hydrated) => {
          if (hydrated) {
            setHydrated();
            unsub(); // Unsubscribe once hydrated
          }
        }
      );
      // Check again in case it hydrated between initial check and subscription
      if (useAppStore.getState()._hasHydrated) {
        setHydrated();
        unsub();
      }
      return unsub; // Cleanup subscription
    }
  }, []);

  return isHydrated;
};
