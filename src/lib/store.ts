
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import React from 'react';

// --- Type Definitions ---

export interface Settings {
  goldRatePerGram: number;
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

export interface Product {
  sku: string;
  name: string; // Name is still part of the Product model
  categoryId: string;
  metalWeightG: number;
  stoneWeightCt: number;
  wastagePercentage: number;
  makingRatePerG: number;
  stoneRatePerCt: number;
  miscCharges: number;
  qrCodeDataUrl?: string; // Data URL of the generated QR code image
  assignedCustomerId?: string;
  imageUrl?: string; // Optional image for the product
}

export interface CartItem {
  sku: string;
  quantity: number;
}

// InvoiceItem now includes categoryId for better AI analysis potential
export interface InvoiceItem { 
  sku: string;
  name: string; 
  categoryId: string; 
  quantity: number;
  unitPrice: number; // Price at the time of invoice generation
  itemTotal: number;
}

export interface Invoice {
  id:string;
  customerId?: string;
  customerName?: string; // Denormalized for easier display
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  createdAt: string; // ISO Date string
  goldRateApplied: number; // Gold rate used for this specific invoice
}

// --- Computed Value Helpers ---

export const calculateProductCosts = (product: Omit<Product, 'sku' | 'categoryId' | 'qrCodeDataUrl' | 'assignedCustomerId' | 'imageUrl' | 'name'> & { categoryId?: string, name?: string}, goldRatePerGram: number) => {
  const metalCost = product.metalWeightG * goldRatePerGram;
  const wastageCost = metalCost * (product.wastagePercentage / 100);
  const makingCost = product.metalWeightG * product.makingRatePerG;
  const stoneCost = product.stoneWeightCt * product.stoneRatePerCt;
  const totalPrice = metalCost + wastageCost + makingCost + stoneCost + product.miscCharges;
  return { metalCost, wastageCost, makingCost, stoneCost, totalPrice };
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

  generateInvoice: (customerId: string | undefined, invoiceGoldRate: number, discountAmount: number) => Invoice | null;
  clearGeneratedInvoices: () => void;

  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

const initialCategories: Category[] = [
  { id: 'cat1', title: 'Rings' },
  { id: 'cat2', title: 'Necklaces' },
  { id: 'cat3', title: 'Earrings' },
  { id: 'cat4', title: 'Bracelets' },
];

const initialSettings: Settings = {
  goldRatePerGram: 20000, 
  shopName: "Taheri",
  shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@taheri.com | (021) 123-4567",
  shopLogoUrl: "https://placehold.co/150x50.png?text=Taheri"
};

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
        }, false, 'setHasHydrated_action');
      },
      settings: initialSettings,
      categories: initialCategories,
      products: [],
      customers: [],
      cart: [],
      generatedInvoices: [],

      updateSettings: (newSettings) =>
        set((state) => {
          state.settings = { ...state.settings, ...newSettings };
        }),

      addCategory: (title) =>
        set((state) => {
          const newCategory: Category = { id: `cat-${Date.now()}`, title };
          state.categories.push(newCategory);
        }),
      updateCategory: (id, title) =>
        set((state) => {
          const category = state.categories.find((c) => c.id === id);
          if (category) {
            category.title = title;
          }
        }),
      deleteCategory: (id) =>
        set((state) => {
          state.categories = state.categories.filter((c) => c.id !== id);
          state.products = state.products.map(p => p.categoryId === id ? {...p, categoryId: ''} : p);
        }),

      addProduct: (productData) => { 
        let newProduct: Product | null = null;
        set((state) => {
          const category = state.categories.find(c => c.id === productData.categoryId);
          if (!category) {
            console.error(`Category with id ${productData.categoryId} not found. Product not added.`);
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
            qrCodeDataUrl: '', 
          };
          state.products.push(newProduct);
        });
        return newProduct;
      },
      updateProduct: (sku, updatedFields) => 
        set((state) => {
          const productIndex = state.products.findIndex((p) => p.sku === sku);
          if (productIndex !== -1) {
            const { sku: _sku, name: _name, ...safeUpdateFields } = updatedFields as any;
            state.products[productIndex] = { ...state.products[productIndex], ...safeUpdateFields };
          }
        }),
      deleteProduct: (sku) =>
        set((state) => {
          state.products = state.products.filter((p) => p.sku !== sku);
          state.cart = state.cart.filter(item => item.sku !== sku); 
        }),
      setProductQrCode: (sku, qrCodeDataUrl) =>
        set((state) => {
          const product = state.products.find((p) => p.sku === sku);
          if (product) {
            product.qrCodeDataUrl = qrCodeDataUrl;
          }
        }),
      
      addCustomer: (customerData) =>
        set((state) => {
          const newCustomer: Customer = { ...customerData, id: `cust-${Date.now()}` };
          state.customers.push(newCustomer);
        }),
      updateCustomer: (id, updatedFields) =>
        set((state) => {
          const customerIndex = state.customers.findIndex((c) => c.id === id);
          if (customerIndex !== -1) {
            state.customers[customerIndex] = { ...state.customers[customerIndex], ...updatedFields };
          }
        }),
      deleteCustomer: (id) =>
        set((state) => {
          state.customers = state.customers.filter((c) => c.id !== id);
          state.products.forEach(product => {
            if (product.assignedCustomerId === id) {
              product.assignedCustomerId = undefined;
            }
          });
        }),

      addToCart: (sku, quantity = 1) =>
        set((state) => {
          const existingItem = state.cart.find((item) => item.sku === sku);
          if (existingItem) {
            existingItem.quantity += quantity;
          } else {
            state.cart.push({ sku, quantity });
          }
        }),
      removeFromCart: (sku) =>
        set((state) => {
          state.cart = state.cart.filter((item) => item.sku !== sku);
        }),
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
        }),
      clearCart: () =>
        set((state) => {
          state.cart = [];
        }),
      
      generateInvoice: (customerId, invoiceGoldRate, discountAmount) => {
        const { products, cart, customers, settings } = get(); 
        if (cart.length === 0) return null;
        
        const goldRateForInvoice = invoiceGoldRate > 0 ? invoiceGoldRate : settings.goldRatePerGram;
        if (goldRateForInvoice <= 0) { 
            console.error("Invoice gold rate must be positive.");
            return null; 
        }

        let subtotal = 0;
        const invoiceItems: InvoiceItem[] = cart.map(cartItem => {
          const product = products.find(p => p.sku === cartItem.sku);
          if (!product) throw new Error(`Product with SKU ${cartItem.sku} not found for invoice.`);
          
          const costs = calculateProductCosts(product, goldRateForInvoice);
          const unitPrice = costs.totalPrice;
          const itemTotal = unitPrice * cartItem.quantity;
          subtotal += itemTotal;
          
          return {
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId, // Ensure categoryId is included
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
        });
        return newInvoice;
      },
      clearGeneratedInvoices: () => {
        set(state => {
          state.generatedInvoices = [];
        });
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
      onRehydrateStorage: (_state, error) => {
        if (error) {
          console.error('[Taheri POS] Persist: Rehydration error:', error);
        }
        queueMicrotask(() => {
            useAppStore.getState().setHasHydrated(true);
        });
      },
      partialize: (state) => {
        const { _hasHydrated, ...rest } = state; 
        return rest;
      },
      version: 1, 
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

export const selectCartDetails = (state: AppState) => {
  return state.cart.map(cartItem => {
    const product = state.products.find(p => p.sku === cartItem.sku);
    if (!product) return null; 
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
    // Function to sync local state with store's hydration status
    const syncHydrationState = () => {
      setIsHydrated(useAppStore.getState()._hasHydrated);
    };

    // Sync immediately on mount in case the store is already hydrated
    syncHydrationState();

    // Subscribe to future changes in the store's hydration status
    const unsubscribe = useAppStore.subscribe(
      (state) => state._hasHydrated,
      (hydrated) => {
        setIsHydrated(hydrated);
      }
    );

    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
    };
  }, []); // Empty dependency array ensures this runs only on mount and unmount

  return isHydrated;
};

