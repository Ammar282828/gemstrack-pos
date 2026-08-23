

"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { BoardSkeleton } from '@/components/shared/skeletons';
import { useAppStore, Invoice, Order, Product, Category, Customer, Expense, InvoiceItem, AdditionalRevenue, CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS, CustomerSource, getInvoiceRevenueDate } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, Cell } from 'recharts';
import { format, parseISO, startOfDay, endOfDay, subDays, isWithinInterval, startOfYear, endOfYear, getYear, eachMonthOfInterval, startOfMonth } from 'date-fns';
import type { DateRange } from "react-day-picker";
import { ScrollArea } from '@/components/ui/scroll-area';
import { DollarSign, ShoppingBag, Package, BarChart3, Percent, Users, ListOrdered, CalendarDays, FileText, CreditCard, AlertTriangle, ArrowRight, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { isBusinessCost } from '@/lib/partnership';

// Helper types for chart data
type SalesOverTimeData = { date: string; sales: number; orders: number; itemsSold: number };
type TopProductData = { sku: string; name: string; quantity: number; revenue: number };
type SalesByCategoryData = { categoryId: string; categoryName: string; sales: number };
type TopCustomerData = { customerId?: string; customerName: string; totalSpent: number; orderCount: number };
type DailySummaryItem = InvoiceItem & { invoiceId: string; customerName: string; };
type ExpenseByCategoryData = { category: string; amount: number };
type SourceBreakdownData = { key: string; label: string; revenue: number; orderCount: number; avgOrderValue: number };
type SourceTrendData = { date: string } & Record<string, number | string>;

// Acquisition-source buckets for analytics: the four configured sources plus an
// "unclassified" catch-all for sales with no source on the record or customer.
const UNCLASSIFIED_KEY = 'unclassified';
const SOURCE_KEYS: string[] = [...CUSTOMER_SOURCES, UNCLASSIFIED_KEY];
const SOURCE_LABELS: Record<string, string> = { ...CUSTOMER_SOURCE_LABELS, [UNCLASSIFIED_KEY]: 'Unclassified' };
// Stable colors for the trend chart, one per source key.
const SOURCE_COLORS: Record<string, string> = {
  taheri_spillover: 'hsl(var(--chart-1))',
  referral: 'hsl(var(--chart-2))',
  walkin: 'hsl(var(--chart-3))',
  other: 'hsl(var(--chart-4))',
  [UNCLASSIFIED_KEY]: 'hsl(var(--chart-5))',
};

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


  // Map order id -> order so invoices can be recognized on their source order's
  // date (getInvoiceRevenueDate), keeping every revenue view on an order-date basis.
  const ordersById = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders]);

  const yearlySummary = useMemo(() => {
    const yearMap: Record<number, { revenue: number; expenses: number; unpaid: number }> = {};
    generatedInvoices.forEach(inv => {
      if (!inv?.createdAt || inv.status === 'Refunded') return;
      const yr = getYear(parseISO(getInvoiceRevenueDate(inv, ordersById)));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0, unpaid: 0 };
      yearMap[yr].revenue += inv.grandTotal || 0;
      yearMap[yr].unpaid += Math.max(0, inv.balanceDue || 0);
    });
    orders.forEach(order => {
      if (!order?.createdAt || order.status === 'Cancelled' || order.status === 'Refunded' || order.invoiceId) return;
      const yr = getYear(parseISO(order.createdAt));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0, unpaid: 0 };
      // Use subtotal: the full order value regardless of advance paid
      yearMap[yr].revenue += order.subtotal || 0;
    });
    additionalRevenues.forEach(r => {
      if (!r?.date) return;
      const yr = getYear(parseISO(r.date));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0, unpaid: 0 };
      yearMap[yr].revenue += r.amount || 0;
    });
    expenses.forEach(exp => {
      if (!exp?.date) return;
      // Drawings are a distribution of profit, not a cost of earning it.
      if (!isBusinessCost(exp)) return;
      const yr = getYear(parseISO(exp.date));
      if (!yearMap[yr]) yearMap[yr] = { revenue: 0, expenses: 0, unpaid: 0 };
      yearMap[yr].expenses += exp.amount || 0;
    });
    return Object.entries(yearMap)
      .map(([year, data]) => ({
        year: parseInt(year),
        revenue: data.revenue,
        expenses: data.expenses,
        unpaid: data.unpaid,
        netProfit: data.revenue - data.expenses,
      }))
      .sort((a, b) => b.year - a.year);
  }, [generatedInvoices, orders, ordersById, expenses, additionalRevenues]);

  /**
   * Revenue per calendar month across the whole history — deliberately not
   * bound to the date-range filter, since the point of this chart is the shape
   * of the trend rather than a slice of it. Same revenue basis as everywhere
   * else: invoice grandTotal on its order date, uninvoiced order subtotals,
   * and additional revenue. Empty months are kept so gaps read as gaps.
   */
  const monthlyRevenue = useMemo(() => {
    const bucket: Record<string, { revenue: number; sales: number }> = {};
    const add = (iso: string, amount: number) => {
      const d = parseISO(iso);
      if (Number.isNaN(d.getTime())) return;
      const key = format(startOfMonth(d), 'yyyy-MM');
      if (!bucket[key]) bucket[key] = { revenue: 0, sales: 0 };
      bucket[key].revenue += amount;
      bucket[key].sales += 1;
    };

    generatedInvoices.forEach(inv => {
      if (!inv?.createdAt || inv.status === 'Refunded') return;
      add(getInvoiceRevenueDate(inv, ordersById), inv.grandTotal || 0);
    });
    orders.forEach(o => {
      if (!o?.createdAt || o.status === 'Cancelled' || o.status === 'Refunded' || o.invoiceId) return;
      add(o.createdAt, o.subtotal || 0);
    });
    additionalRevenues.forEach(r => { if (r?.date) add(r.date, r.amount || 0); });

    const keys = Object.keys(bucket).sort();
    if (!keys.length) return { data: [], average: 0, best: null as string | null };

    // Walk every month between the first and last so a quiet month shows as a
    // gap in the series instead of silently collapsing the timeline.
    const months = eachMonthOfInterval({
      start: parseISO(`${keys[0]}-01`),
      end: parseISO(`${keys[keys.length - 1]}-01`),
    });

    const data = months.map(m => {
      const key = format(m, 'yyyy-MM');
      const b = bucket[key];
      return {
        key,
        month: format(m, 'MMM yy'),
        revenue: b?.revenue || 0,
        sales: b?.sales || 0,
      };
    });

    const withRevenue = data.filter(d => d.revenue > 0);
    const average = withRevenue.length
      ? withRevenue.reduce((s, d) => s + d.revenue, 0) / withRevenue.length
      : 0;
    const best = data.reduce((m, d) => (d.revenue > (m?.revenue ?? -1) ? d : m), data[0])?.key ?? null;

    return { data, average, best };
  }, [generatedInvoices, orders, ordersById, additionalRevenues]);

  const filteredInvoices = useMemo(() => {
    const base = generatedInvoices.filter(invoice => invoice?.status !== 'Refunded');
    if (!dateRange || !dateRange.from) return base;

    return base.filter(invoice => {
      if (!invoice || !invoice.createdAt) return false;
      const invoiceDate = parseISO(getInvoiceRevenueDate(invoice, ordersById));
      const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
      return isWithinInterval(invoiceDate, { start: startOfDay(dateRange.from!), end: toDate });
    });
  }, [generatedInvoices, dateRange, ordersById]);

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
        totalUnpaid: 0,
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
        // ── Cash flow ───────────────────────────────────────────────────────
        cashIn: 0,
        cashInFromInvoicePayments: 0,
        cashInFromOrderAdvances: 0,
        cashInFromExtraRevenue: 0,
        cashOut: 0,
        netCashFlow: 0,
        // ── Acquisition source ──────────────────────────────────────────────
        sourceBreakdown: [] as SourceBreakdownData[],
        sourceTrend: [] as SourceTrendData[],
        sourceActiveKeys: [] as string[],
      };

    if (filteredInvoices.length === 0 && filteredOrders.length === 0 && filteredExpenses.length === 0 && filteredAdditionalRevenues.length === 0) {
      return calcData;
    }

    // Resolve a sale's acquisition source: explicit override on the record wins,
    // else the linked customer's saved source, else "unclassified".
    const customersById = new Map(customers.map(c => [c.id, c]));
    // Invoices carry the channel on `acquisitionSource` (the bare `source` field
    // is reserved for Shopify import tagging); orders carry it on `source`.
    const resolveSource = (recSource: CustomerSource | undefined, customerId?: string): string => {
      if (recSource) return recSource;
      if (customerId) {
        const c = customersById.get(customerId);
        if (c?.source) return c.source;
      }
      return UNCLASSIFIED_KEY;
    };
    const sourceAgg: Record<string, { revenue: number; orderCount: number }> = {};
    const sourceByDate: Record<string, Record<string, number>> = {};
    const accrueSource = (key: string, dateKey: string, amount: number) => {
      if (!sourceAgg[key]) sourceAgg[key] = { revenue: 0, orderCount: 0 };
      sourceAgg[key].revenue += amount;
      sourceAgg[key].orderCount += 1;
      if (!sourceByDate[dateKey]) sourceByDate[dateKey] = {};
      sourceByDate[dateKey][key] = (sourceByDate[dateKey][key] || 0) + amount;
    };

    let totalSales = 0;
    let invoiceSalesAcc = 0;
    let totalItemsSold = 0;
    let totalDiscounts = 0;
    let totalUnpaid = 0;
    const salesByDate: Record<string, { sales: number; orders: number; itemsSold: number }> = {};
    const productPerformance: Record<string, { quantity: number; revenue: number }> = {};
    const categoryPerformance: Record<string, number> = {};
    const customerPerformance: Record<string, { totalSpent: number; orderCount: number; resolvedName?: string }> = {};
    
    // Process Invoices
    filteredInvoices.forEach(invoice => {
      if (!invoice) return;
      const invAmount = invoice.grandTotal || 0;
      totalSales += invAmount;
      invoiceSalesAcc += invAmount;
      totalDiscounts += invoice.discountAmount || 0;
      totalUnpaid += Math.max(0, invoice.balanceDue || 0);

      const dateKey = format(startOfDay(parseISO(getInvoiceRevenueDate(invoice, ordersById))), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0, itemsSold: 0 };
      }
      salesByDate[dateKey].sales += invoice.grandTotal || 0;
      salesByDate[dateKey].orders += 1;

      accrueSource(resolveSource(invoice.acquisitionSource, invoice.customerId), dateKey, invAmount);

      // Use customerId if present; otherwise fall back to the stored name so named
      // customers without a linked account aren't all collapsed into "Walk-in".
      const customerKey = invoice.customerId || (invoice.customerName ? `name:${invoice.customerName}` : 'walk-in');
      if (!customerPerformance[customerKey]) {
        customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0, resolvedName: invoice.customerName || undefined };
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
    // Use subtotal (the full order value) — grandTotal is subtotal minus advance,
    // which would understate revenue since the advance is still earned income.
    let orderSales = 0;
    filteredOrders.forEach(order => {
      if (!order) return;
      const amount = order.subtotal || 0;
      totalSales += amount;
      orderSales += amount;

      const dateKey = format(startOfDay(parseISO(order.createdAt)), 'yyyy-MM-dd');
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = { sales: 0, orders: 0, itemsSold: 0 };
      }
      salesByDate[dateKey].sales += order.subtotal || 0;
      salesByDate[dateKey].orders += 1;

      accrueSource(resolveSource(order.source, order.customerId), dateKey, amount);

      const customerKey = order.customerId || (order.customerName ? `name:${order.customerName}` : 'walk-in');
      if (!customerPerformance[customerKey]) {
        customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0, resolvedName: order.customerName || undefined };
      }
      customerPerformance[customerKey].totalSpent += order.subtotal || 0;
      customerPerformance[customerKey].orderCount += 1;
    });

    // Process Additional Revenue — must happen BEFORE salesOverTime is built
    // so extra revenue entries appear in the chart.
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

    const totalOrders = filteredInvoices.length + filteredOrders.length;
    const orderRevenueTotal = invoiceSalesAcc + orderSales;
    calcData.averageOrderValue = totalOrders > 0 ? orderRevenueTotal / totalOrders : 0;
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
      .map(([key, data]) => {
        if (key === 'walk-in') {
          return { customerId: undefined, customerName: 'Walk-in Customer', totalSpent: data.totalSpent, orderCount: data.orderCount };
        }
        if (key.startsWith('name:')) {
          // Named customer without a linked account — use the stored name directly
          return { customerId: undefined, customerName: key.slice(5), totalSpent: data.totalSpent, orderCount: data.orderCount };
        }
        // Linked customer — look up current name from store
        const customerDetails = customers.find(c => c.id === key);
        return {
          customerId: key,
          customerName: customerDetails?.name || data.resolvedName || 'Walk-in Customer',
          totalSpent: data.totalSpent, orderCount: data.orderCount,
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);
      
    calcData.totalSales = totalSales;
    calcData.invoiceSales = invoiceSalesAcc;
    calcData.orderSales = orderSales;
    calcData.extraRevenue = extraRevenue;
    calcData.totalUnpaid = totalUnpaid;
    calcData.totalOrders = totalOrders;
    calcData.totalItemsSold = totalItemsSold;
    calcData.totalDiscounts = totalDiscounts;

    // ── Acquisition source ────────────────────────────────────────────────
    // Build a breakdown row per source that has at least one sale, ordered by
    // the canonical SOURCE_KEYS so the four real sources lead and Unclassified
    // trails. avgOrderValue divides revenue by the number of sales for that key.
    calcData.sourceBreakdown = SOURCE_KEYS
      .filter(key => sourceAgg[key] && sourceAgg[key].orderCount > 0)
      .map(key => {
        const agg = sourceAgg[key];
        return {
          key,
          label: SOURCE_LABELS[key],
          revenue: agg.revenue,
          orderCount: agg.orderCount,
          avgOrderValue: agg.orderCount > 0 ? agg.revenue / agg.orderCount : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Only chart sources that actually have data, preserving canonical order.
    calcData.sourceActiveKeys = SOURCE_KEYS.filter(
      key => sourceAgg[key] && sourceAgg[key].orderCount > 0,
    );

    // One row per date (chronological) with a revenue value for every active
    // source key, defaulting missing keys to 0 so the lines stay continuous.
    calcData.sourceTrend = Object.keys(sourceByDate)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map(date => {
        const row: SourceTrendData = { date };
        calcData.sourceActiveKeys.forEach(key => {
          row[key] = sourceByDate[date][key] || 0;
        });
        return row;
      });

    // ── Cash flow ─────────────────────────────────────────────────────────
    // Cash IN = invoice payments collected in this period + order advances
    // received in this period + extra revenue logged in this period.
    // Cash OUT = expenses paid in this period.
    // We iterate ALL invoices (not just filteredInvoices) because a payment
    // recorded in the date range may belong to an invoice created earlier.
    let cashInFromInvoicePayments = 0;
    const rangeFrom = dateRange?.from ? startOfDay(dateRange.from) : null;
    const rangeTo = dateRange?.to ? endOfDay(dateRange.to) : (dateRange?.from ? endOfDay(new Date()) : null);
    generatedInvoices.forEach(inv => {
      if (!inv || inv.status === 'Refunded' || !Array.isArray(inv.paymentHistory)) return;
      inv.paymentHistory.forEach(p => {
        if (!p?.date) return;
        const d = parseISO(p.date);
        if (rangeFrom && rangeTo && !isWithinInterval(d, { start: rangeFrom, end: rangeTo })) return;
        cashInFromInvoicePayments += Number(p.amount || 0);
      });
    });

    const cashInFromOrderAdvances = filteredOrders.reduce((s, o) =>
      s + (Number(o?.advancePayment) || 0) + (Number(o?.advanceInExchangeValue) || 0), 0);
    const cashInFromExtraRevenue = filteredAdditionalRevenues.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
    const cashIn = cashInFromInvoicePayments + cashInFromOrderAdvances + cashInFromExtraRevenue;
    const cashOut = calcData.totalExpenses; // every logged expense is cash out
    calcData.cashIn = cashIn;
    calcData.cashInFromInvoicePayments = cashInFromInvoicePayments;
    calcData.cashInFromOrderAdvances = cashInFromOrderAdvances;
    calcData.cashInFromExtraRevenue = cashInFromExtraRevenue;
    calcData.cashOut = cashOut;
    calcData.netCashFlow = cashIn - cashOut;

    return calcData;

  }, [filteredInvoices, filteredOrders, filteredExpenses, filteredAdditionalRevenues, products, categories, customers, generatedInvoices, dateRange, ordersById]);
  
  const dailyBreakdown = useMemo(() => {
    if (!selectedDayData) return { invoices: [], products: [] };
    const dayInvoices = filteredInvoices.filter(invoice => format(startOfDay(parseISO(getInvoiceRevenueDate(invoice, ordersById))), 'yyyy-MM-dd') === selectedDayData.date);
    const dayProducts: DailySummaryItem[] = dayInvoices.flatMap(invoice => 
        (invoice.items || []).map(item => ({
            ...item,
            invoiceId: invoice.id,
            customerName: invoice.customerName || 'Walk-in'
        }))
    );
    return { invoices: dayInvoices, products: dayProducts };
  }, [selectedDayData, filteredInvoices, ordersById]);


  if (isLoading) {
    return (
        <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <BoardSkeleton tiles={4} panels={2} />
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
      
      <header className="flex flex-col gap-3 mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary">Store Analytics</h1>
              <p className="text-muted-foreground text-sm">Sales, products &amp; customer insights.</p>
          </div>
          <DateRangePicker date={dateRange} onDateChange={(r) => { setDateRange(r); setActiveQuickSelect('custom'); }} />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Quick:</span>
          {([
            { key: 'last-30', label: 'Last 30 Days', short: '30d' },
            { key: 'last-90', label: 'Last 90 Days', short: '90d' },
            { key: 'this-year', label: 'This Year', short: 'This Yr' },
            { key: 'last-year', label: 'Last Year', short: 'Last Yr' },
            { key: 'all-time', label: 'All Time', short: 'All' },
          ] as const).map(btn => (
            <Button key={btn.key} variant={activeQuickSelect === btn.key ? 'default' : 'outline'} size="sm" className="text-xs px-2.5 h-7" onClick={() => handleQuickSelect(btn.key)}>
              <span className="hidden sm:inline">{btn.label}</span>
              <span className="sm:hidden">{btn.short}</span>
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
          {/* Key metrics in two tiers rather than nine equal tiles. The four money
              figures get the room; the counts sit underneath at half the weight.
              One flat five-across strip read as cramped — everything shouting
              at the same volume is the same problem as nine full Cards. */}
          {(() => {
            const netProfit = analyticsData.totalSales - analyticsData.totalExpenses;
            const estProfit = analyticsData.totalSales * 0.40;
            const margin = analyticsData.totalSales > 0 ? (netProfit / analyticsData.totalSales) * 100 : 0;
            const money = (n: number) => `PKR ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

            const money_tiles = [
              {
                label: 'Revenue', value: money(analyticsData.totalSales), tone: 'text-success',
                icon: <DollarSign className="h-4 w-4" />,
                sub: [
                  `Invoices ${money(analyticsData.invoiceSales)}`,
                  analyticsData.orderSales > 0 ? `Orders ${money(analyticsData.orderSales)}` : null,
                  analyticsData.extraRevenue > 0 ? `Extra ${money(analyticsData.extraRevenue)}` : null,
                ].filter(Boolean).join(' · '),
              },
              { label: 'Expenses', value: money(analyticsData.totalExpenses), tone: 'text-destructive', icon: <CreditCard className="h-4 w-4" />, sub: 'paid out in this period' },
              { label: 'Est. profit', value: money(estProfit), tone: 'text-blue-600', icon: <TrendingUp className="h-4 w-4" />, sub: 'revenue × 40%, before expenses' },
              {
                label: 'Net profit', value: money(netProfit),
                tone: netProfit >= 0 ? 'text-success' : 'text-destructive',
                icon: netProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />,
                sub: analyticsData.totalSales > 0 ? `${margin.toFixed(1)}% margin` : 'no revenue in period',
                border: netProfit >= 0 ? 'border-success/40' : 'border-destructive/40',
              },
            ];

            const counts = [
              ...(analyticsData.totalUnpaid > 0 ? [{ label: 'Outstanding', value: money(analyticsData.totalUnpaid), tone: 'text-warning' }] : []),
              { label: 'Orders', value: String(analyticsData.totalOrders) },
              { label: 'Avg. order', value: money(analyticsData.averageOrderValue) },
              { label: 'Items sold', value: String(analyticsData.totalItemsSold) },
              { label: 'Discounts', value: money(analyticsData.totalDiscounts) },
              { label: 'Items / order', value: analyticsData.averageItemsPerOrder.toFixed(2) },
            ];

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {money_tiles.map(t => (
                    <div key={t.label} className={cn('rounded-xl border bg-card p-4 min-w-0', t.border)}>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="flex-shrink-0">{t.icon}</span>
                        <span className="text-xs uppercase tracking-wide truncate">{t.label}</span>
                      </div>
                      <p className={cn('text-2xl font-bold tabular-nums leading-tight mt-1.5 truncate', t.tone)} title={t.value}>
                        {t.value}
                      </p>
                      {t.sub && <p className="text-xs text-muted-foreground truncate mt-1" title={t.sub}>{t.sub}</p>}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {counts.map(c => (
                    <div key={c.label} className="rounded-lg border bg-card/60 px-3 py-2 min-w-0">
                      <p className="text-2xs uppercase tracking-wide text-muted-foreground truncate">{c.label}</p>
                      <p className={cn('text-base font-semibold tabular-nums truncate', c.tone)}>{c.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Cash Flow ── */}
          {(() => {
            const { cashIn, cashOut, netCashFlow, cashInFromInvoicePayments, cashInFromOrderAdvances, cashInFromExtraRevenue } = analyticsData;
            const accrualVsCashGap = analyticsData.totalSales - cashIn;
            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-5 w-5" /> Cash Flow
                  </CardTitle>
                  <CardDescription>
                    Actual money in vs out during this period. Different from revenue above — revenue counts what you&apos;ve <em>earned</em> (including future cash from open orders &amp; unpaid invoices). Cash flow counts only what physically moved.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Plain panels, not Cards: these already sit inside the
                        Cash Flow card, and a card inside a card reads as two
                        competing surfaces. */}
                    <div className="rounded-lg border border-success/40 p-4">
                      <div className="flex flex-row items-center justify-between pb-2">
                        <h4 className="text-sm font-medium">Cash In</h4>
                        <TrendingUp className="h-4 w-4 text-success" />
                      </div>
                      <div className="text-xl sm:text-2xl font-bold text-success">
                        PKR {cashIn.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Invoice payments: PKR {cashInFromInvoicePayments.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {cashInFromOrderAdvances > 0 && <> · Advances incl. trade-ins: PKR {cashInFromOrderAdvances.toLocaleString(undefined, { maximumFractionDigits: 0 })}</>}
                        {cashInFromExtraRevenue > 0 && <> · Extra: PKR {cashInFromExtraRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</>}
                      </p>
                    </div>
                    <div className="rounded-lg border border-destructive/40 p-4">
                      <div className="flex flex-row items-center justify-between pb-2">
                        <h4 className="text-sm font-medium">Cash Out</h4>
                        <TrendingDown className="h-4 w-4 text-destructive" />
                      </div>
                      <div className="text-xl sm:text-2xl font-bold text-destructive">
                        PKR {cashOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Every expense paid in this period</p>
                    </div>
                    <div className={cn('rounded-lg border p-4 col-span-2 lg:col-span-1', netCashFlow >= 0 ? 'border-success/40 bg-success/10' : 'border-destructive/40 bg-destructive/10')}>
                      <div className="flex flex-row items-center justify-between pb-2">
                        <h4 className="text-sm font-medium">Net Cash Flow</h4>
                        {netCashFlow >= 0
                          ? <TrendingUp className="h-4 w-4 text-success" />
                          : <TrendingDown className="h-4 w-4 text-destructive" />}
                      </div>
                      <div className={cn('text-xl sm:text-2xl font-bold', netCashFlow >= 0 ? 'text-success' : 'text-destructive')}>
                        {netCashFlow >= 0 ? '+' : '−'}PKR {Math.abs(netCashFlow).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {netCashFlow >= 0 ? 'Business gained cash in this period' : 'Business spent more cash than it took in'}
                      </p>
                    </div>
                  </div>
                  {accrualVsCashGap > 0 && (
                    <div className="mt-3 rounded-md border bg-warning/10 border-warning/40 p-3 text-xs text-warning">
                      <span className="font-semibold">PKR {accrualVsCashGap.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> of recognised revenue is <em>not yet collected</em> — sitting as customer receivables and uninvoiced open orders. That gap is the difference between &ldquo;Total Revenue&rdquo; (accrual) and &ldquo;Cash In&rdquo;.
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Yearly Performance Summary — not affected by date filter */}
          {yearlySummary.length > 0 && (
            <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" /> Yearly Performance Overview
                </CardTitle>
                <CardDescription>All-time revenue, expenses &amp; profit by year. Click a row to filter analytics to that year.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Year</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right text-warning hidden sm:table-cell">Unpaid</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Expenses</TableHead>
                      <TableHead className="text-right text-blue-600 hidden md:table-cell">Est. Profit (40%)</TableHead>
                      <TableHead className="text-right">Net Profit</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Margin</TableHead>
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
                        <TableCell className="text-right font-medium text-warning hidden sm:table-cell">
                          {row.unpaid > 0 ? row.unpaid.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-destructive hidden sm:table-cell">{row.expenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell className="text-right font-medium text-blue-600 hidden md:table-cell">
                          {(row.revenue * 0.40).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${row.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {row.netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                          {row.revenue > 0 ? `${((row.netProfit / row.revenue) * 100).toFixed(1)}%` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Charts Section */}
          <Card className="lg:col-span-2 animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
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

          {/* Month-by-month revenue — full history, independent of the filter */}
          {monthlyRevenue.data.length > 0 && (
            <Card className="lg:col-span-2 animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '340ms', animationFillMode: 'both' }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />Revenue by Month
                </CardTitle>
                <CardDescription>
                  Every month on record, regardless of the date filter above.
                  {monthlyRevenue.average > 0 && (
                    <> Averaging <span className="font-medium text-foreground">PKR {Math.round(monthlyRevenue.average).toLocaleString()}</span> across months with sales.</>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="pl-2">
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={monthlyRevenue.data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="month"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={8}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `PKR ${Number(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
                      contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      formatter={(value: number, _name: string, entry: { payload?: { sales?: number } }) => [
                        `PKR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}${entry?.payload?.sales ? ` · ${entry.payload.sales} sale${entry.payload.sales === 1 ? '' : 's'}` : ''}`,
                        'Revenue',
                      ]}
                    />
                    {monthlyRevenue.average > 0 && (
                      <ReferenceLine
                        y={monthlyRevenue.average}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 4"
                        label={{ value: 'avg', position: 'right', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                    )}
                    <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                      {/* The best month is picked out so the peak is findable at a glance. */}
                      {monthlyRevenue.data.map(d => (
                        <Cell key={d.key} fill={d.key === monthlyRevenue.best ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
            
          <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
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
                        <TableHead className="text-right">Sales (PKR)</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Items</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.salesOverTime.map((day) => (
                        <TableRow key={day.date} onClick={() => handleDayClick(day)} className="cursor-pointer hover:bg-muted/50">
                          <TableCell className="font-medium">
                            <span className="hidden sm:inline">{format(parseISO(day.date), 'EEE, MMM d, yyyy')}</span>
                            <span className="sm:hidden">{format(parseISO(day.date), 'MMM d')}</span>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{day.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                          <TableCell className="text-right">{day.orders}</TableCell>
                          <TableCell className="text-right hidden sm:table-cell">{day.itemsSold}</TableCell>
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
            <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
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

            <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
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
            <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
              <CardHeader>
                <CardTitleLink title="Sales by Category" href="/analytics/categories">
                    <CardDescription>Revenue distribution for the selected period.</CardDescription>
                </CardTitleLink>
              </CardHeader>
              <CardContent className="pl-2">
                {analyticsData.salesByCategory.filter(c => c.sales > 0).length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={analyticsData.salesByCategory.filter(c => c.sales > 0)} layout="vertical" margin={{ right: 10, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value/1000).toFixed(0)}k`} />
                        <YAxis dataKey="categoryName" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={85} interval={0} />
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

            <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
              <CardHeader>
                <CardTitle>Expenses by Category</CardTitle>
                <CardDescription>Spending distribution for the selected period.</CardDescription>
              </CardHeader>
              <CardContent className="pl-2">
                {analyticsData.expensesByCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={analyticsData.expensesByCategory} layout="vertical" margin={{ right: 10, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value/1000).toFixed(0)}k`} />
                        <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={85} interval={0} />
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
             <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
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

          {/* ── Acquisition Source / Walk-in Insights ── */}
          <Card className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" /> Acquisition Source Insights
              </CardTitle>
              <CardDescription>
                Where revenue comes from by how the customer found the store — walk-in, referral, Taheri spillover &amp; other. Source resolves from the order/invoice override first, then the linked customer&apos;s saved source. Sales with neither are &ldquo;Unclassified&rdquo;.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analyticsData.sourceBreakdown.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Breakdown table */}
                  <div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">Share</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">Avg</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          // Share is relative to total source-attributed revenue (not
                          // overall Total Revenue, which also includes additional
                          // revenue that has no acquisition source) so the column sums
                          // to 100%.
                          const sourceRevenueTotal = analyticsData.sourceBreakdown.reduce((s, r) => s + r.revenue, 0);
                          return analyticsData.sourceBreakdown.map((row) => {
                          const share = sourceRevenueTotal > 0 ? (row.revenue / sourceRevenueTotal) * 100 : 0;
                          return (
                            <TableRow key={row.key}>
                              <TableCell>
                                <div className="flex items-center gap-2 font-medium">
                                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[row.key] }} />
                                  {row.label}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{row.orderCount}</TableCell>
                              <TableCell className="text-right font-semibold">{row.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                              <TableCell className="text-right text-muted-foreground hidden sm:table-cell">{share.toFixed(1)}%</TableCell>
                              <TableCell className="text-right text-muted-foreground hidden sm:table-cell">{row.avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                            </TableRow>
                          );
                          });
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Trend chart */}
                  <div className="pl-2">
                    {analyticsData.sourceTrend.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={analyticsData.sourceTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => format(parseISO(value), 'MMM d')} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value / 1000).toFixed(0)}k`} />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                            labelStyle={{ color: 'hsl(var(--foreground))' }}
                            itemStyle={{ color: 'hsl(var(--foreground))' }}
                            labelFormatter={(label) => format(parseISO(label as string), 'EEE, MMM d, yyyy')}
                            formatter={(value: number, name: string) => [`PKR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name]}
                          />
                          <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
                          {analyticsData.sourceActiveKeys.map((key) => (
                            <Line
                              key={key}
                              type="monotone"
                              dataKey={key}
                              name={SOURCE_LABELS[key]}
                              stroke={SOURCE_COLORS[key]}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 5, fill: SOURCE_COLORS[key], strokeWidth: 0 }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-muted-foreground text-center py-10">No source trend data for the selected period.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-10">No acquisition-source data available for the selected period.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
