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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

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
        const categoryId = item.categoryId || 'uncategorized';
        
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
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie {...chartMotion()} data={categoryPerformance} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={100} labelLine={false} label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
                                          const RADIAN = Math.PI / 180;
                                          const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                                          return (percent > 0.05) ? (
                                            <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
                                              {`${(percent * 100).toFixed(0)}%`}
                                            </text>
                                          ) : null;
                                        }}>
                                        {categoryPerformance.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(value: number) => [pkrLac(value), 'Revenue']} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )}
      <p className="text-xs text-muted-foreground">Revenue here is each piece&apos;s own total, before invoice discounts and trade-ins, so it runs higher than the Overview&apos;s net figure.</p>
    </div>
  );
}
