
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Product } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO, subDays, isWithinInterval, startOfDay } from 'date-fns';
import type { DateRange } from "react-day-picker";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, AlertTriangle, ArrowLeft, Package, Search } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


type ProductPerformanceData = {
  sku: string;
  name: string;
  quantity: number;
  revenue: number;
  orders: number;
};


export default function ProductsAnalyticsPage() {
  const { generatedInvoices, products, isInvoicesLoading, isProductsLoading, invoicesError, productsError, loadGeneratedInvoices, loadProducts } = useAppStore();
  const router = useRouter();
  
  useEffect(() => {
    loadGeneratedInvoices();
    loadProducts();
  }, [loadGeneratedInvoices, loadProducts]);

  const isLoading = isInvoicesLoading || isProductsLoading;
  const loadingError = invoicesError || productsError;

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });
  const [searchTerm, setSearchTerm] = useState('');


  const filteredInvoices = useMemo(() => {
    if (!dateRange || !dateRange.from) return generatedInvoices;
    const toDate = dateRange.to ? startOfDay(dateRange.to) : startOfDay(new Date());
    return generatedInvoices.filter(invoice => {
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
        name: productDetails?.name || 'Unknown Product',
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

  const byRevenue = useMemo(() => [...filteredPerformanceData].sort((a,b) => b.revenue - a.revenue), [filteredPerformanceData]);
  const byQuantity = useMemo(() => [...filteredPerformanceData].sort((a,b) => b.quantity - a.quantity), [filteredPerformanceData]);
  const byOrders = useMemo(() => [...filteredPerformanceData].sort((a,b) => b.orders - a.orders), [filteredPerformanceData]);


  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading product analytics...</p>
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

  const renderTable = (data: ProductPerformanceData[]) => (
    data.length > 0 ? (
        <ScrollArea className="h-[65vh]">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Product</TableHead>
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
                        <TableCell className="text-right font-semibold">{p.revenue.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{p.quantity}</TableCell>
                        <TableCell className="text-right">{p.orders}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
        </ScrollArea>
    ) : (
        <p className="text-center text-muted-foreground py-10">No product data for this period.</p>
    )
  );

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
       <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <Button variant="outline" size="sm" onClick={() => router.push('/analytics')} className="mb-2">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Analytics Overview
                </Button>
                <h1 className="text-3xl font-bold text-primary flex items-center"><Package className="mr-3 h-8 w-8"/> Product Analytics</h1>
                <p className="text-muted-foreground">In-depth analysis of product performance.</p>
            </div>
            <DateRangePicker date={dateRange} onDateChange={setDateRange} />
        </header>

         <Card>
            <CardContent className="p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search by product name or SKU..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </CardContent>
        </Card>

        <Tabs defaultValue="revenue">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="revenue">Top by Revenue</TabsTrigger>
                <TabsTrigger value="quantity">Top by Quantity Sold</TabsTrigger>
                <TabsTrigger value="orders">Top by Orders</TabsTrigger>
            </TabsList>
            <TabsContent value="revenue">
                <Card>{renderTable(byRevenue)}</Card>
            </TabsContent>
            <TabsContent value="quantity">
                <Card>{renderTable(byQuantity)}</Card>
            </TabsContent>
            <TabsContent value="orders">
                <Card>{renderTable(byOrders)}</Card>
            </TabsContent>
        </Tabs>

    </div>
  );
}
