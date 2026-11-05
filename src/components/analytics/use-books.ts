'use client';

/**
 * The shop's books for the range in the address, for every Analytics page: loads the six stores as the old page did,
 * works the figures out (lib/analytics/books.ts) and the same for the period before, for the "vs last month" pills.
 * Needs a <Suspense> above it (useAnalyticsRange reads the address).
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DateRange } from 'react-day-picker';
import { useAppStore } from '@/lib/store';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { computeBooks, previousPeriod, type Books, type BooksInput } from '@/lib/analytics/books';

export interface UseBooks {
  loading: boolean;
  /** The first load error, if any. */
  error: string | null;
  /** What the figures are worked from (monthlySeries, yearlySummary and monthlyRevenue take it). */
  input: BooksInput;
  /** The quick range's key (`this-month`, `last-30`, `custom`, …). */
  rangeKey: string;
  /** Undefined is all time. */
  range: DateRange | undefined;
  setQuick: (key: string) => void;
  setCustom: (range: DateRange | undefined) => void;
  /** A link to another Analytics page that keeps this range; an `#anchor` stays last. */
  withRange: (href: string) => string;
  /** Null while loading. */
  books: Books | null;
  /** The period before (same days of last month, last year, or the same length before); null for all time. */
  prevBooks: Books | null;
  /** After "vs": "last month", "previous 7 days". Null with no previous period. */
  previousLabel: string | null;
  /** The shop has any invoice, order or expense at all. */
  hasAnyData: boolean;
}

export function useBooks(): UseBooks {
  const s = useAppStore(useShallow(st => ({
    invoices: st.generatedInvoices, orders: st.orders, products: st.products, categories: st.categories, customers: st.customers,
    expenses: st.expenses, additionalRevenues: st.additionalRevenues,
    isLoading: st.isInvoicesLoading || st.isOrdersLoading || st.isProductsLoading || st.isCustomersLoading || st.isExpensesLoading || st.isAdditionalRevenueLoading,
    error: st.invoicesError || st.ordersError || st.productsError || st.customersError || st.expensesError || null,
    loadGeneratedInvoices: st.loadGeneratedInvoices, loadOrders: st.loadOrders, loadProducts: st.loadProducts,
    loadCustomers: st.loadCustomers, loadExpenses: st.loadExpenses, loadAdditionalRevenues: st.loadAdditionalRevenues,
  })));
  const { loadGeneratedInvoices, loadOrders, loadProducts, loadCustomers, loadExpenses, loadAdditionalRevenues } = s;

  useEffect(() => {
    loadGeneratedInvoices();
    loadOrders();
    loadProducts();
    loadCustomers();
    loadExpenses();
    loadAdditionalRevenues();
  }, [loadGeneratedInvoices, loadOrders, loadProducts, loadCustomers, loadExpenses, loadAdditionalRevenues]);

  // The range lives in the address, shared by every Analytics page (use-analytics-range.ts).
  const { key: rangeKey, range, setQuick, setCustom, withRange: keepRange } = useAnalyticsRange();
  const withRange = useCallback((href: string) => {
    const i = href.indexOf('#');
    return i < 0 ? keepRange(href) : `${keepRange(href.slice(0, i))}${href.slice(i)}`;
  }, [keepRange]);

  const input = useMemo<BooksInput>(() => ({
    invoices: s.invoices, orders: s.orders, products: s.products, categories: s.categories, customers: s.customers,
    expenses: s.expenses, additionalRevenues: s.additionalRevenues,
  }), [s.invoices, s.orders, s.products, s.categories, s.customers, s.expenses, s.additionalRevenues]);

  const loading = s.isLoading;
  const books = useMemo(() => (loading ? null : computeBooks(input, range)), [loading, input, range]);
  const previous = useMemo(() => (range?.from ? previousPeriod(range) : null), [range]);
  const prevBooks = useMemo(() => (loading || !previous ? null : computeBooks(input, previous.range)), [loading, input, previous]);

  return {
    loading, error: s.error, input, rangeKey, range, setQuick, setCustom, withRange, books, prevBooks,
    previousLabel: previous?.label ?? null,
    hasAnyData: s.invoices.length > 0 || s.orders.length > 0 || s.expenses.length > 0,
  };
}
