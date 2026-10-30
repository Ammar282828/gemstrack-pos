/** Dashboard revenue for a period: sales at their source-order date, open booked orders and other income. */
import type { AdditionalRevenue, Invoice, Order } from '@/lib/store';
import { invoiceSaleValue } from './sale-value';
import { bookedAsSale } from '@/lib/order-stage';
import { revenueDate } from '@/lib/reports/monthly-time';
import { splitAllCoinSales } from './coins';

const makeWithin = (from: Date, to: Date) => (iso: string | undefined) => {
  if (!iso) return false;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+05:00` : iso).getTime();
  return at >= from.getTime() && at < to.getTime();
};

type Rows = { invoices: Invoice[]; orders: Order[]; extraRevenues: AdditionalRevenue[] };

/**
 * Revenue is the jewellery side only: gold coins are split out first, exactly as Analytics does
 * (lib/analytics/coins.ts), so Home's "This month" and Analytics' Revenue are the same figure.
 * An invoice with no createdAt counts nowhere, as in Analytics.
 */
export function revenueForPeriod(rows: Rows, from: Date, to = new Date(8.64e15)): number {
  const within = makeWithin(from, to);
  const ordersById = new Map(rows.orders.map(o => [o.id, o]));
  const { jewellery } = splitAllCoinSales(rows.invoices);
  return jewellery.filter(i => i.createdAt && i.status !== 'Refunded' && within(revenueDate(i, ordersById))).reduce((sum, i) => sum + invoiceSaleValue(i), 0)
    + rows.orders.filter(o => bookedAsSale(o) && within(o.createdAt)).reduce((sum, o) => sum + (Number(o.subtotal) || 0), 0)
    + rows.extraRevenues.filter(r => within(r.date)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/** The gold-coin side over the same period (what Analytics' coin card reports as revenue); shown beside, never added. */
export function coinRevenueForPeriod(rows: Pick<Rows, 'invoices' | 'orders'>, from: Date, to = new Date(8.64e15)): number {
  const within = makeWithin(from, to);
  const ordersById = new Map(rows.orders.map(o => [o.id, o]));
  const { coins } = splitAllCoinSales(rows.invoices);
  return coins.filter(i => i.createdAt && i.status !== 'Refunded' && within(revenueDate(i, ordersById))).reduce((sum, i) => sum + invoiceSaleValue(i), 0);
}
