
"use client";

import React, { useEffect } from 'react';
import { useAppStore, useIsStoreHydrated } from '@/lib/store';
import { AuthorizationProvider } from '@/components/auth/authorization-provider';
import { Loader2 } from 'lucide-react';

export function MainApp({ children }: { children: React.ReactNode }) {
  const isStoreHydrated = useIsStoreHydrated();
  const fetchAllInitialData = useAppStore(state => state.fetchAllInitialData);
  const isInitialDataLoadedFromFirestore = useAppStore(state => state.isInitialDataLoadedFromFirestore);

  useEffect(() => {
    // Only fetch data if the store is hydrated and data hasn't been loaded yet.
    if (isStoreHydrated && !isInitialDataLoadedFromFirestore) {
      console.log("[GemsTrack MainApp] Store hydrated, now fetching initial data from Firestore.");
      fetchAllInitialData();
    }
  }, [isStoreHydrated, isInitialDataLoadedFromFirestore, fetchAllInitialData]);

  // Show a loading screen until all initial data from Firestore is ready.
  if (!isInitialDataLoadedFromFirestore) {
    return (
      <div className="flex h-[calc(100vh-8rem)] w-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-12 w-12 animate-spin text-primary mr-3" />
        <p className="text-xl">Loading application data...</p>
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
