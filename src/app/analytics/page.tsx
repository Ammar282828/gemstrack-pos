

"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Order, Product, Category, Customer, Expense, InvoiceItem, AdditionalRevenue } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format, parseISO, startOfDay, endOfDay, subDays, isWithinInterval, startOfYear, endOfYear, getYear } from 'date-fns';
import type { DateRange } from "react-day-picker";
import { ScrollArea } from '@/components/ui/scroll-area';
import { DollarSign, ShoppingBag, Package, BarChart3, Percent, Users, ListOrdered, Loader2, CalendarDays, FileText, CreditCard, AlertTriangle, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

// Helper types for chart data
type SalesOverTimeData = { date: string; sales: number; orders: number; itemsSold: number };
type TopProductData = { sku: string; name: string; quantity: number; revenue: number };
type SalesByCategoryData = { categoryId: string; categoryName: string; sales: number };
type TopCustomerData = { customerId?: string; customerName: string; totalSpent: number; orderCount: number };
type DailySummaryItem = InvoiceItem & { invoiceId: string; customerName: string; };
type ExpenseByCategoryData = { category: string; amount: number };

export default function AnalyticsPage() {
  const { 
    generatedInvoices, orders, products, categories, customers, expenses, additionalRevenues,
    isInvoicesLoading, isOrdersLoading, isProductsLoading, isCustomersLoading, isExpensesLoading, isAdditionalRevenueLoading,
    invoicesError, ordersError, productsError, customersError, expensesError,
    loadGeneratedInvoices, loadOrders, loadProducts, loadCustomers, loadExpenses, loadAdditionalRevenues
  } = useAppStore();

  useEffect(() => {
    loadGeneratedInvoices();
    loadOrders();
    loadProducts();
    loadCustomers();
    loadExpenses();
    loadAdditionalRevenues();
  }, [loadGeneratedInvoices, loadOrders, loadProducts, loadCustomers, loadExpenses, loadAdditionalRevenues]);

  const isLoading = isInvoicesLoading || isOrdersLoading || isProductsLoading || isCustomersLoading || isExpensesLoading || isAdditionalRevenueLoading;
  const loadingError = invoicesError || ordersError || productsError || customersError || expensesError;


  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29), // Default to last 30 days
    to: new Date(),
  });
  
  const [activeQuickSelect, setActiveQuickSelect] = useState<string>('last-30');
  
  const [selectedDayData, setSelectedDayData] = useState<SalesOverTimeData | null>(null);
  const [isSummaryDialogOpen, setIsSummaryDialogOpen] = useState(false);


  const yearlySummary = useMemo(() => {
    const yearMap: Record<number, { revenue: number; expenses: number }> = {};
    generatedInvoices.forEach(inv => {
      if (!inv?.createdAt) return;
      const yr = getYear(parseISO(inv.createdAt));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0 };
      yearMap[yr].revenue += inv.grandTotal || 0;
    });
    orders.forEach(order => {
      if (!order?.createdAt || order.status === 'Cancelled' || order.status === 'Refunded' || order.invoiceId) return;
      const yr = getYear(parseISO(order.createdAt));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0 };
      yearMap[yr].revenue += order.grandTotal || 0;
    });
    additionalRevenues.forEach(r => {
      if (!r?.date) return;
      const yr = getYear(parseISO(r.date));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0 };
      yearMap[yr].revenue += r.amount || 0;
    });
    expenses.forEach(exp => {
      if (!exp?.date) return;
      const yr = getYear(parseISO(exp.date));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0 };
      yearMap[yr].expenses += exp.amount || 0;
    });
    return Object.entries(yearMap)
      .map(([year, data]) => ({
        year: parseInt(year),
        revenue: data.revenue,
        expenses: data.expenses,
        netProfit: data.revenue - data.expenses,
      }))
      .sort((a, b) => b.year - a.year);
  }, [generatedInvoices, orders, expenses, additionalRevenues]);

  const filteredInvoices = useMemo(() => {
    if (!dateRange || !dateRange.from) return generatedInvoices; 

    return generatedInvoices.filter(invoice => {
      if (!invoice || !invoice.createdAt) return false;
      const invoiceDate = parseISO(invoice.createdAt);
      const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
      return isWithinInterval(invoiceDate, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [generatedInvoices, dateRange]);

  // Uninvoiced orders only (not Cancelled, no invoiceId — those are already counted in invoice revenue)
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (!order || !order.createdAt) return false;
      if (order.status === 'Cancelled') return false;
      if (order.status === 'Refunded') return false;
      if (order.invoiceId) return false; // already counted via invoice
      if (!dateRange || !dateRange.from) return true;
      const orderDate = parseISO(order.createdAt);
      const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
      return isWithinInterval(orderDate, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [orders, dateRange]);
  
  const filteredExpenses = useMemo(() => {
    if (!dateRange || !dateRange.from) return expenses;

    return expenses.filter(expense => {
      if (!expense || !expense.date) return false;
      const expenseDate = parseISO(expense.date);
      const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
      return isWithinInterval(expenseDate, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [expenses, dateRange]);

  const filteredAdditionalRevenues = useMemo(() => {
    if (!dateRange || !dateRange.from) return additionalRevenues;
    return additionalRevenues.filter(r => {
      if (!r || !r.date) return false;
      const d = parseISO(r.date);
      const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
      return isWithinInterval(d, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [additionalRevenues, dateRange]);


  const analyticsData = useMemo(() => {
    const calcData = {
        totalSales: 0,
        invoiceSales: 0,
        orderSales: 0,
        extraRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        totalItemsSold: 0,
        totalDiscounts: 0,
        averageItemsPerOrder: 0,
        salesOverTime: [] as SalesOverTimeData[],
        topProductsByRevenue: [] as TopProductData[],
        topProductsByQuantity: [] as TopProductData[],
        salesByCategory: [] as SalesByCategoryData[],
        topCustomers: [] as TopCustomerData[],
        totalExpenses: 0,
        expensesByCategory: [] as ExpenseByCategoryData[],
      };

    if (filteredInvoices.length === 0 && filteredOrders.length === 0 && filteredExpenses.length === 0 && filteredAdditionalRevenues.length === 0) {
      return calcData;
    }

    let totalSales = 0;
    let totalItemsSold = 0;
    let totalDiscounts = 0;
    const salesByDate: Record<string, { sales: number; orders: number; itemsSold: number }> = {};
    const productPerformance: Record<string, { quantity: number; revenue: number }> = {};
    const categoryPerformance: Record<string, number> = {};
    const customerPerformance: Record<string, { totalSpent: number; orderCount: number }> = {};
    
    // Process Invoices
    filteredInvoices.forEach(invoice => {
      if (!invoice) return;
      totalSales += invoice.grandTotal || 0;
      totalDiscounts += invoice.discountAmount || 0;

      const dateKey = format(startOfDay(parseISO(invoice.createdAt)), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0, itemsSold: 0 };
      }
      salesByDate[dateKey].sales += invoice.grandTotal || 0;
      salesByDate[dateKey].orders += 1;

      const customerKey = invoice.customerId || 'walk-in';
      if (!customerPerformance[customerKey]) {
        customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0 };
      }
      customerPerformance[customerKey].totalSpent += invoice.grandTotal || 0;
      customerPerformance[customerKey].orderCount += 1;

      if (Array.isArray(invoice.items)) {
        invoice.items.forEach(item => {
          if (!item) return;
          const quantity = item.quantity || 0;
          const itemTotal = item.itemTotal || 0;

          totalItemsSold += quantity;
          salesByDate[dateKey].itemsSold += quantity;

          if (!productPerformance[item.sku]) {
            productPerformance[item.sku] = { quantity: 0, revenue: 0 };
          }
          productPerformance[item.sku].quantity += quantity;
          productPerformance[item.sku].revenue += itemTotal;
          
          if (item.categoryId) {
              if (!categoryPerformance[item.categoryId]) {
                  categoryPerformance[item.categoryId] = 0;
              }
              categoryPerformance[item.categoryId] += itemTotal;
          }
        });
      }
    });

    // Process uninvoiced Orders into revenue
    let orderSales = 0;
    filteredOrders.forEach(order => {
      if (!order) return;
      const amount = order.grandTotal || 0;
      totalSales += amount;
      orderSales += amount;

      const dateKey = format(startOfDay(parseISO(order.createdAt)), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0, itemsSold: 0 };
      }
      salesByDate[dateKey].sales += order.grandTotal || 0;
      salesByDate[dateKey].orders += 1;

      const customerKey = order.customerId || 'walk-in';
      if (!customerPerformance[customerKey]) {
        customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0 };
      }
      customerPerformance[customerKey].totalSpent += order.grandTotal || 0;
      customerPerformance[customerKey].orderCount += 1;
    });

    const totalOrders = filteredInvoices.length + filteredOrders.length;
    calcData.averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    calcData.averageItemsPerOrder = totalOrders > 0 ? totalItemsSold / totalOrders : 0;
    
    // Process Expenses
    const expenseByCategoryMap: Record<string, number> = {};
    filteredExpenses.forEach(expense => {
      if (!expense) return;
      calcData.totalExpenses += expense.amount || 0;
      if (expense.category) {
        if (!expenseByCategoryMap[expense.category]) {
          expenseByCategoryMap[expense.category] = 0;
        }
        expenseByCategoryMap[expense.category] += expense.amount || 0;
      }
    });

    calcData.expensesByCategory = Object.entries(expenseByCategoryMap)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a,b) => b.amount - a.amount);

    calcData.salesOverTime = Object.entries(salesByDate)
      .map(([date, data]) => ({ date, sales: data.sales, orders: data.orders, itemsSold: data.itemsSold }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    calcData.topProductsByRevenue = Object.entries(productPerformance)
      .map(([sku, data]) => {
        const productDetails = products.find(p => p.sku === sku);
        return { sku, name: productDetails?.name || 'Unknown Product', quantity: data.quantity, revenue: data.revenue };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    calcData.topProductsByQuantity = Object.entries(productPerformance)
      .map(([sku, data]) => {
        const productDetails = products.find(p => p.sku === sku);
        return { sku, name: productDetails?.name || 'Unknown Product', quantity: data.quantity, revenue: data.revenue };
      })
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    calcData.salesByCategory = Object.entries(categoryPerformance)
      .map(([categoryId, sales]) => {
        const categoryDetails = categories.find(c => c.id === categoryId);
        return { categoryId, categoryName: categoryDetails?.title || 'Uncategorized', sales };
      })
      .sort((a, b) => b.sales - a.sales);

    calcData.topCustomers = Object.entries(customerPerformance)
      .map(([customerId, data]) => {
        const customerDetails = customers.find(c => c.id === customerId);
        return {
          customerId: customerId === 'walk-in' ? undefined : customerId,
          customerName: customerDetails?.name || 'Walk-in Customer',
          totalSpent: data.totalSpent, orderCount: data.orderCount,
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);
      
    // Process Additional Revenue into salesOverTime
    let extraRevenue = 0;
    filteredAdditionalRevenues.forEach(r => {
      if (!r) return;
      const amount = r.amount || 0;
      totalSales += amount;
      extraRevenue += amount;
      const dateKey = format(startOfDay(parseISO(r.date)), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0, itemsSold: 0 };
      }
      salesByDate[dateKey].sales += amount;
    });

    calcData.totalSales = totalSales;
    calcData.invoiceSales = totalSales - orderSales - extraRevenue;
    calcData.orderSales = orderSales;
    calcData.extraRevenue = extraRevenue;
    calcData.totalOrders = totalOrders;
    calcData.totalItemsSold = totalItemsSold;
    calcData.totalDiscounts = totalDiscounts;

    return calcData;

  }, [filteredInvoices, filteredOrders, filteredExpenses, filteredAdditionalRevenues, products, categories, customers]);
  
  const dailyBreakdown = useMemo(() => {
    if (!selectedDayData) return { invoices: [], products: [] };
    const dayInvoices = filteredInvoices.filter(invoice => format(startOfDay(parseISO(invoice.createdAt)), 'yyyy-MM-dd') === selectedDayData.date);
    const dayProducts: DailySummaryItem[] = dayInvoices.flatMap(invoice => 
        (invoice.items || []).map(item => ({
            ...item,
            invoiceId: invoice.id,
            customerName: invoice.customerName || 'Walk-in'
        }))
    );
    return { invoices: dayInvoices, products: dayProducts };
  }, [selectedDayData, filteredInvoices]);


  if (isLoading) {
    return (
        <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
            <p className="text-lg text-muted-foreground">Loading analytics...</p>
        </div>
    );
  }

  if (loadingError) {
    return (
        <div className="container mx-auto py-8 px-4">
            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error Loading Data</AlertTitle>
                <CardDescription>
                    Could not load analytics data due to a server connection error. Please check your internet connection and try again.
                    <p className="text-xs mt-2 font-mono bg-destructive/10 p-2 rounded">Details: {loadingError}</p>
                </CardDescription>
            </Alert>
        </div>
    );
  }

  const handleQuickSelect = (key: string) => {
    const now = new Date();
    setActiveQuickSelect(key);
    if (key === 'last-30') {
      setDateRange({ from: subDays(now, 29), to: now });
    } else if (key === 'last-90') {
      setDateRange({ from: subDays(now, 89), to: now });
    } else if (key === 'this-year') {
      setDateRange({ from: startOfYear(now), to: now });
    } else if (key === 'last-year') {
      const lastYear = new Date(now.getFullYear() - 1, 0, 1);
      setDateRange({ from: startOfYear(lastYear), to: endOfYear(lastYear) });
    } else if (key === 'all-time') {
      setDateRange(undefined);
    } else if (key.startsWith('year-')) {
      const yr = parseInt(key.replace('year-', ''));
      const yearDate = new Date(yr, 0, 1);
      setDateRange({ from: startOfYear(yearDate), to: endOfYear(yearDate) });
    }
  };

  const handleDayClick = (dayData: SalesOverTimeData) => {
    setSelectedDayData(dayData);
    setIsSummaryDialogOpen(true);
  };
  
  const CardTitleLink: React.FC<{title: string, href: string, children: React.ReactNode}> = ({ title, href, children }) => (
    <Link href={href} className="group">
        <CardTitle className="flex justify-between items-center">
            <span>{title}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
        </CardTitle>
         {children}
    </Link>
  );

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      {/* --- Daily Summary Dialog --- */}
      <Dialog open={isSummaryDialogOpen} onOpenChange={setIsSummaryDialogOpen}>
          <DialogContent className="max-w-4xl">
              <DialogHeader>
                  <DialogTitle className="text-2xl">
                      Daily Report for {selectedDayData && format(parseISO(selectedDayData.date), 'MMMM d, yyyy')}
                  </DialogTitle>
                  <DialogDescription>
                      A detailed breakdown of all activity for this day.
                  </DialogDescription>
              </DialogHeader>
              {selectedDayData && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center my-4">
                    <div className="p-3 bg-muted rounded-md"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-xl font-bold">PKR {selectedDayData.sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
                    <div className="p-3 bg-muted rounded-md"><p className="text-sm text-muted-foreground">Total Orders</p><p className="text-xl font-bold">{selectedDayData.orders}</p></div>
                    <div className="p-3 bg-muted rounded-md"><p className="text-sm text-muted-foreground">Items Sold</p><p className="text-xl font-bold">{selectedDayData.itemsSold}</p></div>
                </div>
              )}
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4 max-h-[60vh] overflow-y-auto pr-2">
                <div>
                  <h3 className="font-semibold flex items-center mb-2"><FileText className="mr-2 h-5 w-5"/> Invoices</h3>
                  <ScrollArea className="h-[40vh] border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Invoice ID</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyBreakdown.invoices.map(invoice => (
                          <TableRow key={invoice.id}><TableCell className="font-medium">{invoice.id}</TableCell><TableCell>{invoice.customerName}</TableCell><TableCell className="text-right">{invoice.grandTotal.toLocaleString()}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
                <div>
                  <h3 className="font-semibold flex items-center mb-2"><Package className="mr-2 h-5 w-5"/> Products Sold</h3>
                  <ScrollArea className="h-[40vh] border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Product</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyBreakdown.products.map((item, index) => (
                          <TableRow key={`${item.invoiceId}-${item.sku}-${index}`}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{item.sku}</div></TableCell><TableCell className="text-right">{item.itemTotal.toLocaleString()}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>
          </DialogContent>
      </Dialog>
      
      <header className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
              <h1 className="text-3xl font-bold text-primary">Store Analytics</h1>
              <p className="text-muted-foreground">Get insights into your sales, products, and customer performance.</p>
          </div>
          <DateRangePicker date={dateRange} onDateChange={(r) => { setDateRange(r); setActiveQuickSelect('custom'); }} />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Quick:</span>
          {([
            { key: 'last-30', label: 'Last 30 Days' },
            { key: 'last-90', label: 'Last 90 Days' },
            { key: 'this-year', label: 'This Year' },
            { key: 'last-year', label: 'Last Year' },
            { key: 'all-time', label: 'All Time' },
          ] as const).map(btn => (
            <Button key={btn.key} variant={activeQuickSelect === btn.key ? 'default' : 'outline'} size="sm" onClick={() => handleQuickSelect(btn.key)}>
              {btn.label}
            </Button>
          ))}
        </div>
      </header>

      {filteredInvoices.length === 0 && filteredOrders.length === 0 && dateRange?.from ? ( 
        <Card>
          <CardHeader>
            <CardTitle>No Data Available for Selected Range</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">There are no invoices or orders in the selected date range. Try adjusting the dates or make some sales!</p>
          </CardContent>
        </Card>
      ) : generatedInvoices.length === 0 && orders.length === 0 && expenses.length === 0 ? ( 
        <Card>
          <CardHeader>
            <CardTitle>No Data Available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">There is no data yet to generate analytics. Start by making some sales!</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Key Metrics Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">PKR {analyticsData.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Invoices: PKR {analyticsData.invoiceSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  {analyticsData.orderSales > 0 && ` · Orders: PKR ${analyticsData.orderSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  {analyticsData.extraRevenue > 0 && ` · Extra: PKR ${analyticsData.extraRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">PKR {analyticsData.totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </CardContent>
            </Card>
            {(() => {
              const netProfit = analyticsData.totalSales - analyticsData.totalExpenses;
              const estProfit = analyticsData.totalSales * 0.40;
              const margin = analyticsData.totalSales > 0 ? (netProfit / analyticsData.totalSales) * 100 : 0;
              return (
                <>
                  <Card className="border-blue-500/40">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Est. Profit (40% margin)</CardTitle>
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-600">
                        PKR {estProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Revenue × 40% — before expenses</p>
                    </CardContent>
                  </Card>
                  <Card className={netProfit >= 0 ? 'border-green-500/40' : 'border-red-500/40'}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                      {netProfit >= 0
                        ? <TrendingUp className="h-4 w-4 text-green-600" />
                        : <TrendingDown className="h-4 w-4 text-destructive" />
                      }
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl font-bold ${netProfit >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        PKR {netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {analyticsData.totalSales > 0 ? `${margin.toFixed(1)}% actual margin` : 'No revenue in period'}
                      </p>
                    </CardContent>
                  </Card>
                </>
              );
            })()}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analyticsData.totalOrders}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg. Order Value</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">PKR {analyticsData.averageOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </CardContent>
            </Card>
             <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Items Sold</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analyticsData.totalItemsSold}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Discounts</CardTitle>
                <Percent className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">PKR {analyticsData.totalDiscounts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg. Items / Order</CardTitle>
                <ListOrdered className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analyticsData.averageItemsPerOrder.toFixed(2)}</div>
              </CardContent>
            </Card>
          </div>

          {/* Yearly Performance Summary — not affected by date filter */}
          {yearlySummary.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" /> Yearly Performance Overview
                </CardTitle>
                <CardDescription>All-time revenue, expenses &amp; profit by year. Click a row to filter analytics to that year.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Year</TableHead>
                      <TableHead className="text-right">Revenue (PKR)</TableHead>
                      <TableHead className="text-right">Expenses (PKR)</TableHead>
                      <TableHead className="text-right text-blue-600">Est. Profit (40%)</TableHead>
                      <TableHead className="text-right">Net Profit (PKR)</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearlySummary.map(row => (
                      <TableRow
                        key={row.year}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleQuickSelect(`year-${row.year}`)}
                      >
                        <TableCell className="font-semibold">{row.year}</TableCell>
                        <TableCell className="text-right">{row.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell className="text-right text-destructive">{row.expenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell className="text-right font-medium text-blue-600">
                          {(row.revenue * 0.40).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${row.netProfit >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                          {row.netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm">
                          {row.revenue > 0 ? `${((row.netProfit / row.revenue) * 100).toFixed(1)}%` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Charts Section */}
          <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Sales Over Time</CardTitle>
                <CardDescription>Revenue and order count trend for the selected period.</CardDescription>
              </CardHeader>
              <CardContent className="pl-2">
                 {analyticsData.salesOverTime.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={analyticsData.salesOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `PKR ${Number(value/1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                    <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(value: number, name: string) => {
                             if (name === 'Sales') return [`PKR ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];
                             if (name === 'Orders') return [value.toLocaleString(), name];
                             return [value, name];
                        }}
                    />
                    <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
                    <Line yAxisId="left" type="monotone" dataKey="sales" name="Sales" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 4, fill: 'hsl(var(--chart-1))', strokeWidth:0 }} activeDot={{ r: 6, fill: 'hsl(var(--chart-1))', strokeWidth:0 }}/>
                    <Line yAxisId="right" type="monotone" dataKey="orders" name="Orders" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 4, fill: 'hsl(var(--chart-2))', strokeWidth:0 }} activeDot={{ r: 6, fill: 'hsl(var(--chart-2))', strokeWidth:0 }} />
                  </LineChart>
                </ResponsiveContainer>
                 ) : (
                    <p className="text-muted-foreground text-center py-10">No sales data available to display chart for the selected period.</p>
                 )}
              </CardContent>
            </Card>
            
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center"><CalendarDays className="mr-2 h-5 w-5"/> Daily Summary</CardTitle>
              <CardDescription>A day-by-day breakdown of sales activity for the selected period. Click a row for details.</CardDescription>
            </CardHeader>
            <CardContent>
              {analyticsData.salesOverTime.length > 0 ? (
                <ScrollArea className="h-[400px] w-full" type="auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Total Sales (PKR)</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Items Sold</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.salesOverTime.map((day) => (
                        <TableRow key={day.date} onClick={() => handleDayClick(day)} className="cursor-pointer hover:bg-muted/50">
                          <TableCell className="font-medium">{format(parseISO(day.date), 'EEE, MMM d, yyyy')}</TableCell>
                          <TableCell className="text-right font-semibold">{day.sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-right">{day.orders}</TableCell>
                          <TableCell className="text-right">{day.itemsSold}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <p className="text-muted-foreground text-center py-10">No daily data available for the selected period.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                 <CardTitleLink title="Top Selling Products (by Revenue)" href="/analytics/products">
                    <CardDescription>Top 10 for the selected period.</CardDescription>
                </CardTitleLink>
              </CardHeader>
              <CardContent>
                {analyticsData.topProductsByRevenue.length > 0 ? (
                <ScrollArea className="h-[350px] w-full" type="auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.topProductsByRevenue.map((product) => (
                        <TableRow key={product.sku}>
                          <TableCell>
                            <div className="font-medium">{product.name}</div>
                            <div className="text-xs text-muted-foreground">SKU: {product.sku}</div>
                          </TableCell>
                          <TableCell className="text-right">{product.quantity}</TableCell>
                          <TableCell className="text-right">{product.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                 ) : (
                     <p className="text-muted-foreground text-center py-10">No product sales data available for the selected period.</p>
                 )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitleLink title="Top Selling Products (by Quantity)" href="/analytics/products">
                    <CardDescription>Top 10 for the selected period.</CardDescription>
                </CardTitleLink>
              </CardHeader>
              <CardContent>
                {analyticsData.topProductsByQuantity.length > 0 ? (
                <ScrollArea className="h-[350px] w-full" type="auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.topProductsByQuantity.map((product) => (
                        <TableRow key={product.sku}>
                          <TableCell>
                            <div className="font-medium">{product.name}</div>
                            <div className="text-xs text-muted-foreground">SKU: {product.sku}</div>
                          </TableCell>
                          <TableCell className="text-right">{product.quantity}</TableCell>
                          <TableCell className="text-right">{product.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                 ) : (
                     <p className="text-muted-foreground text-center py-10">No product sales data available for the selected period.</p>
                 )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitleLink title="Sales by Category" href="/analytics/categories">
                    <CardDescription>Revenue distribution for the selected period.</CardDescription>
                </CardTitleLink>
              </CardHeader>
              <CardContent className="pl-2">
                {analyticsData.salesByCategory.filter(c => c.sales > 0).length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={analyticsData.salesByCategory.filter(c => c.sales > 0)} layout="vertical" margin={{ right: 30, left: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `PKR ${Number(value/1000).toFixed(0)}k`} />
                        <YAxis dataKey="categoryName" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={120} interval={0} />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                            labelStyle={{ color: 'hsl(var(--foreground))' }}
                            itemStyle={{ color: 'hsl(var(--foreground))' }}
                            formatter={(value: number) => [`PKR ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Sales"]}
                        />
                        <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
                        <Bar dataKey="sales" name="Sales" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-muted-foreground text-center py-10">No category sales data available for the selected period.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Expenses by Category</CardTitle>
                <CardDescription>Spending distribution for the selected period.</CardDescription>
              </CardHeader>
              <CardContent className="pl-2">
                {analyticsData.expensesByCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={analyticsData.expensesByCategory} layout="vertical" margin={{ right: 30, left: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `PKR ${Number(value/1000).toFixed(0)}k`} />
                        <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={120} interval={0} />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                            labelStyle={{ color: 'hsl(var(--foreground))' }}
                            itemStyle={{ color: 'hsl(var(--foreground))' }}
                            formatter={(value: number) => [`PKR ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Amount"]}
                        />
                        <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
                        <Bar dataKey="amount" name="Amount" fill="hsl(var(--chart-5))" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-muted-foreground text-center py-10">No expenses recorded for the selected period.</p>
                )}
              </CardContent>
            </Card>
          </div>
          
           <div className="grid grid-cols-1">
             <Card>
              <CardHeader>
                <CardTitleLink title="Top Customers (by Sales)" href="/analytics/customers">
                    <CardDescription>Top 10 for the selected period.</CardDescription>
                </CardTitleLink>
              </CardHeader>
              <CardContent>
                {analyticsData.topCustomers.length > 0 ? (
                <ScrollArea className="h-[350px] w-full" type="auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Total Spent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.topCustomers.map((customer) => (
                        <TableRow key={customer.customerId || 'walk-in'}>
                          <TableCell>
                            <div className="font-medium">{customer.customerName}</div>
                            {customer.customerId && <div className="text-xs text-muted-foreground">ID: {customer.customerId}</div>}
                          </TableCell>
                          <TableCell className="text-right">{customer.orderCount}</TableCell>
                          <TableCell className="text-right">{customer.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                 ) : (
                     <p className="text-muted-foreground text-center py-10">No customer sales data available for the selected period.</p>
                 )}
              </CardContent>
            </Card>
           </div>
        </>
      )}
    </div>
  );
}
