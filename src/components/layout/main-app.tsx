
"use client";

import React, { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Loader2 } from 'lucide-react';

export function MainApp({ children }: { children: React.ReactNode }) {
  const isStoreHydrated = useIsStoreHydrated();
  const {
    loadSettings, isSettingsLoading, hasSettingsLoaded,
    loadProducts,
  } = useAppStore();

  useEffect(() => {
    // This effect runs once when the store is rehydrated.
    // Loads settings and kicks off the products real-time listener so that
    // products sync across devices from app startup, regardless of which page
    // the user lands on first.
    if (isStoreHydrated) {
      if (!hasSettingsLoaded) {
        console.log("[GemsTrack MainApp] Store hydrated. Loading essential settings.");
        loadSettings();
      }
      // loadProducts is guarded internally by hasProductsLoaded, so calling it
      // here is always safe — subsequent calls from individual pages are no-ops.
      loadProducts();
    }
  }, [isStoreHydrated, hasSettingsLoaded, loadSettings, loadProducts]);

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

  // Once settings are loaded, render the children.
  return <>{children}</>;
}
