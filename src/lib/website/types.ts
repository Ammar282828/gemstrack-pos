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
  /** A great house's own piece (The Maisons on taheri.shop): "Cartier". */
  house?: string;
  /** Shown in The Maisons on taheri.shop, house named or not: its price is asked for. */
  maison?: boolean;
  /** The piece's own name and page on the site (catalog-attributes.json), for the order's lines. */
  name?: string;
  path?: string;
}

export type QuoteReason = 'unknown_piece' | 'not_configured' | 'no_weight' | 'diamond_enquire' | 'maison_enquire' | 'metal_enquire';

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

/**
 * awaiting_transfer → slip_sent (the customer sent a slip; the shop checks it) → transfer_received.
 * `expired`: the hold ran out with no transfer and no slip (the order is Cancelled).
 */
export type WebsitePaymentStatus = 'awaiting_transfer' | 'slip_sent' | 'transfer_received' | 'refunded' | 'expired';

/** A transfer slip the customer sent from their order page; the file is in `website_slips/{id}`. */
export interface WebsiteSlip {
  id: string;
  at: string;
  contentType: string;
  bytes: number;
  reference?: string;
  amount?: number;
  fromBank?: string;
}

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
  /** The Firebase uid of the signed-in customer who placed it, if any. */
  customerUid?: string;
  /**
   * Today's price is held until then for the transfer (WEBSITE_HOLD_HOURS, 24 by default): past it,
   * with no transfer and no slip, the order lapses (sweep.ts) — gold moves, and a price is a promise.
   */
  holdUntil?: string;
  /** The reminder went (a few hours before the hold ends). */
  remindedAt?: string;
  expiredAt?: string;
  /** Slips the customer sent, newest last. */
  slips?: WebsiteSlip[];
  /** Ring or bangle size per piece key, as chosen on the site. */
  sizes?: Record<string, string>;
  /** The online order this was confirmed from (`online_orders/{onlineId}`): the customer's reference. */
  onlineId?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  /** What the customer pays: the pieces and the delivery. The order's own `grandTotal` is the ERP's balance. */
  total?: number;
  /** The shop was told the hold ran out with no transfer in (sweep), once. */
  holdEndedAt?: string;
  /** The delivery charge, booked as extra revenue when the transfer came in. */
  deliveryRevenueId?: string;
  lapsedBy?: string;
}

/**
 * An order from taheri.shop before the shop has looked at it (`online_orders/{ONL-…}`).
 *
 * Every online order is confirmed by a person first (the owner, 2026-10-04: "they will always need
 * to be confirmed before they get fully integrated"). Until then it is only here: no ORD- number,
 * no customer, no product, nothing in the book, the karigars' lists or Analytics; the customer has
 * no bank details yet, so no money can move. Confirming makes the ORD- order (labelled Online),
 * sends the bank details and starts the price hold; declining tells the customer why.
 */
export type OnlineOrderState = 'to_confirm' | 'confirming' | 'confirmed' | 'declined';

export interface OnlineOrder {
  id: string;
  state: OnlineOrderState;
  /** Shared with the ORD- order once confirmed; the customer's link presents it. */
  token: string;
  bagId: string;
  placedAt: string;
  customer: { name: string; phone: string; email?: string };
  delivery: { address: string; city: string; notes?: string };
  customerUid?: string;
  lines: { key: string; description: string; price: number; image: string; size?: string }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  /** The rates the quote was struck at: the order is stamped with them, so it prices as the customer was told. */
  rates: Record<string, number>;
  /** What confirming writes: the product records and the order, built when it was placed. */
  draft: { products: Record<string, unknown>[]; order: Record<string, unknown> };
  claimedAt?: string;
  claimedBy?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  orderId?: string;
  holdUntil?: string;
  declinedAt?: string;
  declinedBy?: string;
  declineReason?: string;
  /** The shop was reminded it is waiting (sweep), once. */
  shopNudgedAt?: string;
  notify?: Record<string, string | null>;
}

/** What the shop's inbox shows of one: the order without its draft, and what it would cost today. */
export interface OnlineOrderRow extends Omit<OnlineOrder, 'draft' | 'rates'> {
  statusUrl: string;
  /** The same pieces at today's rate, when the shop is selling; null when not. */
  todayTotal: number | null;
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
  /** The customer's reference: the online order's ONL- number (an ORD- number only for an order placed before confirming existed). */
  id: string;
  /** to_confirm: the shop has not looked yet; no bank details. declined: with the reason. */
  confirmation: 'to_confirm' | 'confirmed' | 'declined';
  declineReason?: string;
  /** The shop's order number once confirmed. */
  ref?: string;
  placedAt: string;
  status: string;
  paymentStatus: WebsitePaymentStatus;
  items: { description: string; price: number; image: string; path?: string; size?: string }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  /** Only once the order is confirmed: nobody pays for an order the shop has not accepted. */
  bank: WebsiteBankDetails | null;
  deliveryTo: { name: string; city: string };
  courier?: { cn: string; trackingUrl: string; deliveredAt?: string };
  /** Until when today's price is held for the transfer. */
  holdUntil?: string;
  /** The last slip the customer sent: when, and what they typed. Never the file. */
  slip?: { at: string; reference?: string; amount?: number; count: number };
  /** The shop's WhatsApp number, for "send us a message" on the page. */
  whatsapp?: string | null;
}
