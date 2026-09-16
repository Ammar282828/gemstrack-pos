
"use client";

import React, { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { BoardSkeleton } from '@/components/shared/skeletons';

export function MainApp({ children }: { children: React.ReactNode }) {
  const isStoreHydrated = useIsStoreHydrated();
  const {
    loadSettings, isSettingsLoading, hasSettingsLoaded,
    loadProducts,
  } = useAppStore();

  // Auto-fetch gold rates from gold.pk once per day
  // No automatic gold-rate fetch. A hook here used to scrape gold.pk once per
  // device per day and overwrite the shop's rates in Settings, so the number
  // somebody had set at the counter that morning could change under them by
  // lunchtime, on whichever phone happened to open the app next. The rates are
  // now whatever was last entered, and change only when somebody changes them.
  // Settings still has a button to pull gold.pk's figures on purpose.

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
  // The sidebar is already on screen (AppLayout wraps this); what waits is the page.
  // A placeholder in the page's own shape, rather than a spinner in the middle of
  // nothing, so the layout does not jump when the data lands.
  if (!isStoreHydrated || isSettingsLoading) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <BoardSkeleton tiles={3} panels={3} />
      </div>
    );
  }

  // Once settings are loaded, render the children.
  return <>{children}</>;
}
