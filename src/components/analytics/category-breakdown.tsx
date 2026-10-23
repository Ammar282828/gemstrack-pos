"use client";

/**
 * Analytics → Categories: revenue, pieces and sales per category in the range. It was a page of
 * its own with its own 30 days; now a section of AnalyticsView under the shared range. Revenue is
 * gross line-item revenue, before invoice discounts and trade-ins.
 */

import React, { useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import { pkrLac, lacCrore } from '@/lib/money';
import { cn } from '@/lib/utils';
import { lineCategory } from '@/lib/categories';


export function CategoryBreakdown({ range: dateRange }: { range: DateRange | undefined }) {
  const { generatedInvoices, categories } = useAppStore();

  const filteredInvoices = useMemo(() => {
    // Exclude refunded invoices so they don't inflate category revenue — matches
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
  
  
  const categoryPerformance = useMemo(() => {
    const performanceMap: Record<string, { revenue: number; itemsSold: number; orders: Set<string> }> = {};

    filteredInvoices.forEach(invoice => {
      if (!invoice || !Array.isArray(invoice.items)) return;
      
      invoice.items.forEach(item => {
        // Its own category, else its order's, else its name's (lib/categories.ts lineCategory).
        const categoryId = lineCategory(item) || 'uncategorized';
        
        if (!performanceMap[categoryId]) {
          performanceMap[categoryId] = { revenue: 0, itemsSold: 0, orders: new Set() };
        }
        
        performanceMap[categoryId].itemsSold += item.quantity || 0;
        performanceMap[categoryId].revenue += item.itemTotal || 0;
        performanceMap[categoryId].orders.add(invoice.id);
      });
    });

    return Object.entries(performanceMap).map(([id, data]) => {
      const categoryDetails = categories.find(c => c.id === id);
      return {
        id,
        name: categoryDetails?.title || 'Uncategorized',
        revenue: data.revenue,
        itemsSold: data.itemsSold,
        orders: data.orders.size,
      };
    }).sort((a,b) => b.revenue - a.revenue);
  }, [filteredInvoices, categories]);
  const total = categoryPerformance.reduce((a, c) => a + c.revenue, 0);
  const top = Math.max(1, ...categoryPerformance.map(c => c.revenue));


  return (
    <div className="space-y-4">
        {categoryPerformance.length === 0 ? (
             <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                    No category sales data for the selected period.
                </CardContent>
             </Card>
        ) : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <Card>
                        <CardHeader>
                            <CardTitle>By category</CardTitle>
                            <CardDescription>Detailed breakdown of each category's performance.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[60vh]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Category</TableHead>
                                            <TableHead className="text-right">Revenue (PKR)</TableHead>
                                            <TableHead className="text-right">Pieces</TableHead>
                                            <TableHead className="text-right">Sales</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {categoryPerformance.map(c => (
                                            <TableRow key={c.id}>
                                                <TableCell className="font-medium">{c.name}</TableCell>
                                                <TableCell className="text-right font-semibold">{lacCrore(c.revenue)}</TableCell>
                                                <TableCell className="text-right">{c.itemsSold}</TableCell>
                                                <TableCell className="text-right">{c.orders}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Share of revenue</CardTitle>
                            <CardDescription>Share of total revenue by category.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Ranked bars in one hue, the share written beside each (2026-10-23, the owner: "fix pie chart" — seventeen
                                slices could not be read, nor their legend, which sat on the pie). */}
                            <ul className="space-y-2.5">
                                {categoryPerformance.map(c => {
                                    const share = total ? c.revenue / total : 0;
                                    return (
                                        <li key={c.id} className="space-y-1" title={`${c.name}: ${pkrLac(c.revenue)} (${(share * 100).toFixed(1)}%)`}>
                                            <div className="flex items-baseline justify-between gap-3 text-sm">
                                                <span className={cn('min-w-0 truncate', c.id === 'uncategorized' && 'text-muted-foreground')}>{c.name}</span>
                                                <span className="shrink-0 tabular-nums">{share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1)}%<span className="ml-1.5 text-xs text-muted-foreground">{lacCrore(c.revenue)}</span></span>
                                            </div>
                                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                                <div className={cn('h-full rounded-full', c.id === 'uncategorized' ? 'bg-muted-foreground/40' : 'bg-primary/75')} style={{ width: `${(c.revenue / top) * 100}%` }} />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )}
      <p className="text-xs text-muted-foreground">Revenue here is each piece&apos;s own total, before invoice discounts and trade-ins, so it runs higher than the Overview&apos;s net figure. A custom order&apos;s piece counts under the order&apos;s category; a line with none is placed by its name (&ldquo;Jhumki&rdquo; under Tops).</p>
    </div>
  );
}
