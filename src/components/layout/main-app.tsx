
"use client";

import React, { useEffect } from 'react';
import { useAppStore, useIsStoreHydrated } from '@/lib/store';
import { AuthorizationProvider } from '@/components/auth/authorization-provider';
import { Loader2 } from 'lucide-react';

export function MainApp({ children }: { children: React.ReactNode }) {
  const isStoreHydrated = useIsStoreHydrated();
  const fetchAllInitialData = useAppStore(state => state.fetchAllInitialData);
  const isInitialDataLoaded = useAppStore(state => state.isInitialDataLoadedFromFirestore);

  useEffect(() => {
    // Only fetch data if the store is hydrated from local storage and data hasn't been loaded from Firestore yet.
    if (isStoreHydrated && !isInitialDataLoaded) {
      console.log("[GemsTrack MainApp] Hydrated and ready, fetching initial data from Firestore.");
      fetchAllInitialData();
    }
  }, [isStoreHydrated, isInitialDataLoaded, fetchAllInitialData]);

  // Show a loading screen until the persisted state is rehydrated AND all initial data from Firestore is ready.
  if (!isStoreHydrated || !isInitialDataLoaded) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="text-center">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
            <p className="text-xl text-muted-foreground">Loading Application...</p>
        </div>
      </div>
    );
  }

  // Once data is loaded, perform authorization check and then render the children (the actual page).
  return (
    <AuthorizationProvider>
      {children}
    </AuthorizationProvider>
  );
}
