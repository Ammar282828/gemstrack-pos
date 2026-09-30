"use client";

/**
 * Analytics → Products: every piece sold in the range, by revenue, quantity or number of sales.
 * It was a page of its own (/analytics/products) with its own 30 days and a "Back to Analytics
 * Overview" button; now a section of AnalyticsView under the shared range.
 *
 * Revenue here is gross line-item revenue (the sum of item totals), before invoice-level discounts
 * and trade-ins, so it runs higher than the net total on the Overview.
 */

import React, { useMemo, useState } from 'react';
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

type ProductPerformanceData = { sku: string; name: string; quantity: number; revenue: number; orders: number };
const SORTS = [['revenue', 'Revenue'], ['quantity', 'Quantity sold'], ['orders', 'Number of sales']] as const;

export function ProductBreakdown({ range: dateRange }: { range: DateRange | undefined }) {
  const { generatedInvoices, products } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  // A sort, not a third row of tabs (one tab row per screen).
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('revenue');

  const filteredInvoices = useMemo(() => {
    // Exclude refunded invoices so they don't inflate product revenue — matches
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
  
  
  const productPerformance = useMemo(() => {
    const performanceMap: Record<string, { quantity: number; revenue: number; orders: Set<string> }> = {};

    filteredInvoices.forEach(invoice => {
      if (!invoice || !Array.isArray(invoice.items)) return;
      
      invoice.items.forEach(item => {
        if (!item?.sku) return;
        
        if (!performanceMap[item.sku]) {
          performanceMap[item.sku] = { quantity: 0, revenue: 0, orders: new Set() };
        }
        
        performanceMap[item.sku].quantity += item.quantity || 0;
        performanceMap[item.sku].revenue += item.itemTotal || 0;
        performanceMap[item.sku].orders.add(invoice.id);
      });
    });

    return Object.entries(performanceMap).map(([sku, data]) => {
      const productDetails = products.find(p => p.sku === sku);
      return {
        sku,
        name: productDetails?.name || 'Unknown piece',
        quantity: data.quantity,
        revenue: data.revenue,
        orders: data.orders.size,
      };
    });
  }, [filteredInvoices, products]);

  const filteredPerformanceData = useMemo(() => {
    if (!searchTerm) return productPerformance;
    const lowerCaseSearch = searchTerm.toLowerCase();
    return productPerformance.filter(p => 
        p.name.toLowerCase().includes(lowerCaseSearch) ||
        p.sku.toLowerCase().includes(lowerCaseSearch)
    );
  }, [productPerformance, searchTerm]);

  const sorted = useMemo(() => [...filteredPerformanceData].sort((a, b) => b[sort] - a[sort]), [filteredPerformanceData, sort]);


  const renderTable = (data: ProductPerformanceData[]) => (
    data.length > 0 ? (
        <ScrollArea className="h-[65vh]">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Piece</TableHead>
                    <TableHead className="text-right">Revenue (PKR)</TableHead>
                    <TableHead className="text-right">Quantity Sold</TableHead>
                    <TableHead className="text-right"># of Orders</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map(p => (
                    <TableRow key={p.sku}>
                        <TableCell>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.sku}</div>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{lacCrore(p.revenue)}</TableCell>
                        <TableCell className="text-right">{p.quantity}</TableCell>
                        <TableCell className="text-right">{p.orders}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
        </ScrollArea>
    ) : (
        <p className="text-center text-muted-foreground py-10">No pieces sold in this period.</p>
    )
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input type="search" placeholder="Search by piece or SKU…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" aria-label="Search by piece or SKU" />
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
      <p className="text-xs text-muted-foreground">Revenue here is each piece&apos;s own total, before invoice discounts and trade-ins, so it runs higher than the Overview&apos;s net figure.</p>
    </div>
  );
}
