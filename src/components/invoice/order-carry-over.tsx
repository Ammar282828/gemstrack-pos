"use client";

/**
 * On an invoice made from an order, what the order settled (the owner, 2026-09-25: "invoice
 * page should show all details from the order like advance / exchange details"): the order,
 * who took it and when, each advance with its day and how it was paid, each thing taken in
 * exchange, and the discount agreed.
 *
 * Read from the order itself, so an invoice finalised before advances and exchange were
 * carried separately (one "Advance from Order" payment that included the exchange) still
 * shows the real breakdown — and says why its payment reads the way it does.
 */

import React, { useEffect } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ClipboardList } from 'lucide-react';
import { useAppStore, type Invoice } from '@/lib/store';
import { orderAdvancePayments } from '@/lib/order-payment';
import { orderExchanges, invoiceExchanges, describeExchangeEntry, exchangeTotal } from '@/lib/exchange';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const day = (iso?: string) => { try { return iso ? format(parseISO(iso), 'd MMM yyyy') : ''; } catch { return ''; } };

export function OrderCarryOver({ invoice }: { invoice: Invoice }) {
  const orderId = invoice.sourceOrderId;
  const orders = useAppStore((s) => s.orders);
  const loadOrders = useAppStore((s) => s.loadOrders);
  useEffect(() => { if (orderId) loadOrders(); }, [orderId, loadOrders]);
  if (!orderId) return null;

  const order = orders.find((o) => o.id === orderId);
  const advances = order ? orderAdvancePayments(order, '') : [];
  const exchanges = order ? orderExchanges(order) : invoiceExchanges(invoice);
  const takenBy = order?.takenBy || invoice.takenBy;
  const discount = Number(order?.discountAmount) || 0;
  // Finalised before 2026-09-25: the exchange went in as part of one advance payment.
  const lumped = !invoice.exchanges?.length && exchangeTotal(exchanges) > 0
    && (invoice.paymentHistory || []).some((p) => p.notes?.startsWith('Advance from Order'));

  const facts: [string, string][] = [];
  if (order?.createdAt) facts.push(['Placed', day(order.createdAt)]);
  if (takenBy) facts.push(['Taken by', takenBy]);
  if (order?.promisedDate) facts.push(['Promised', day(order.promisedDate)]);
  if (discount > 0) facts.push(['Discount agreed', pkr(discount)]);

  return (
    <section aria-label={`From order ${orderId}`} className="rounded-md border bg-muted/30 p-4 text-sm space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold flex items-center">
          <ClipboardList className="mr-2 h-4 w-4" />
          From order{' '}
          <Link href={`/orders/${orderId}`} className="ml-1 font-mono text-primary hover:underline">{orderId}</Link>
        </p>
        {!order && <span className="text-xs text-muted-foreground">Loading the order…</span>}
      </div>

      {facts.length > 0 && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {advances.length > 0 && (
        <div>
          <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-1">Advances on the order</p>
          <ul className="divide-y rounded border bg-background">
            {advances.map((a, i) => {
              const note = a.notes?.replace(/^: /, '').trim();
              return (
                <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{day(a.date)}</span>
                    {a.method && <span className="text-muted-foreground"> · {a.method}{a.reference ? ` ${a.reference}` : ''}</span>}
                    {note && <span className="block text-xs text-muted-foreground whitespace-pre-wrap break-words">{note}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{pkr(a.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {exchanges.length > 0 && (
        <div>
          <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-1">Taken in exchange</p>
          <ul className="divide-y rounded border bg-background">
            {exchanges.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="min-w-0 whitespace-pre-wrap break-words">{describeExchangeEntry(e)}</span>
                <span className="shrink-0 tabular-nums">{pkr(e.value)}</span>
              </li>
            ))}
          </ul>
          {lumped && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              This invoice was finalised before exchange gold was carried separately, so its advance payment below includes
              the exchange value.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
