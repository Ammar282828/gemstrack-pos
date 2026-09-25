/**
 * Gold coins are not jewellery, and the analytics were treating them as if they were.
 *
 * A coin sells within a point or two of the metal price. A ring carries the shop's
 * making and its margin. Put them through the same figures and a good coin week reads
 * as a good jewellery week: revenue up, "estimated profit" up by the jewellery margin
 * on money that earned a fraction of it, average order value dragged wherever the coin
 * price sits, and Gold Coins topping the category chart because a single 10g coin
 * outweighs a tray of rings. None of that tells the shop anything about the shop.
 *
 * So invoices are split here, once, before anything counts them. Everything the
 * analytics page already computed now sees only the jewellery side; the coin side gets
 * its own section with its own figures, and the two never meet.
 *
 * ON MIXED INVOICES. A coin is almost always its own invoice, and for that case the
 * split is exact: the whole document goes to one side. When a coin and a ring share a
 * bill, the document's money -- grand total, discount, what was paid, what is owed --
 * cannot be attributed line by line, so it is divided in proportion to the line totals.
 * That is an approximation and it is the honest one: the alternative was leaving the
 * coin in the jewellery figures, which is not an approximation, it is just wrong.
 */

import type { Invoice, InvoiceItem, Payment } from '@/lib/store';

/** The category id of "Gold Coins" in src/lib/categories.ts. */
export const GOLD_COIN_CATEGORY = 'cat017';

export const isCoinItem = (item: Pick<InvoiceItem, 'categoryId'> | null | undefined): boolean =>
  !!item && item.categoryId === GOLD_COIN_CATEGORY;

const itemsOf = (inv: Invoice): InvoiceItem[] =>
  Array.isArray(inv.items) ? inv.items : Object.values((inv.items || {}) as Record<string, InvoiceItem>);

const total = (items: InvoiceItem[]) => items.reduce((s, i) => s + (Number(i?.itemTotal) || 0), 0);

/** One side of a split invoice, with its money scaled to its share of the lines. */
function side(inv: Invoice, items: InvoiceItem[], share: number): Invoice {
  if (share >= 1) return inv;
  const scale = (n: unknown) => Math.round((Number(n) || 0) * share * 100) / 100;
  const paymentHistory: Payment[] | undefined = Array.isArray(inv.paymentHistory)
    ? inv.paymentHistory.map(p => ({ ...p, amount: scale(p?.amount) }))
    : inv.paymentHistory;
  return {
    ...inv,
    items,
    subtotal: scale(inv.subtotal),
    discountAmount: scale(inv.discountAmount),
    grandTotal: scale(inv.grandTotal),
    amountPaid: scale(inv.amountPaid),
    balanceDue: scale(inv.balanceDue),
    paymentHistory: paymentHistory as Payment[],
    ...(Array.isArray(inv.exchanges) && { exchanges: inv.exchanges.map(e => ({ ...e, value: scale(e?.value) })) }),
    ...(inv.exchangeAmount1 != null && { exchangeAmount1: scale(inv.exchangeAmount1) }),
    ...(inv.exchangeAmount2 != null && { exchangeAmount2: scale(inv.exchangeAmount2) }),
  };
}

export interface CoinSplit {
  /** The invoice with its coins removed, or null if it was nothing but coins. */
  jewellery: Invoice | null;
  /** The invoice reduced to its coins, or null if it had none. */
  coins: Invoice | null;
}

export function splitCoinSales(inv: Invoice): CoinSplit {
  const items = itemsOf(inv);
  const coinItems = items.filter(isCoinItem);
  if (coinItems.length === 0) return { jewellery: inv, coins: null };
  const jewelItems = items.filter(i => !isCoinItem(i));
  if (jewelItems.length === 0) return { jewellery: null, coins: inv };

  const coinTotal = total(coinItems);
  const jewelTotal = total(jewelItems);
  const all = coinTotal + jewelTotal;
  // Lines with no money on them cannot be apportioned by money; fall back to a headcount.
  const coinShare = all > 0 ? coinTotal / all : coinItems.length / items.length;

  return {
    jewellery: side(inv, jewelItems, 1 - coinShare),
    coins: side(inv, coinItems, coinShare),
  };
}

/** Every invoice split, in one pass, keeping order. */
export function splitAllCoinSales(invoices: Invoice[]): { jewellery: Invoice[]; coins: Invoice[] } {
  const jewellery: Invoice[] = [];
  const coins: Invoice[] = [];
  for (const inv of invoices) {
    if (!inv) continue;
    const s = splitCoinSales(inv);
    if (s.jewellery) jewellery.push(s.jewellery);
    if (s.coins) coins.push(s.coins);
  }
  return { jewellery, coins };
}

/** What the coin section reports. Weight is what a coin buyer asks about first. */
export interface CoinSummary {
  invoices: number;
  coins: number;
  grams: number;
  revenue: number;
  /** Revenue over grams — what the shop actually realised per gram, all-in. */
  ratePerGram: number;
  outstanding: number;
}

export function summariseCoins(coinInvoices: Invoice[]): CoinSummary {
  let coins = 0, grams = 0, revenue = 0, outstanding = 0;
  for (const inv of coinInvoices) {
    if (!inv || inv.status === 'Refunded') continue;
    revenue += Number(inv.grandTotal) || 0;
    outstanding += Math.max(0, Number(inv.balanceDue) || 0);
    for (const it of itemsOf(inv)) {
      const q = Number(it?.quantity) || 1;
      coins += q;
      grams += (Number(it?.metalWeightG) || 0) * q;
    }
  }
  return {
    invoices: coinInvoices.filter(i => i && i.status !== 'Refunded').length,
    coins, grams, revenue, outstanding,
    ratePerGram: grams > 0 ? revenue / grams : 0,
  };
}
