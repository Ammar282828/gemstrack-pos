
"use client";

import React, { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { AuthorizationProvider } from '@/components/auth/authorization-provider';
import { Loader2 } from 'lucide-react';

export function MainApp({ children }: { children: React.ReactNode }) {
  const isStoreHydrated = useIsStoreHydrated();
  const { 
    loadSettings, isSettingsLoading, hasSettingsLoaded
  } = useAppStore();

  useEffect(() => {
    // This effect runs once when the store is rehydrated.
    // It now ONLY loads the essential settings needed for startup.
    // Other data will be loaded on-demand by the pages that need it.
    if (isStoreHydrated && !hasSettingsLoaded) {
      console.log("[GemsTrack MainApp] Store hydrated. Loading essential settings.");
      loadSettings();
    }
  }, [isStoreHydrated, hasSettingsLoaded, loadSettings]);

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
