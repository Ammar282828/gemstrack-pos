
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Order } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar } from "@/components/ui/calendar"
import { Badge } from '@/components/ui/badge';
import { format, parseISO, startOfDay } from 'date-fns';
import { Loader2, ClipboardList, FileText, Calendar as CalendarIcon, ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "@/components/ui/drawer"
import { Button } from '@/components/ui/button';

type CalendarEventType = (Invoice | Order) & { eventType: 'invoice' | 'order' };

type EventsByDate = {
  [date: string]: {
    invoices: number;
    orders: number;
    events: CalendarEventType[];
  };
};


const EventDetails: React.FC<{ events: CalendarEventType[] | undefined }> = ({ events }) => {
    if (!events) {
        return <p className="text-muted-foreground text-center py-10">Select a day on the calendar to see events.</p>;
    }
    
    if (events.length === 0) {
        return <p className="text-muted-foreground text-center py-10">No events for this day.</p>;
    }

    return (
        <div className="space-y-4">
            {events.map(event => (
               <Link href={event.eventType === 'order' ? `/orders/${event.id}` : `/cart?invoice_id=${event.id}`} key={event.id} passHref>
                <div key={event.id} className={cn("p-3 rounded-md border-l-4 hover:bg-muted/50 block cursor-pointer transition-colors", {
                    'border-green-500': event.eventType === 'invoice',
                    'border-blue-500': event.eventType === 'order'
                })}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {event.eventType === 'invoice' ? <FileText className="h-4 w-4 text-green-500" /> : <ClipboardList className="h-4 w-4 text-blue-500"/>}
                            <Badge variant="outline" className="text-xs">{event.id}</Badge>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="font-semibold text-sm mt-1">PKR {('grandTotal' in event) ? event.grandTotal.toLocaleString() : 'N/A'}</p>
                    <p className="text-xs text-muted-foreground">{('customerName' in event) ? event.customerName : 'Walk-in'}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(event.createdAt), 'hh:mm a')}</p>
                </div>
               </Link>
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

  const eventsByDate = useMemo((): EventsByDate => {
    const eventsMap: EventsByDate = {};

    generatedInvoices.forEach(invoice => {
      const dateKey = format(startOfDay(parseISO(invoice.createdAt)), 'yyyy-MM-dd');
      if (!eventsMap[dateKey]) {
        eventsMap[dateKey] = { invoices: 0, orders: 0, events: [] };
      }
      eventsMap[dateKey].invoices++;
      eventsMap[dateKey].events.push({ ...invoice, eventType: 'invoice' });
    });

    orders.forEach(order => {
      const dateKey = format(startOfDay(parseISO(order.createdAt)), 'yyyy-MM-dd');
       if (!eventsMap[dateKey]) {
        eventsMap[dateKey] = { invoices: 0, orders: 0, events: [] };
      }
      eventsMap[dateKey].orders++;
      eventsMap[dateKey].events.push({ ...order, eventType: 'order' });
    });

    // Sort events within each day
    Object.values(eventsMap).forEach(day => {
        day.events.sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
    });
    
    return eventsMap;
  }, [generatedInvoices, orders]);

  const selectedDateString = selectedDate ? format(startOfDay(selectedDate), 'yyyy-MM-dd') : undefined;
  const eventsForSelectedDay = selectedDateString ? eventsByDate[selectedDateString]?.events : [];

  const handleDayClick = (day: Date | undefined) => {
    setSelectedDate(day);
    if(isMobile) {
        setIsDrawerOpen(true);
    }
  };

  const EventDay = ({ date }: { date: Date }) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const dayData = eventsByDate[dateKey];
    
    if (!dayData) return null;

    return (
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
        {dayData.invoices > 0 && <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>}
        {dayData.orders > 0 && <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading calendar data...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center"><CalendarIcon className="mr-3 h-8 w-8"/>Activity Calendar</h1>
        <p className="text-muted-foreground">Visualize your sales and custom orders over time.</p>
        <div className="flex items-center gap-4 mt-2 text-sm">
            <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-green-500"></div> Sales Invoices</div>
            <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-blue-500"></div> Custom Orders</div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2">
            <CardContent className="p-2 md:p-4">
                 <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDayClick}
                    className="p-0 [&_td]:p-0"
                    classNames={{
                      day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                      day: "h-12 w-12 md:h-16 lg:h-20 w-full",
                      head_cell: "w-full",
                    }}
                    components={{
                        DayContent: (props) => (
                           <div className="relative w-full h-full flex items-center justify-center">
                             <p>{format(props.date, 'd')}</p>
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
                     <ScrollArea className="h-[50vh] px-4">
                         <EventDetails events={eventsForSelectedDay} />
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
                        {eventsForSelectedDay ? `${eventsForSelectedDay.length} event(s) found.` : 'No events for this day.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[500px] pr-4">
                       <EventDetails events={eventsForSelectedDay} />
                    </ScrollArea>
                </CardContent>
            </Card>
        )}
      </div>
    </div>
  );
}
