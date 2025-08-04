
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Product, Category, Customer } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format, parseISO, startOfDay, subDays, isWithinInterval } from 'date-fns';
import type { DateRange } from "react-day-picker";
import { ScrollArea } from '@/components/ui/scroll-area';
import { DollarSign, ShoppingBag, Package, BarChart3, Percent, Users, ListOrdered, Loader2, CalendarDays } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';

// Helper types for chart data
type SalesOverTimeData = { date: string; sales: number; orders: number; itemsSold: number };
type TopProductData = { sku: string; name: string; quantity: number; revenue: number };
type SalesByCategoryData = { categoryId: string; categoryName: string; sales: number };
type TopCustomerData = { customerId?: string; customerName: string; totalSpent: number; orderCount: number };


export default function AnalyticsPage() {
  const { 
    generatedInvoices, products, categories, customers, 
    isInvoicesLoading, isProductsLoading, isCustomersLoading, 
    loadGeneratedInvoices, loadProducts, loadCustomers 
  } = useAppStore();

  useEffect(() => {
    loadGeneratedInvoices();
    loadProducts();
    loadCustomers();
  }, [loadGeneratedInvoices, loadProducts, loadCustomers]);

  const isLoading = isInvoicesLoading || isProductsLoading || isCustomersLoading;


  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29), // Default to last 30 days
    to: new Date(),
  });

  const filteredInvoices = useMemo(() => {
    if (!dateRange || !dateRange.from) return generatedInvoices; 

    return generatedInvoices.filter(invoice => {
      const invoiceDate = parseISO(invoice.createdAt);
      const toDate = dateRange.to ? startOfDay(dateRange.to) : startOfDay(new Date()); 
      return isWithinInterval(invoiceDate, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [generatedInvoices, dateRange]);


  const analyticsData = useMemo(() => {
    if (filteredInvoices.length === 0) {
      return {
        totalSales: 0,
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
      };
    }

    let totalSales = 0;
    let totalItemsSold = 0;
    let totalDiscounts = 0;
    const salesByDate: Record<string, { sales: number; orders: number; itemsSold: number }> = {};
    const productPerformance: Record<string, { quantity: number; revenue: number }> = {};
    const categoryPerformance: Record<string, number> = {};
    const customerPerformance: Record<string, { totalSpent: number; orderCount: number }> = {};

    filteredInvoices.forEach(invoice => {
      totalSales += invoice.grandTotal;
      totalDiscounts += invoice.discountAmount;

      const dateKey = format(startOfDay(parseISO(invoice.createdAt)), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0, itemsSold: 0 };
      }
      salesByDate[dateKey].sales += invoice.grandTotal; 
      salesByDate[dateKey].orders += 1;

      const customerKey = invoice.customerId || 'walk-in';
      if (!customerPerformance[customerKey]) {
        customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0 };
      }
      customerPerformance[customerKey].totalSpent += invoice.grandTotal;
      customerPerformance[customerKey].orderCount += 1;

      invoice.items.forEach(item => {
        totalItemsSold += item.quantity;
        salesByDate[dateKey].itemsSold += item.quantity;

        if (!productPerformance[item.sku]) {
          productPerformance[item.sku] = { quantity: 0, revenue: 0 };
        }
        productPerformance[item.sku].quantity += item.quantity;
        productPerformance[item.sku].revenue += item.itemTotal;
        
        if (item.categoryId) {
             if (!categoryPerformance[item.categoryId]) {
                categoryPerformance[item.categoryId] = 0;
            }
            categoryPerformance[item.categoryId] += item.itemTotal;
        }
      });
    });

    const totalOrders = filteredInvoices.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    const averageItemsPerOrder = totalOrders > 0 ? totalItemsSold / totalOrders : 0;

    const salesOverTime: SalesOverTimeData[] = Object.entries(salesByDate)
      .map(([date, data]) => ({ date, sales: data.sales, orders: data.orders, itemsSold: data.itemsSold }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const topProductsByRevenue: TopProductData[] = Object.entries(productPerformance)
      .map(([sku, data]) => {
        const productDetails = products.find(p => p.sku === sku);
        return {
          sku,
          name: productDetails?.name || 'Unknown Product',
          quantity: data.quantity,
          revenue: data.revenue,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const topProductsByQuantity: TopProductData[] = Object.entries(productPerformance)
      .map(([sku, data]) => {
        const productDetails = products.find(p => p.sku === sku);
        return {
          sku,
          name: productDetails?.name || 'Unknown Product',
          quantity: data.quantity,
          revenue: data.revenue,
        };
      })
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    const salesByCategory: SalesByCategoryData[] = Object.entries(categoryPerformance)
      .map(([categoryId, sales]) => {
        const categoryDetails = categories.find(c => c.id === categoryId);
        return {
          categoryId,
          categoryName: categoryDetails?.title || 'Uncategorized',
          sales,
        };
      })
      .sort((a, b) => b.sales - a.sales);

    const topCustomers: TopCustomerData[] = Object.entries(customerPerformance)
      .map(([customerId, data]) => {
        const customerDetails = customers.find(c => c.id === customerId);
        return {
          customerId: customerId === 'walk-in' ? undefined : customerId,
          customerName: customerDetails?.name || 'Walk-in Customer',
          totalSpent: data.totalSpent,
          orderCount: data.orderCount,
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);
      
    return {
      totalSales,
      totalOrders,
      averageOrderValue,
      totalItemsSold,
      totalDiscounts,
      averageItemsPerOrder,
      salesOverTime,
      topProductsByRevenue,
      topProductsByQuantity,
      salesByCategory,
      topCustomers,
    };
  }, [filteredInvoices, products, categories, customers]);

  if (isLoading) {
    return (
        <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
            <p className="text-lg text-muted-foreground">Loading analytics...</p>
        </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
        <div>
            <h1 className="text-3xl font-bold text-primary">Store Analytics</h1>
            <p className="text-muted-foreground">Get insights into your sales, products, and customer performance.</p>
        </div>
        <DateRangePicker date={dateRange} onDateChange={setDateRange} />
      </header>

      {filteredInvoices.length === 0 && dateRange?.from ? ( 
        <Card>
          <CardHeader>
            <CardTitle>No Data Available for Selected Range</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">There are no invoices in the selected date range. Try adjusting the dates or make some sales!</p>
          </CardContent>
        </Card>
      ) : generatedInvoices.length === 0 ? ( 
        <Card>
          <CardHeader>
            <CardTitle>No Data Available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">There are no invoices yet to generate analytics. Start by making some sales!</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Key Metrics Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">PKR {analyticsData.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </CardContent>
            </Card>
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
              <CardDescription>A day-by-day breakdown of sales activity for the selected period.</CardDescription>
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
                        <TableRow key={day.date}>
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
                <CardTitle>Top Selling Products (by Revenue)</CardTitle>
                <CardDescription>Top 10 for the selected period.</CardDescription>
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
                <CardTitle>Top Selling Products (by Quantity)</CardTitle>
                <CardDescription>Top 10 for the selected period.</CardDescription>
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
                <CardTitle>Sales by Category</CardTitle>
                <CardDescription>Revenue distribution for the selected period.</CardDescription>
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
                <CardTitle>Top Customers (by Sales)</CardTitle>
                <CardDescription>Top 10 for the selected period.</CardDescription>
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
