
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore, ActivityLog, LOG_EVENT_TYPES, LogEventType } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, History, Filter, Calendar as CalendarIcon, User, Package, FileText, Briefcase, CreditCard } from 'lucide-react';
import { format, parseISO, isWithinInterval, startOfDay } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import type { DateRange } from "react-day-picker";
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Button } from '@/components/ui/button';

const eventIcons: Record<LogEventType, React.ReactNode> = {
    'product.create': <Package className="h-4 w-4" />,
    'product.update': <Package className="h-4 w-4" />,
    'product.delete': <Package className="h-4 w-4" />,
    'customer.create': <User className="h-4 w-4" />,
    'customer.update': <User className="h-4 w-4" />,
    'customer.delete': <User className="h-4 w-4" />,
    'karigar.create': <Briefcase className="h-4 w-4" />,
    'karigar.update': <Briefcase className="h-4 w-4" />,
    'karigar.delete': <Briefcase className="h-4 w-4" />,
    'invoice.create': <FileText className="h-4 w-4" />,
    'invoice.payment': <FileText className="h-4 w-4" />,
    'invoice.delete': <FileText className="h-4 w-4" />,
    'order.create': <FileText className="h-4 w-4" />,
    'order.update': <FileText className="h-4 w-4" />,
    'order.delete': <FileText className="h-4 w-4" />,
    'expense.create': <CreditCard className="h-4 w-4" />,
    'expense.update': <CreditCard className="h-4 w-4" />,
    'expense.delete': <CreditCard className="h-4 w-4" />,
};

const getEventTypeColor = (eventType: LogEventType) => {
    if (eventType.includes('create') || eventType.includes('payment')) return 'text-green-600';
    if (eventType.includes('update')) return 'text-blue-600';
    if (eventType.includes('delete')) return 'text-red-600';
    return 'text-muted-foreground';
};

export default function ActivityLogPage() {
    const { activityLog, isActivityLogLoading, loadActivityLog } = useAppStore();
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [typeFilter, setTypeFilter] = useState<string>('All');
    
    useEffect(() => {
        loadActivityLog();
    }, [loadActivityLog]);
    
    const filteredLogs = useMemo(() => {
        if (!activityLog || activityLog.length === 0) return [];
        return activityLog
            .filter(log => {
                if (typeFilter !== 'All' && !log.eventType.startsWith(typeFilter)) {
                    return false;
                }
                if (dateRange?.from) {
                    const logDate = parseISO(log.timestamp);
                    const toDate = dateRange.to ? startOfDay(dateRange.to) : startOfDay(new Date());
                    return isWithinInterval(logDate, { start: startOfDay(dateRange.from), end: toDate });
                }
                return true;
            })
            .sort((a,b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime());
    }, [activityLog, dateRange, typeFilter]);

    if (isActivityLogLoading && (!activityLog || activityLog.length === 0)) {
        return (
            <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
                <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
                <p className="text-lg text-muted-foreground">Loading activity log...</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto py-8 px-4 space-y-6">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-primary flex items-center"><History className="mr-3 h-8 w-8"/> Activity Log</h1>
                    <p className="text-muted-foreground">A chronological record of all significant actions taken in the system.</p>
                </div>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2"><Filter/> Filters</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row gap-4">
                     <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full sm:w-auto" />
                     <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-sm font-medium text-muted-foreground mr-2">Event Type:</span>
                        <Button
                        variant={typeFilter === 'All' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTypeFilter('All')}
                        >All</Button>
                        {LOG_EVENT_TYPES.map((cat) => (
                        <Button
                            key={cat}
                            variant={typeFilter === cat ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setTypeFilter(cat)}
                            >{cat.charAt(0).toUpperCase() + cat.slice(1)}</Button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-0">
                    <ScrollArea className="h-[65vh]">
                       {filteredLogs.length > 0 ? (
                            <div className="p-4 space-y-4">
                                {filteredLogs.map(log => (
                                    <div key={log.id} className="flex items-start gap-4 p-3 border-b">
                                        <div className="mt-1">{eventIcons[log.eventType]}</div>
                                        <div className="flex-grow">
                                            <p className={`font-semibold ${getEventTypeColor(log.eventType)}`}>{log.description}</p>
                                            <p className="text-sm text-muted-foreground">{log.details}</p>
                                        </div>
                                        <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                                            <p>{format(parseISO(log.timestamp), 'PP')}</p>
                                            <p>{format(parseISO(log.timestamp), 'p')}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                       ) : (
                           <div className="text-center text-muted-foreground py-16">
                               <History className="h-12 w-12 mx-auto mb-4"/>
                               <p className="font-semibold">No Activity Found</p>
                               <p className="text-sm">There are no log entries for the selected filters.</p>
                           </div>
                       )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
