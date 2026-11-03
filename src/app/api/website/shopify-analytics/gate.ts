import { STORE_SHOPIFY_ANALYTICS } from '@/lib/store-config';
import type { Gql } from '@/lib/website/shopify-analytics';

/** The shop's Admin API caller, or null where the house has no Shopify analytics (variable off or no credentials). */
export async function shopifyGate(): Promise<{ gql: Gql } | null> {
  const shop = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const token = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  if (!STORE_SHOPIFY_ANALYTICS || !shop || !token) return null;
  const { shopifyGraphQL } = await import('@/app/api/shopify/_lib');
  return { gql: (query, variables) => shopifyGraphQL(shop, token, query, variables) };
}
