
"use client";

import React, { useMemo } from 'react';
import { useAppStore, Invoice, Product, Category, useIsStoreHydrated } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format, parseISO, startOfDay } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DollarSign, ShoppingBag, Package, BarChart3 } from 'lucide-react'; // Users removed as it's not used for now

// Helper types for chart data
type SalesOverTimeData = { date: string; sales: number; orders: number };
type TopProductData = { sku: string; name: string; quantity: number; revenue: number };
type SalesByCategoryData = { categoryId: string; categoryName: string; sales: number };

export default function AnalyticsPage() {
  const isHydrated = useIsStoreHydrated();
  const invoices = useAppStore(state => state.generatedInvoices);
  const products = useAppStore(state => state.products);
  const categories = useAppStore(state => state.categories);

  const analyticsData = useMemo(() => {
    if (!isHydrated || invoices.length === 0) {
      return {
        totalSales: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        totalItemsSold: 0,
        salesOverTime: [] as SalesOverTimeData[],
        topProducts: [] as TopProductData[],
        salesByCategory: [] as SalesByCategoryData[],
      };
    }

    let totalSales = 0;
    let totalItemsSold = 0;
    const salesByDate: Record<string, { sales: number; orders: number }> = {};
    const productPerformance: Record<string, { quantity: number; revenue: number }> = {};
    const categoryPerformance: Record<string, number> = {};

    invoices.forEach(invoice => {
      totalSales += invoice.grandTotal;

      const dateKey = format(startOfDay(parseISO(invoice.createdAt)), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0 };
      }
      salesByDate[dateKey].sales += invoice.grandTotal;
      salesByDate[dateKey].orders += 1;

      invoice.items.forEach(item => {
        totalItemsSold += item.quantity;

        if (!productPerformance[item.sku]) {
          productPerformance[item.sku] = { quantity: 0, revenue: 0 };
        }
        productPerformance[item.sku].quantity += item.quantity;
        productPerformance[item.sku].revenue += item.itemTotal;

        // Find product category for category performance
        // Note: item.categoryId is directly on invoiceItem.
        if (item.categoryId) {
             if (!categoryPerformance[item.categoryId]) {
                categoryPerformance[item.categoryId] = 0;
            }
            categoryPerformance[item.categoryId] += item.itemTotal;
        }
      });
    });

    const totalOrders = invoices.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    const salesOverTime: SalesOverTimeData[] = Object.entries(salesByDate)
      .map(([date, data]) => ({ date, sales: data.sales, orders: data.orders }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const topProducts: TopProductData[] = Object.entries(productPerformance)
      .map(([sku, data]) => {
        const productDetails = products.find(p => p.sku === sku);
        return {
          sku,
          name: productDetails?.name || 'Unknown Product',
          quantity: data.quantity,
          revenue: data.revenue,
        };
      })
      .sort((a, b) => b.revenue - a.revenue) // Sort by revenue
      .slice(0, 10); // Top 10

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

    return {
      totalSales,
      totalOrders,
      averageOrderValue,
      totalItemsSold,
      salesOverTime,
      topProducts,
      salesByCategory,
    };
  }, [invoices, products, categories, isHydrated]);

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading analytics...</p></div>;
  }

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary">Store Analytics</h1>
        <p className="text-muted-foreground">Get insights into your sales, products, and category performance.</p>
      </header>

      {invoices.length === 0 ? (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Sales Over Time</CardTitle>
                <CardDescription>Revenue and order count trend.</CardDescription>
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
                    <p className="text-muted-foreground text-center py-10">No sales data available to display chart.</p>
                 )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Selling Products</CardTitle>
                <CardDescription>By revenue. (Top 10)</CardDescription>
              </CardHeader>
              <CardContent>
                {analyticsData.topProducts.length > 0 ? (
                <ScrollArea className="h-[350px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty Sold</TableHead>
                        <TableHead className="text-right">Revenue (PKR)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.topProducts.map((product) => (
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
                     <p className="text-muted-foreground text-center py-10">No product sales data available.</p>
                 )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sales by Category</CardTitle>
                <CardDescription>Revenue distribution across product categories.</CardDescription>
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
                    <p className="text-muted-foreground text-center py-10">No category sales data available.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
