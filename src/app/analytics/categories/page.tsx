
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Category } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format, parseISO, subDays, isWithinInterval, startOfDay } from 'date-fns';
import type { DateRange } from "react-day-picker";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, AlertTriangle, ArrowLeft, Shapes } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type CategoryPerformanceData = {
  id: string;
  name: string;
  revenue: number;
  itemsSold: number;
  orders: number;
};

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];


export default function CategoriesAnalyticsPage() {
  const { generatedInvoices, categories, isInvoicesLoading, loadGeneratedInvoices, loadCategories } = useAppStore();
  const router = useRouter();
  
  useEffect(() => {
    loadGeneratedInvoices();
    loadCategories();
  }, [loadGeneratedInvoices, loadCategories]);

  const isLoading = isInvoicesLoading;
  const loadingError = invoicesError;
  const { invoicesError } = useAppStore();

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const filteredInvoices = useMemo(() => {
    if (!dateRange || !dateRange.from) return generatedInvoices;
    const toDate = dateRange.to ? startOfDay(dateRange.to) : startOfDay(new Date());
    return generatedInvoices.filter(invoice => {
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


  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading category analytics...</p>
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error Loading Data</AlertTitle>
          <CardDescription>Could not load analytics data. Details: {loadingError}</CardDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
       <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <Button variant="outline" size="sm" onClick={() => router.push('/analytics')} className="mb-2">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Analytics Overview
                </Button>
                <h1 className="text-3xl font-bold text-primary flex items-center"><Shapes className="mr-3 h-8 w-8"/> Category Analytics</h1>
                <p className="text-muted-foreground">In-depth analysis of sales by product category.</p>
            </div>
            <DateRangePicker date={dateRange} onDateChange={setDateRange} />
        </header>

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
                            <CardTitle>Category Performance</CardTitle>
                            <CardDescription>Detailed breakdown of each category's performance.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[60vh]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Category</TableHead>
                                            <TableHead className="text-right">Revenue (PKR)</TableHead>
                                            <TableHead className="text-right">Items Sold</TableHead>
                                            <TableHead className="text-right"># of Orders</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {categoryPerformance.map(c => (
                                            <TableRow key={c.id}>
                                                <TableCell className="font-medium">{c.name}</TableCell>
                                                <TableCell className="text-right font-semibold">{c.revenue.toLocaleString()}</TableCell>
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
                            <CardTitle>Revenue Distribution</CardTitle>
                            <CardDescription>Share of total revenue by category.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie data={categoryPerformance} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={100} labelLine={false} label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
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
                                    <Tooltip formatter={(value: number) => [`PKR ${value.toLocaleString()}`, 'Revenue']} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )}
    </div>
  );
}
