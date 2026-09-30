"use client";

/**
 * Analytics → Customers: everyone who bought in the range, by spending, number of sales or
 * average sale. It was a page of its own (/analytics/customers) with its own 30 days; now a
 * section of AnalyticsView under the shared range. Walk-ins count as one row (lib/walk-in.ts).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { lacCrore } from '@/lib/money';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { saleCustomerKey, WALK_IN_ENTITY, WALK_IN_NAME } from '@/lib/walk-in';

type CustomerPerformanceData = { key: string; customerId?: string; customerName: string; totalSpent: number; orderCount: number; itemsPurchased: number; averageSpent: number };
const SORTS = [['totalSpent', 'Spending'], ['orderCount', 'Number of sales'], ['averageSpent', 'Average sale']] as const;

export function CustomerBreakdown({ range: dateRange }: { range: DateRange | undefined }) {
  const { generatedInvoices, customers } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  // A sort, not a third row of tabs (one tab row per screen).
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('totalSpent');

  const filteredInvoices = useMemo(() => {
    // Exclude refunded invoices so they don't inflate customer spend — matches
    // the Analytics overview, which also drops Refunded invoices.
    const base = generatedInvoices.filter(invoice => invoice?.status !== 'Refunded');
    if (!dateRange || !dateRange.from) return base;
    const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
    return base.filter(invoice => {
      if (!invoice?.createdAt) return false;
      const invoiceDate = parseISO(invoice.createdAt);
      return isWithinInterval(invoiceDate, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [generatedInvoices, dateRange]);

  const customerPerformance = useMemo(() => {
    const performanceMap: Record<string, { totalSpent: number; orderCount: number; itemsPurchased: number; resolvedName?: string }> = {};
    const customersById = new Map(customers.map(c => [c.id, c]));

    filteredInvoices.forEach(invoice => {
      if (!invoice) return;
      // The customer, else the stored name (so named customers without a linked account
      // aren't all collapsed into "Walk-in"), else the one walk-in row (lib/walk-in.ts).
      const customerKey = saleCustomerKey(invoice, id => customersById.get(id)?.name);

      if (!performanceMap[customerKey]) {
        performanceMap[customerKey] = { totalSpent: 0, orderCount: 0, itemsPurchased: 0, resolvedName: invoice.customerName || undefined };
      }
      
      performanceMap[customerKey].totalSpent += invoiceSaleValue(invoice);
      performanceMap[customerKey].orderCount += 1;
      performanceMap[customerKey].itemsPurchased += invoice.items.reduce((acc, item) => acc + (item.quantity || 0), 0);
    });

    return Object.entries(performanceMap).map(([key, data]) => {
      if (key === WALK_IN_ENTITY) {
        return { key, customerId: undefined, customerName: WALK_IN_NAME, totalSpent: data.totalSpent, orderCount: data.orderCount, itemsPurchased: data.itemsPurchased, averageSpent: data.orderCount > 0 ? data.totalSpent / data.orderCount : 0 };
      }
      if (key.startsWith('name:')) {
        return { key, customerId: undefined, customerName: key.slice(5), totalSpent: data.totalSpent, orderCount: data.orderCount, itemsPurchased: data.itemsPurchased, averageSpent: data.orderCount > 0 ? data.totalSpent / data.orderCount : 0 };
      }
      const customerDetails = customersById.get(key);
      return {
        key,
        customerId: key,
        customerName: customerDetails?.name || data.resolvedName || WALK_IN_NAME,
        totalSpent: data.totalSpent,
        orderCount: data.orderCount,
        itemsPurchased: data.itemsPurchased,
        averageSpent: data.orderCount > 0 ? data.totalSpent / data.orderCount : 0,
      };
    });
  }, [filteredInvoices, customers]);

  const filteredPerformanceData = useMemo(() => {
    if (!searchTerm) return customerPerformance;
    const lowerCaseSearch = searchTerm.toLowerCase();
    return customerPerformance.filter(c => c.customerName.toLowerCase().includes(lowerCaseSearch));
  }, [customerPerformance, searchTerm]);

  const sorted = useMemo(() => [...filteredPerformanceData].sort((a, b) => b[sort] - a[sort]), [filteredPerformanceData, sort]);

  const renderTable = (data: CustomerPerformanceData[]) => (
    data.length > 0 ? (
        <ScrollArea className="h-[65vh]">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Spent (PKR)</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Pieces</TableHead>
                    <TableHead className="text-right">Average sale</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map(c => (
                    <TableRow key={c.key}>
                        <TableCell>
                            {c.customerId ? (
                                <Link href={`/customers/${c.customerId}`} className="font-medium text-primary hover:underline">
                                    {c.customerName}
                                </Link>
                            ) : (
                                <div className="font-medium">{c.customerName}</div>
                            )}
                            {c.customerId && <div className="text-xs text-muted-foreground">{c.customerId}</div>}
                        </TableCell>
                        <TableCell className="text-right font-semibold">{lacCrore(c.totalSpent)}</TableCell>
                        <TableCell className="text-right">{c.orderCount}</TableCell>
                        <TableCell className="text-right">{c.itemsPurchased}</TableCell>
                        <TableCell className="text-right">{lacCrore(c.averageSpent)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
        </ScrollArea>
    ) : (
        <p className="text-center text-muted-foreground py-10">No customer data for this period.</p>
    )
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input type="search" placeholder="Search by customer name…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" aria-label="Search by customer name" />
          </div>
          <div className="inline-flex rounded-md border overflow-hidden flex-shrink-0" role="group" aria-label="Sort by">
            {SORTS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
                className={cn('px-3 text-xs h-9 whitespace-nowrap transition-colors', sort === k ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>{renderTable(sorted)}</Card>
    </div>
  );
}
