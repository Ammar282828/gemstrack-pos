/**
 * A year and a bit of an invented shop, for the report's tests and for drawing the PDF by hand
 * (`npx tsx scripts/monthly-sample.ts`). Nothing here is a real customer or sale.
 */

import type { AdditionalRevenue, Expense, Invoice, Order } from '@/lib/store';
import type { MonthlyInput } from './monthly';

const CATS = ['cat001', 'cat002', 'cat003', 'cat004', 'cat017'];
const NAMES = ['Ring', 'Bangle', 'Pendant', 'Earrings', 'Gold coin'];
const WHO = ['Sakina', 'Batool', 'Zainab', 'Hussain', 'Fatima', 'Ali Raza', 'Maryam'];
const METHODS = ['Cash', 'Bank Transfer', 'Card', 'Cash', 'Easypaisa'];

const iso = (y: number, m: number, d: number, h = 8) => new Date(Date.UTC(y, m - 1, d, h)).toISOString();

export function sampleShop(from = { year: 2025, month: 6 }, months = 17): MonthlyInput {
  const invoices: Invoice[] = [], orders: Order[] = [], expenses: Expense[] = [], extraRevenues: AdditionalRevenue[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let k = 0;
  for (let i = 0; i < months; i++) {
    const idx = from.year * 12 + from.month - 1 + i;
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    const growth = 1 + i * 0.05;
    const sales = 14 + Math.floor(rnd() * 8);
    for (let s = 0; s < sales; s++) {
      const c = Math.floor(rnd() * CATS.length), day = 1 + Math.floor(rnd() * 27);
      const total = Math.round((90_000 + rnd() * 310_000) * growth / 1000) * 1000;
      const paid = rnd() > 0.2 ? total : Math.round(total * 0.5);
      k++;
      invoices.push({
        id: `INV-${String(k).padStart(6, '0')}`, customerName: WHO[Math.floor(rnd() * WHO.length)], customerId: undefined,
        items: [{ sku: `${CATS[c]}-${s % 4}`, name: `${NAMES[c]} ${s % 4 + 1}`, categoryId: CATS[c], metalType: 'gold', karat: c === 4 ? '24k' : '21k', metalWeightG: 3 + c, stoneWeightG: 0, quantity: 1, unitPrice: total, itemTotal: total }],
        subtotal: total, discountAmount: 0, grandTotal: total, amountPaid: paid, balanceDue: total - paid, createdAt: iso(y, m, day),
        costRate24k: rnd() > 0.5 ? 25_000 : undefined, ratesApplied: {},
        paymentHistory: [{ amount: paid, date: iso(y, m, day), method: METHODS[Math.floor(rnd() * METHODS.length)] }],
      } as unknown as Invoice);
    }
    for (let o = 0; o < 4; o++) {
      const status = (['Pending', 'In Progress', 'Completed', 'Cancelled'] as const)[Math.floor(rnd() * 4)];
      orders.push({
        id: `ORD-${String(i * 10 + o).padStart(6, '0')}`, createdAt: iso(y, m, 1 + Math.floor(rnd() * 27)), status, items: [],
        subtotal: Math.round((150_000 + rnd() * 400_000) * growth / 1000) * 1000, advancePayment: 50_000, grandTotal: 0,
        customerName: WHO[Math.floor(rnd() * WHO.length)], summary: 'Custom set', advances: [{ amount: 50_000, date: iso(y, m, 3), method: 'Cash' }],
      } as unknown as Order);
    }
    for (const [cat, amt] of [['Rent', 150_000], ['Salaries', 400_000 + i * 5_000], ['Karigar payments', 200_000 * growth], ['Utilities', 45_000]] as const) {
      expenses.push({ id: `e${i}${cat}`, date: iso(y, m, 5), category: cat, description: cat, amount: Math.round(amt) } as Expense);
    }
    extraRevenues.push({ id: `x${i}`, date: iso(y, m, 11), description: 'Repair', amount: 6_000 } as AdditionalRevenue);
  }
  return { invoices, orders, expenses, extraRevenues };
}
