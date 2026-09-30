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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { STORE_META_ADS, STORE_WEBSITE_SELLING } from '@/lib/store-config';

export default function IntegrationsSettingsPage() {
  return (
    <PageShell subtitle="The website, Shopify and Meta.">
      {STORE_WEBSITE_SELLING && <WebsiteSettings />}
      <ShopifyCard />
      {STORE_META_ADS && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2"><Megaphone className="h-5 w-5" />Meta</CardTitle>
            <CardDescription>The Facebook login, ad account, Page, Instagram and website pixel are set up under Ads.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SettingsLink href="/ads/setup" icon={Megaphone} title="Ads › Setup" description="Connect Meta, choose the ad account and Page, the pixel." />
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Labels and tags are under <Link href="/settings/printer" className="underline">Stock › Labels</Link>.</p>
    </PageShell>
  );
}
