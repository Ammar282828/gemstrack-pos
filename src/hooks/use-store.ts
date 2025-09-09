
"use client";

import { useSyncExternalStore } from 'react';
import { useAppStore } from '@/lib/store';

function useZustandRehydrated() {
    const hasHydrated = useSyncExternalStore(
        useAppStore.subscribe,
        () => useAppStore.getState()._hasHydrated,
        () => false
    );
    return hasHydrated;
}

export const useAppReady = () => {
    const isSettingsLoaded = !useAppStore(state => state.isSettingsLoading);
    const isZustandRehydrated = useZustandRehydrated();
    return isZustandRehydrated && isSettingsLoaded;
};

// Hook to check hydration status, useful for client-side only rendering logic or avoiding hydration mismatches.
export const useIsStoreHydrated = () => {
    return useSyncExternalStore<boolean>(
        useAppStore.subscribe,
        () => useAppStore.getState()._hasHydrated,
        () => false
    );
};
