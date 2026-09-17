/**
 * Selling from taheri.shop.
 *
 * The public site is a static catalogue of photographs; it holds no prices and
 * no stock. When a visitor buys, the POS is the only party that knows what a
 * piece costs today — weight × the rate for its karat, plus the shop's making
 * and wastage — and the only party that may say so. So the site asks, the POS
 * quotes, and at checkout the POS creates the product and the order together.
 * Nothing exists in inventory until somebody has bought it.
 *
 * Everything the shop decides about selling online lives in one document,
 * `app_settings/website`, described by WebsiteConfig below. Until it is set
 * and switched on, the site shows no prices at all: the numbers are the
 * shop's, not the code's.
 */

import type { KaratValue, MetalType } from '@/lib/materials';

export const WEBSITE_CONFIG_DOC = 'website';

/** What a kind of piece is charged on top of its gold, before today's rate. */
export interface WebsiteCategoryPricing {
  karat: KaratValue;
  wastagePercentage: number;
  /** Rupees per gram of metal weight. Making is a per-gram convention here. */
  makingChargesPerGram: number;
  /** Flat charge for pieces the tagger saw coloured stones or pearls on. */
  stoneChargesDefault: number;
}

/**
 * Where the customer sends the money. Read from the server's environment —
 * NEXT_PUBLIC_STORE_BANK_LINE ("Meezan Bank — Taheri Jewellers"), and
 * NEXT_PUBLIC_STORE_IBAN — and never from a document, so that no one who can
 * write to the database can redirect a payment. See config.ts bankDetails().
 */
export interface WebsiteBankDetails {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  /** Free text shown under the account details, e.g. "Send the slip on WhatsApp". */
  instructions?: string;
}

export interface WebsiteConfig {
  /** Master switch. Off: no prices, no bag, checkout refuses. */
  enabled: boolean;
  currency: 'PKR';
  /** Applies to any collection without its own row below. */
  defaultPricing: WebsiteCategoryPricing;
  /** Keyed by the site's collection folder name — "Rings", "Diamond Rings", "Bangles". */
  categoryPricing: Record<string, Partial<WebsiteCategoryPricing>>;
  /**
   * Diamond-set pieces. Pricing a diamond ring by its gold weight understates
   * it, so the default is to keep those as enquiries. 'gold_only' prices the
   * metal and adds diamondChargesDefault on top.
   */
  diamondPolicy: 'enquire' | 'gold_only';
  diamondChargesDefault: number;
  /** Palladium is sold at 12k and 18k here; the catalogue does not say which. */
  palladiumKarat: '18k' | '12k';
  /** Flat delivery charge in rupees. Leopards is booked by the shop after payment. */
  deliveryCharge: number;
  freeDeliveryOver?: number;
  /** The POS category new website products are filed under. */
  posCategoryId: string;
  updatedAt?: string;
}

export const DEFAULT_WEBSITE_CONFIG: WebsiteConfig = {
  enabled: false,
  currency: 'PKR',
  defaultPricing: { karat: '21k', wastagePercentage: 0, makingChargesPerGram: 0, stoneChargesDefault: 0 },
  categoryPricing: {},
  diamondPolicy: 'enquire',
  diamondChargesDefault: 0,
  palladiumKarat: '18k',
  deliveryCharge: 0,
  posCategoryId: '',
};

/** One entry of the site's catalog-attributes manifest, as published at /catalog-attributes.json. */
export interface PieceAttrs {
  metal: string;
  stone: string;
  cut: string;
  style: string;
  weightGrams?: number;
}

export type QuoteReason = 'unknown_piece' | 'not_configured' | 'no_weight' | 'diamond_enquire';

export interface QuoteBreakdown {
  metalType: MetalType;
  karat: KaratValue;
  weightGrams: number;
  ratePerGram: number;
  metalCost: number;
  wastagePercentage: number;
  wastageCost: number;
  makingCharges: number;
  stoneCharges: number;
  diamondCharges: number;
}

export interface Quote {
  /** The site's piece key: the decoded path under catalog-thumb, e.g. "Rings & Bands/Rings/Ring 12.webp". */
  key: string;
  collection: string;
  priceable: boolean;
  reason?: QuoteReason;
  /** Whole rupees. */
  price?: number;
  breakdown?: QuoteBreakdown;
}

export type WebsitePaymentStatus = 'awaiting_transfer' | 'transfer_received' | 'refunded';

/** Stored on the order under `website`, alongside the POS's own fields. */
export interface WebsiteOrderMeta {
  /** Random, unguessable; the customer's status page presents it. Not a password. */
  token: string;
  paymentMethod: 'bank_transfer';
  paymentStatus: WebsitePaymentStatus;
  /** Piece keys, in bag order, so the order can be traced back to the photographs. */
  pieces: string[];
  deliveryCharge: number;
  /** When the quote was struck; the rates applied are on the order itself. */
  quotedAt: string;
  placedAt: string;
  paidAt?: string;
  customerPhone?: string;
  customerEmail?: string;
}

export interface LeopardsMeta {
  cn: string;
  bookedAt: string;
  trackingUrl: string;
  /** True when the CN was typed in by hand rather than returned by the API. */
  manual?: boolean;
  deliveredAt?: string;
}

/** What the customer's status page is allowed to see. Nothing else leaves the POS. */
export interface PublicOrderView {
  id: string;
  placedAt: string;
  status: string;
  paymentStatus: WebsitePaymentStatus;
  items: { description: string; price: number; image: string }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  bank: WebsiteBankDetails;
  deliveryTo: { name: string; city: string };
  courier?: { cn: string; trackingUrl: string; deliveredAt?: string };
}
