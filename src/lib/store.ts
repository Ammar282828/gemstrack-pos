
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import React from 'react'; // Added React import for useEffect in useHydratedStore

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
  name: string;
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

export interface InvoiceItem extends Product {
  quantity: number;
  unitPrice: number; // Price at the time of invoice generation
  itemTotal: number;
}

export interface Invoice {
  id: string;
  customerId?: string;
  customerName?: string; // Denormalized for easier display
  items: InvoiceItem[];
  subtotal: number;
  grandTotal: number;
  createdAt: string; // ISO Date string
  // Add other fields like tax, discount if needed
}

// --- Computed Value Helpers ---

export const calculateProductCosts = (product: Product, goldRatePerGram: number) => {
  const metalCost = product.metalWeightG * goldRatePerGram;
  const wastageCost = metalCost * (product.wastagePercentage / 100);
  const makingCost = product.metalWeightG * product.makingRatePerG;
  const stoneCost = product.stoneWeightCt * product.stoneRatePerCt;
  const totalPrice = metalCost + wastageCost + makingCost + stoneCost + product.miscCharges;
  return { metalCost, wastageCost, makingCost, stoneCost, totalPrice };
};


// --- Store State and Actions ---

interface AppState {
  settings: Settings;
  categories: Category[];
  products: Product[];
  customers: Customer[];
  cart: CartItem[];
  generatedInvoices: Invoice[]; // Store generated invoices

  // Settings Actions
  updateSettings: (newSettings: Partial<Settings>) => void;
  
  // Category Actions
  addCategory: (title: string) => void;
  updateCategory: (id: string, title: string) => void;
  deleteCategory: (id: string) => void;

  // Product Actions
  addProduct: (product: Product) => void;
  updateProduct: (sku: string, updatedProduct: Partial<Product>) => void;
  deleteProduct: (sku: string) => void;
  setProductQrCode: (sku: string, qrCodeDataUrl: string) => void;

