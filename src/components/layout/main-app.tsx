
"use client";

import React, { useEffect } from 'react';
import { useAppStore, useIsStoreHydrated } from '@/lib/store';
import { AuthorizationProvider } from '@/components/auth/authorization-provider';
import { Loader2 } from 'lucide-react';

export function MainApp({ children }: { children: React.ReactNode }) {
  const isStoreHydrated = useIsStoreHydrated();
  const { 
    loadSettings, isSettingsLoading,
    loadProducts, loadCustomers, loadKarigars, loadOrders, loadGeneratedInvoices 
  } = useAppStore();

  useEffect(() => {
    // This effect runs once when the store is rehydrated.
    // It kicks off all the initial data loading processes for the entire app.
    if (isStoreHydrated) {
      console.log("[GemsTrack MainApp] Store hydrated. Kicking off all initial data loads.");
      loadSettings();
      loadProducts();
      loadCustomers();
      loadKarigars();
      loadOrders();
      loadGeneratedInvoices();
    }
  }, [isStoreHydrated, loadSettings, loadProducts, loadCustomers, loadKarigars, loadOrders, loadGeneratedInvoices]);

  // Show a loading screen until the persisted state is rehydrated AND settings have loaded.
  // Settings are required for authorization and basic app functionality.
  if (!isStoreHydrated || isSettingsLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="text-center">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
            <p className="text-xl text-muted-foreground">Loading Application...</p>
        </div>
      </div>
    );
  }

  // Once settings are loaded, perform authorization check and then render the children.
  return (
    <AuthorizationProvider>
      {children}
    </AuthorizationProvider>
  );
}
