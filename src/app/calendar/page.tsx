
"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Invoice, Order } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar } from "@/components/ui/calendar"
import { Badge } from '@/components/ui/badge';
import { format, parseISO, startOfDay, isSameDay } from 'date-fns';
import { Loader2, ClipboardList, FileText, Calendar as CalendarIcon, ArrowRight, X, Trash2, AlertTriangle } from 'lucide-react';
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

type CalendarEventType = (Invoice | Order) & { eventType: 'invoice' | 'order' };

type EventsByDate = {
  [date: string]: {
    invoices: number;
    orders: number;
    events: CalendarEventType[];
  };
};


const EventDetails: React.FC<{ events: CalendarEventType[] | undefined, selectedDate: Date | undefined }> = ({ events, selectedDate }) => {
    const { deleteInvoice, deleteOrder } = useAppStore();
    const { toast } = useToast();
    
    const handleDelete = async (event: CalendarEventType) => {
        try {
            if (event.eventType === 'invoice') {
                await deleteInvoice(event.id);
                toast({ title: 'Invoice Deleted', description: `Invoice ${event.id} has been removed.`});
            } else {
                await deleteOrder(event.id);
                toast({ title: 'Order Deleted', description: `Order ${event.id} has been removed.`});
            }
        } catch (e) {
            toast({ title: 'Error', description: `Failed to delete the document.`, variant: 'destructive'});
        }
    };

    if (!selectedDate) {
        return <p className="text-muted-foreground text-center py-10">Select a day on the calendar to see its events.</p>;
    }
    
    if (!events || events.length === 0) {
        return <p className="text-muted-foreground text-center py-10">No events for this day.</p>;
    }

    return (
        <div className="space-y-3">
            {events.map(event => (
               <div key={event.id} className={cn("p-3 rounded-lg border-l-4 bg-muted/20 flex flex-col md:flex-row justify-between gap-2", {
                    'border-green-500': event.eventType === 'invoice',
                    'border-blue-500': event.eventType === 'order'
                })}>
                    <Link href={event.eventType === 'order' ? `/orders/${event.id}` : `/cart?invoice_id=${event.id}`} passHref className="flex-grow">
                        <div className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-md p-1 -m-1">
                            <div className="flex items-center gap-2">
                                {event.eventType === 'invoice' ? <FileText className="h-4 w-4 text-green-500" /> : <ClipboardList className="h-4 w-4 text-blue-500"/>}
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
                    <div className="flex-shrink-0 self-end md:self-center">
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle/>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete the {event.eventType} <strong className="font-mono">{event.id}</strong> and all associated data.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(event)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
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
    if(isMobile && day && eventsByDate[format(startOfDay(day), 'yyyy-MM-dd')]) {
        setIsDrawerOpen(true);
    }
  };

  const EventDay = ({ date }: { date: Date }) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const dayData = eventsByDate[dateKey];
    
    if (!dayData) return null;

    return (
      <div className="absolute bottom-1 left-1 right-1 flex flex-col items-center text-[9px] leading-tight gap-0.5">
        {dayData.invoices > 0 && <Badge variant="secondary" className="w-full justify-start h-auto p-0.5 px-1 bg-green-500/10 text-green-700 dark:text-green-300">Sales: {dayData.invoices}</Badge>}
        {dayData.orders > 0 && <Badge variant="secondary" className="w-full justify-start h-auto p-0.5 px-1 bg-blue-500/10 text-blue-700 dark:text-blue-300">Orders: {dayData.orders}</Badge>}
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
    <div className="container mx-auto py-8 px-4 h-full">
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
            <CardContent className="p-1 md:p-2">
                 <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDayClick}
                    className="p-0"
                    classNames={{
                      day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                      day: "relative h-auto aspect-square p-1.5 align-top", // Use aspect-ratio for scaling
                      day_today: "bg-accent text-accent-foreground",
                      head_cell: "text-muted-foreground rounded-md w-full font-normal text-sm", // Let flexbox handle width
                      table: "w-full border-collapse",
                      month: "space-y-4",
                      caption_label: "text-lg font-bold"
                    }}
                    components={{
                        DayContent: (props) => (
                           <div className="relative w-full h-full flex flex-col">
                             <time dateTime={props.date.toISOString()} className={cn("self-start", isSameDay(props.date, new Date()) && "font-bold")}>
                               {format(props.date, 'd')}
                             </time>
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
