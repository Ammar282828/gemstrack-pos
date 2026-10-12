"use client";

/**
 * /settings. On a phone it is the index list the app has (who is signed in, a row for each place,
 * Sign out; SettingsIndex) and the Shop form is /settings/shop; from md up it is the Shop form
 * itself, with the tabs above (docs/features/web-matches-app.md d.6).
 */

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/shared/page-shell';
import { STORE_CONFIG } from '@/lib/store-config';
import { useAppStore } from '@/lib/store';
import { useIsMobile } from '@/hooks/use-mobile';
import { openRateSheet } from '@/components/rates/rate-chip';
import { ShopSettingsForm } from '@/components/settings/shop-form';
import { SettingsIndex } from '@/components/settings/settings-index';
import 'react-phone-number-input/style.css';

export default function SettingsPage() {
  const currentSettings = useAppStore(state => state.settings);
  const isMobile = useIsMobile();

  // Settings' tabs are routes now; an old ?tab= link lands where that tab went (the rates open the
  // top bar's rate sheet, which is where they live now).
  const router = useRouter();
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (!tab || tab === 'shop') return;
    if (tab === 'rates') { openRateSheet(); router.replace('/settings'); return; }
    const to: Record<string, string> = { notifications: '/settings/alerts', alerts: '/settings/alerts', integrations: '/settings/integrations', data: '/settings/data', security: '/activity-log' };
    router.replace(to[tab] ?? '/settings');
  }, [router]);

  return (
    <PageShell subtitle={<>
      {currentSettings.shopName || STORE_CONFIG.name}
      {currentSettings.firebaseConfig?.projectId && (
        <> · <span className="font-mono text-xs">{currentSettings.firebaseConfig.projectId}</span></>
      )}
    </>}>
      {/* The index is CSS-hidden from md; the form mounts only where it is shown (one instance). */}
      <SettingsIndex className="md:hidden" />
      {isMobile === false && <ShopSettingsForm />}
    </PageShell>
  );
}
