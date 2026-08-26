
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useAppStore, Invoice, Order, getInvoiceRevenueDate } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar } from "@/components/ui/calendar"
import { Badge } from '@/components/ui/badge';
import { format, parseISO, startOfDay, isSameDay, isSameMonth, isValid } from 'date-fns';
import { ClipboardList, FileText, Calendar as CalendarIcon, ArrowRight, X, CalendarClock } from 'lucide-react';
import { isActiveOrder } from '@/lib/order-timing';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer"
import { Button } from '@/components/ui/button';

type CalendarEventType = (Invoice | Order) & { eventType: 'invoice' | 'order' };

type EventsByDate = {
  [date: string]: {
    invoices: number;
    orders: number;
    /** Money taken that day. "3 sales" alone never answered the question
     *  you actually open a calendar to ask. */
    total: number;
    events: CalendarEventType[];
  };
};

/** Compact PKR for a calendar cell, which has room for about six characters. */
function dayMoney(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}


const EventDetails: React.FC<{ events: CalendarEventType[] | undefined, selectedDate: Date | undefined }> = ({ events, selectedDate }) => {
    if (!selectedDate) {
        return <p className="text-muted-foreground text-center py-10">Select a day on the calendar to see its events.</p>;
    }
    
    if (!events || events.length === 0) {
        return <p className="text-muted-foreground text-center py-10">No events for this day.</p>;
    }

    return (
        <div className="space-y-3">
            {events.map(event => (
               <div key={event.id} className="p-3 rounded-lg border bg-muted/20 flex flex-col md:flex-row justify-between gap-2">
                    <Link href={event.eventType === 'order' ? `/orders/${event.id}` : `/cart?invoice_id=${event.id}`} passHref className="flex-grow">
                        <div className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-md p-1 -m-1">
                            <div className="flex items-center gap-2">
                                <span aria-hidden className={cn('h-2 w-2 rounded-full flex-shrink-0', event.eventType === 'invoice' ? 'bg-success' : 'bg-blue-500')} />
                                {event.eventType === 'invoice' ? <FileText className="h-4 w-4 text-success" /> : <ClipboardList className="h-4 w-4 text-blue-500"/>}
                                <Badge variant="outline" className="text-xs font-mono">{event.id}</Badge>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="mt-2 pl-1">
                          <p className="font-semibold text-sm">PKR {('grandTotal' in event) ? event.grandTotal.toLocaleString() : 'N/A'}</p>
                          <p className="text-xs text-muted-foreground">{('customerName' in event && event.customerName) ? event.customerName : 'Walk-in'}</p>
                          <p className="text-xs text-muted-foreground">{format(parseISO(event.createdAt), 'hh:mm a')}</p>
                        </div>
                    </Link>
                </div>
            ))}
        </div>
    );
};


