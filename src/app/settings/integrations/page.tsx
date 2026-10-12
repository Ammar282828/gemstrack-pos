"use client";

/**
 * Settings → Integrations: selling on the house's website (where it sells at a live rate), its
 * Shopify store (where one is configured), and Meta — whose setup is Ads → Setup.
 */
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { WebsiteSettings } from '@/components/settings/website-settings';
import { ShopifyCard, SettingsLink } from '@/components/settings/settings-sections';
import { LedgerSection } from '@/components/ledger';
import { STORE_META_ADS, STORE_WEBSITE_SELLING } from '@/lib/store-config';

export default function IntegrationsSettingsPage() {
  return (
    <PageShell subtitle="The website, Shopify and Meta." className="space-y-[22px]">
      {STORE_WEBSITE_SELLING && <WebsiteSettings />}
      <ShopifyCard />
      {STORE_META_ADS && (
        <LedgerSection title="Meta" footer="The Facebook login, ad account, Page, Instagram and website pixel are set up under Ads.">
          <SettingsLink href="/ads/setup" icon={Megaphone} title="Ads › Setup" description="Connect Meta, choose the ad account and Page, the pixel." />
        </LedgerSection>
      )}
      <p className="text-xs text-muted-foreground">Labels and tags are under <Link href="/settings/printer" className="underline">Stock › Labels</Link>.</p>
    </PageShell>
  );
}
