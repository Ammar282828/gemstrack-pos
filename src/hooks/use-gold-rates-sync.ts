import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';

const STORAGE_KEY = 'gemstrack-gold-rates-last-fetched';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Runs once per device per day (tracked via localStorage).
 * Fetches current gold rates from /api/gold-rates (which scrapes gold.pk)
 * and updates Firestore settings if successful.
 */
export function useGoldRatesSync() {
  const { updateSettings, hasSettingsLoaded } = useAppStore(s => ({
    updateSettings: s.updateSettings,
    hasSettingsLoaded: s.hasSettingsLoaded,
  }));
  const { toast } = useToast();
  const hasFetched = useRef(false);

  useEffect(() => {
    if (!hasSettingsLoaded || hasFetched.current) return;

    // Check localStorage – skip if fetched within the last 24h
    const lastFetched = localStorage.getItem(STORAGE_KEY);
    if (lastFetched) {
      const elapsed = Date.now() - new Date(lastFetched).getTime();
      if (elapsed < ONE_DAY_MS) return;
    }

    hasFetched.current = true;

    const fetchRates = async () => {
      try {
        const res = await fetch('/api/gold-rates');
        if (!res.ok) return;

        const data = await res.json();
        if (!data.goldRatePerGram24k) return;

        await updateSettings({
          goldRatePerGram24k: data.goldRatePerGram24k,
          goldRatePerGram22k: data.goldRatePerGram22k,
          goldRatePerGram21k: data.goldRatePerGram21k,
          goldRatePerGram18k: data.goldRatePerGram18k,
          goldRatesLastFetchedAt: data.fetchedAt,
        });

        localStorage.setItem(STORAGE_KEY, data.fetchedAt);

        toast({
          title: 'Gold rates updated',
          description: `24k: PKR ${data.goldRatePerGram24k.toLocaleString()}/g · 22k: PKR ${data.goldRatePerGram22k.toLocaleString()}/g · 21k: PKR ${data.goldRatePerGram21k.toLocaleString()}/g`,
        });
      } catch (e) {
        // Silently fail – rates just remain unchanged from last sync
        console.warn('[useGoldRatesSync] Could not fetch gold rates:', e);
      }
    };

    fetchRates();
  }, [hasSettingsLoaded, updateSettings, toast]);
}