export default function CalendarPage() {
  const { 
    generatedInvoices, orders, isInvoicesLoading, isOrdersLoading, 
    loadGeneratedInvoices, loadOrders
  } = useAppStore();

  useEffect(() => {
    loadGeneratedInvoices();
    loadOrders();
  }, [loadGeneratedInvoices, loadOrders]);

  const isLoading = isInvoicesLoading || isOrdersLoading;
  const isMobile = useIsMobile();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Tracked so the summary describes the month you are looking at, not today's.
  const [month, setMonth] = useState<Date>(new Date());

  const eventsByDate = useMemo((): EventsByDate => {
    const eventsMap: EventsByDate = {};
    // Same recognition rule as the dashboard and Analytics: a sale belongs to
    // the day its ORDER was taken, not the day it happened to be invoiced.
    // Without this the calendar disagreed with every other revenue view —
    // 32 invoices here cross a month boundary.
    const ordersById = new Map(orders.map(o => [o.id, o]));

    generatedInvoices.forEach(invoice => {
      const dateKey = format(startOfDay(parseISO(getInvoiceRevenueDate(invoice, ordersById))), 'yyyy-MM-dd');
      if (!eventsMap[dateKey]) {
        eventsMap[dateKey] = { invoices: 0, orders: 0, total: 0, events: [] };
      }
      eventsMap[dateKey].invoices++;
      if (invoice.status !== 'Refunded') eventsMap[dateKey].total += invoice.grandTotal || 0;
      eventsMap[dateKey].events.push({ ...invoice, eventType: 'invoice' });
    });

    orders.forEach(order => {
      const dateKey = format(startOfDay(parseISO(order.createdAt)), 'yyyy-MM-dd');
       if (!eventsMap[dateKey]) {
        eventsMap[dateKey] = { invoices: 0, orders: 0, total: 0, events: [] };
      }
      eventsMap[dateKey].orders++;
      // Uninvoiced orders only — an invoiced one is already counted above.
      if (!order.invoiceId && order.status !== 'Cancelled' && order.status !== 'Refunded') {
        eventsMap[dateKey].total += order.subtotal || 0;
      }
      eventsMap[dateKey].events.push({ ...order, eventType: 'order' });
    });

    // Sort events within each day
    Object.values(eventsMap).forEach(day => {
        day.events.sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
    });
    
    return eventsMap;
  }, [generatedInvoices, orders]);

  /**
   * Pieces promised on each day. Deliberately a separate map from
   * eventsByDate: that one places a sale on the day its order was TAKEN, for
   * revenue recognition, and folding a due date into it would make the money
   * on screen wrong. This layer only answers "what did I say I would hand over
   * that day".
   */
  const dueByDate = useMemo(() => {
    const map: Record<string, number> = {};
    orders.forEach(order => {
      if (!order.promisedDate || !isActiveOrder(order)) return;
      const d = parseISO(order.promisedDate);
      if (!isValid(d)) return;
      const key = format(startOfDay(d), 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [orders]);

  /** Totals for the month on screen. */
  const monthSummary = useMemo(() => {
    let sales = 0, orderCount = 0, total = 0, days = 0;
    for (const [key, d] of Object.entries(eventsByDate)) {
      if (!isSameMonth(parseISO(key), month)) continue;
      sales += d.invoices; orderCount += d.orders; total += d.total;
      if (d.total > 0) days++;
    }
    return { sales, orders: orderCount, total, days, best: total && days ? total / days : 0 };
  }, [eventsByDate, month]);

  const selectedDateString = selectedDate ? format(startOfDay(selectedDate), 'yyyy-MM-dd') : undefined;
  const eventsForSelectedDay = selectedDateString ? eventsByDate[selectedDateString]?.events : [];

  const handleDayClick = (day: Date | undefined) => {
    setSelectedDate(day);
    // Opens for any day, not only days that already have something: tapping a
    // quiet day used to do nothing at all, which reads as the app being stuck.
    if (isMobile && day) setIsDrawerOpen(true);
  };

  const EventDay = ({ date }: { date: Date }) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const dayData = eventsByDate[dateKey];
    
    const due = dueByDate[dateKey] || 0;
    // A day with nothing sold can still have a piece promised on it.
    if (!dayData && !due) return null;

    return (
      <div className="flex flex-col gap-0.5 mt-0.5 w-full">
        {dayData && dayData.total > 0 && (
          <span className="w-full text-2xs font-semibold leading-tight tabular-nums truncate">
            {dayMoney(dayData.total)}
          </span>
        )}
        <span className="flex items-center gap-1 leading-none">
          {dayData && dayData.invoices > 0 && (
            <span className="flex items-center gap-0.5 text-2xs text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />{dayData.invoices}
            </span>
          )}
          {dayData && dayData.orders > 0 && (
            <span className="flex items-center gap-0.5 text-2xs text-blue-600 dark:text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />{dayData.orders}
            </span>
          )}
          {due > 0 && (
            <span className="flex items-center gap-0.5 text-2xs text-warning" title={`${due} promised for this day`}>
              <CalendarClock className="h-2.5 w-2.5" />{due}
            </span>
          )}
        </span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 h-full">
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><CalendarIcon className="mr-3 h-8 w-8"/>Activity Calendar</h1>
        <p className="text-muted-foreground">Visualize your sales and custom orders over time.</p>
        <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
            <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-success"></div> Sales</div>
            <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-blue-500"></div> Orders</div>
            <Button variant="outline" size="sm" className="h-7 text-xs ml-auto"
              onClick={() => { const t = new Date(); setMonth(t); setSelectedDate(t); }}>
              Today
            </Button>
        </div>

        {/* What the month on screen actually came to. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {[
            { label: format(month, 'MMMM yyyy'), value: `PKR ${monthSummary.total.toLocaleString()}`, tone: 'text-success' },
            { label: 'Sales', value: String(monthSummary.sales) },
            { label: 'Orders', value: String(monthSummary.orders) },
            { label: 'Avg. trading day', value: monthSummary.best ? `PKR ${Math.round(monthSummary.best).toLocaleString()}` : '—' },
          ].map(c => (
            <div key={c.label} className="rounded-lg border bg-card px-3 py-2 min-w-0">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground truncate">{c.label}</p>
              <p className={cn('text-base font-bold tabular-nums truncate', c.tone)}>{c.value}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 overflow-hidden">
            <CardContent className="p-2 sm:p-4">
                 <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDayClick}
                    month={month}
                    onMonthChange={setMonth}
                    className="w-full"
                    classNames={{
                      months: "w-full",
                      month: "w-full space-y-3",
                      caption: "flex justify-center pt-1 relative items-center",
                      caption_label: "text-base font-semibold",
                      nav: "space-x-1 flex items-center",
                      nav_button: "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
                      nav_button_previous: "absolute left-1",
                      nav_button_next: "absolute right-1",
                      table: "w-full border-collapse",
                      head_row: "flex w-full",
                      head_cell: "text-muted-foreground rounded-md flex-1 font-normal text-xs text-center pb-1",
                      row: "flex w-full mt-1 gap-0.5",
                      cell: "flex-1 min-h-[70px] sm:min-h-[80px] rounded-md border border-border/40 p-0 relative hover:bg-accent/50 transition-colors cursor-pointer [&:has([aria-selected])]:bg-primary/10",
                      day: "w-full h-full p-1.5 flex flex-col items-start text-sm font-normal aria-selected:opacity-100",
                      day_selected: "bg-primary/10 text-foreground font-semibold rounded-md",
                      day_today: "border-primary border-2",
                      day_outside: "opacity-30",
                      day_disabled: "opacity-30 cursor-not-allowed",
                    }}
                    components={{
                        DayContent: (props) => (
                           <div className="w-full h-full flex flex-col">
                             <span className={cn(
                               "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full mb-0.5",
                               isSameDay(props.date, new Date()) && "bg-primary text-primary-foreground"
                             )}>
                               {format(props.date, 'd')}
                             </span>
                             <EventDay date={props.date} />
                           </div>
                        )
                    }}
                />
            </CardContent>
        </Card>
        
        {isMobile ? (
             <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                <DrawerContent>
                     <DrawerHeader className="text-left">
                        <DrawerTitle>
                             Events for {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : '...'}
                        </DrawerTitle>
                        <DrawerDescription>
                             {eventsForSelectedDay ? `${eventsForSelectedDay.length} event(s) found.` : 'No events for this day.'}
                        </DrawerDescription>
                    </DrawerHeader>
                     <ScrollArea className="h-[50vh] px-4 pb-4">
                         <EventDetails events={eventsForSelectedDay} selectedDate={selectedDate} />
                    </ScrollArea>
                </DrawerContent>
             </Drawer>
        ) : (
            <Card>
                <CardHeader>
                    <CardTitle>
                        Events for {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : '...'}
                    </CardTitle>
                    <CardDescription>
                        {selectedDate ? `${eventsForSelectedDay?.length || 0} event(s) found.` : 'Select a day.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[60vh] pr-4">
                       <EventDetails events={eventsForSelectedDay} selectedDate={selectedDate}/>
                    </ScrollArea>
                </CardContent>
            </Card>
        )}
      </div>
    </div>
  );
}
