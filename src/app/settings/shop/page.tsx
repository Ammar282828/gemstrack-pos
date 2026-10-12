"use client";

/** Settings → Shop details: the Shop form on its own page. A phone reaches it from the Settings index (/settings). */

import { PageShell } from '@/components/shared/page-shell';
import { STORE_CONFIG } from '@/lib/store-config';
import { useAppStore } from '@/lib/store';
import { ShopSettingsForm } from '@/components/settings/shop-form';
import 'react-phone-number-input/style.css';

export default function ShopSettingsPage() {
  const currentSettings = useAppStore(state => state.settings);
  return (
    <PageShell subtitle={currentSettings.shopName || STORE_CONFIG.name}>
      <ShopSettingsForm />
    </PageShell>
  );
}
