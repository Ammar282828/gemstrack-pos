
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Customer } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO, subDays, isWithinInterval, startOfDay } from 'date-fns';
import type { DateRange } from "react-day-picker";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, AlertTriangle, ArrowLeft, Users, Search } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from 'next/link';

type CustomerPerformanceData = {
  customerId?: string;
  customerName: string;
  totalSpent: number;
  orderCount: number;
  itemsPurchased: number;
  averageSpent: number;
};

export default function CustomersAnalyticsPage() {
  const { generatedInvoices, customers, isInvoicesLoading, isCustomersLoading, invoicesError, customersError, loadGeneratedInvoices, loadCustomers } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    loadGeneratedInvoices();
    loadCustomers();
  }, [loadGeneratedInvoices, loadCustomers]);

  const isLoading = isInvoicesLoading || isCustomersLoading;
  const loadingError = invoicesError || customersError;

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

  const customerPerformance = useMemo(() => {
    const performanceMap: Record<string, { totalSpent: number; orderCount: number; itemsPurchased: number }> = {};

    filteredInvoices.forEach(invoice => {
      if (!invoice) return;
      const customerKey = invoice.customerId || 'walk-in';

      if (!performanceMap[customerKey]) {
        performanceMap[customerKey] = { totalSpent: 0, orderCount: 0, itemsPurchased: 0 };
      }
      
      performanceMap[customerKey].totalSpent += invoice.grandTotal || 0;
      performanceMap[customerKey].orderCount += 1;
      performanceMap[customerKey].itemsPurchased += invoice.items.reduce((acc, item) => acc + (item.quantity || 0), 0);
    });

    return Object.entries(performanceMap).map(([id, data]) => {
      const customerDetails = customers.find(c => c.id === id);
      return {
        customerId: id === 'walk-in' ? undefined : id,
        customerName: customerDetails?.name || 'Walk-in Customer',
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

  const byTotalSpent = useMemo(() => [...filteredPerformanceData].sort((a,b) => b.totalSpent - a.totalSpent), [filteredPerformanceData]);
  const byOrderCount = useMemo(() => [...filteredPerformanceData].sort((a,b) => b.orderCount - a.orderCount), [filteredPerformanceData]);
  const byAverageSpent = useMemo(() => [...filteredPerformanceData].sort((a,b) => b.averageSpent - a.averageSpent), [filteredPerformanceData]);

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading customer analytics...</p>
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

  const renderTable = (data: CustomerPerformanceData[]) => (
    data.length > 0 ? (
        <ScrollArea className="h-[65vh]">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total Spent (PKR)</TableHead>
                    <TableHead className="text-right"># of Orders</TableHead>
                    <TableHead className="text-right">Total Items</TableHead>
                    <TableHead className="text-right">Avg. Spent / Order</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map(c => (
                    <TableRow key={c.customerId || 'walk-in'}>
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
                        <TableCell className="text-right font-semibold">{c.totalSpent.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{c.orderCount}</TableCell>
                        <TableCell className="text-right">{c.itemsPurchased}</TableCell>
                        <TableCell className="text-right">{c.averageSpent.toLocaleString()}</TableCell>
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
    <div className="container mx-auto py-8 px-4 space-y-6">
       <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <Button variant="outline" size="sm" onClick={() => router.push('/analytics')} className="mb-2">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Analytics Overview
                </Button>
                <h1 className="text-3xl font-bold text-primary flex items-center"><Users className="mr-3 h-8 w-8"/> Customer Analytics</h1>
                <p className="text-muted-foreground">In-depth analysis of customer purchasing behavior.</p>
            </div>
            <DateRangePicker date={dateRange} onDateChange={setDateRange} />
        </header>

         <Card>
            <CardContent className="p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search by customer name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </CardContent>
        </Card>

        <Tabs defaultValue="spent">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="spent">Top by Spending</TabsTrigger>
                <TabsTrigger value="orders">Top by Orders</TabsTrigger>
                <TabsTrigger value="avgSpent">Top by Average Spend</TabsTrigger>
            </TabsList>
            <TabsContent value="spent">
                <Card>{renderTable(byTotalSpent)}</Card>
            </TabsContent>
            <TabsContent value="orders">
                <Card>{renderTable(byOrderCount)}</Card>
            </TabsContent>
            <TabsContent value="avgSpent">
                <Card>{renderTable(byAverageSpent)}</Card>
            </TabsContent>
        </Tabs>

    </div>
  );
}
