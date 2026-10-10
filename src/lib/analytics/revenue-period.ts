/** Dashboard revenue for a period: sales at their source-order date, open booked orders and other income. */
import type { AdditionalRevenue, Invoice, Order } from '@/lib/store';
import { invoiceSaleValue } from './sale-value';
import { bookedAsSale } from '@/lib/order-stage';
import { revenueDate } from '@/lib/reports/monthly';

export function revenueForPeriod(rows: { invoices: Invoice[]; orders: Order[]; extraRevenues: AdditionalRevenue[] }, from: Date, to = new Date(8.64e15)): number {
  const within = (iso: string | undefined) => {
    if (!iso) return false;
    const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+05:00` : iso).getTime();
    return at >= from.getTime() && at < to.getTime();
  };
  const ordersById = new Map(rows.orders.map(o => [o.id, o]));
  return rows.invoices.filter(i => i.status !== 'Refunded' && within(revenueDate(i, ordersById))).reduce((sum, i) => sum + invoiceSaleValue(i), 0)
    + rows.orders.filter(o => bookedAsSale(o) && within(o.createdAt)).reduce((sum, o) => sum + (Number(o.subtotal) || 0), 0)
    + rows.extraRevenues.filter(r => within(r.date)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}