  // Customer Actions
  addCustomer: (customer: Omit<Customer, 'id'>) => void;
  updateCustomer: (id: string, updatedCustomer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  // Cart Actions
  addToCart: (sku: string, quantity?: number) => void;
  removeFromCart: (sku: string) => void;
  updateCartQuantity: (sku: string, quantity: number) => void;
  clearCart: () => void;

  // Invoice Actions
  generateInvoice: (customerId?: string) => Invoice | null; // Returns the generated invoice
  clearGeneratedInvoices: () => void;

  // Hydration check
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
  goldRatePerGram: 7000, // Example rate
  shopName: "GemsTrack Boutique",
  shopAddress: "123 Jewel Street, Sparkle City",
  shopContact: "contact@gemstrack.com | (555) 123-4567",
  shopLogoUrl: "https://placehold.co/150x50.png?text=GemsTrack"
};

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (hydrated) => {
        set((state) => {
          state._hasHydrated = hydrated;
        });
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
          // Also update products that might be using this category
          state.products = state.products.map(p => p.categoryId === id ? {...p, categoryId: ''} : p);
        }),

      addProduct: (product) =>
        set((state) => {
          state.products.push(product);
        }),
      updateProduct: (sku, updatedFields) =>
        set((state) => {
          const productIndex = state.products.findIndex((p) => p.sku === sku);
          if (productIndex !== -1) {
            state.products[productIndex] = { ...state.products[productIndex], ...updatedFields };
          }
        }),
      deleteProduct: (sku) =>
        set((state) => {
          state.products = state.products.filter((p) => p.sku !== sku);
          state.cart = state.cart.filter(item => item.sku !== sku); // Remove from cart if deleted
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
           // Unassign customer from products
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
      
      generateInvoice: (customerId) => {
        const { products, cart, settings, customers } = get();
        if (cart.length === 0) return null;

        let subtotal = 0;
        const invoiceItems: InvoiceItem[] = cart.map(cartItem => {
          const product = products.find(p => p.sku === cartItem.sku);
          if (!product) throw new Error(`Product with SKU ${cartItem.sku} not found for invoice.`);
          
          const costs = calculateProductCosts(product, settings.goldRatePerGram);
          const unitPrice = costs.totalPrice;
          const itemTotal = unitPrice * cartItem.quantity;
          subtotal += itemTotal;
          
          return {
            ...product,
            quantity: cartItem.quantity,
            unitPrice,
            itemTotal,
          };
        });

        const grandTotal = subtotal; // Add taxes/discounts here if needed

        const customer = customers.find(c => c.id === customerId);

        const newInvoice: Invoice = {
          id: `inv-${Date.now()}`,
          customerId,
          customerName: customer?.name,
          items: invoiceItems,
          subtotal,
          grandTotal,
          createdAt: new Date().toISOString(),
        };

        set(state => {
          state.generatedInvoices.push(newInvoice);
          state.cart = []; // Clear cart after generating invoice
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
      name: 'gemstrack-pos-storage', // unique name
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      onRehydrateStorage: () => (state) => {
        console.log('[GemsTrack] Zustand store rehydration attempt.');
        if (state) {
          state.setHasHydrated(true);
          console.log('[GemsTrack] Zustand store rehydrated successfully.');
        } else {
          console.warn('[GemsTrack] Zustand store rehydration: state is undefined post rehydration attempt.');
        }
      },
    }
  )
);

// Selector to get product with all calculated costs
export const selectProductWithCosts = (sku: string, state: AppState) => {
  const product = state.products.find(p => p.sku === sku);
  if (!product) return null;
  const costs = calculateProductCosts(product, state.settings.goldRatePerGram);
  return { ...product, ...costs };
};

// Selector to get all products with calculated costs
export const selectAllProductsWithCosts = (state: AppState) => {
  return state.products.map(product => {
    const costs = calculateProductCosts(product, state.settings.goldRatePerGram);
    return { ...product, ...costs };
  });
};

// Selector to get category title by ID
export const selectCategoryTitleById = (categoryId: string, state: AppState) => {
  const category = state.categories.find(c => c.id === categoryId);
  return category ? category.title : 'Uncategorized';
};

// Selector for cart items with full product details and costs
export const selectCartDetails = (state: AppState) => {
  return state.cart.map(cartItem => {
    const product = state.products.find(p => p.sku === cartItem.sku);
    if (!product) return null; // Should not happen if data is consistent
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

// Hook to ensure store is hydrated before rendering client components
// This helps avoid hydration mismatches with persisted state
export const useHydratedStore = <T, F>(
  store: (callback: (state: T) => unknown) => unknown,
  callback: (state: T) => F
) => {
  const result = store(callback) as F;
  const [hydratedResult, setHydratedResult] = React.useState<F>();
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    const unsub = useAppStore.subscribe(
      (state) => state._hasHydrated,
      (hydrated) => {
        if (hydrated) {
          setHydratedResult(result);
          setIsHydrated(true);
          unsub(); 
        }
      },
      { fireImmediately: true }
    );
    return unsub;
  }, [result]);
  
  // Fallback for initial server render or before hydration
  if (!isHydrated && typeof window === 'undefined') {
     // For server render, try to compute based on initial state if possible
     // Or return a default/loading state. This part is tricky.
     // For now, using the direct result which might be from initial state.
     return result;
  }


  return hydratedResult ?? (typeof callback === 'function' ? callback(useAppStore.getState() as unknown as T) : undefined);
};

// A simpler hook that just tells you if hydration is complete.
// Useful for conditional rendering of components that depend on persisted state.
export const useIsStoreHydrated = () => {
  const isHydrated = useAppStore(state => state._hasHydrated);
  const [clientHydrated, setClientHydrated] = React.useState(false);
  React.useEffect(() => {
    setClientHydrated(isHydrated);
  }, [isHydrated]);
  return clientHydrated;
}

