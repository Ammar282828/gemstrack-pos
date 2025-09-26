
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, Order, Invoice } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, FileText, ClipboardList, AlertTriangle } from 'lucide-react';
import { format, parseISO, isWithinInterval, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { useRouter } from 'next/navigation';


type DocumentType = (Order | Invoice) & { docType: 'order' | 'invoice' };

const getStatusBadgeVariant = (status: Order['status'] | 'Paid' | 'Unpaid') => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
      case 'Paid': return 'bg-green-600/80 text-green-50';
      case 'Unpaid': return 'bg-orange-500/80 text-orange-50';
      default: return 'secondary';
    }
};

const DocumentRow: React.FC<{ doc: DocumentType }> = ({ doc }) => {
    const router = useRouter();

    const handleRowClick = () => {
        if (doc.docType === 'order') {
            router.push(`/orders/${doc.id}`);
        } else {
            router.push(`/cart?invoice_id=${doc.id}`);
        }
    };
    
    const isPaid = doc.docType === 'invoice' ? doc.balanceDue <= 0 : false;
    const invoiceStatus = doc.docType === 'invoice' ? (isPaid ? 'Paid' : 'Unpaid') : undefined;

    return (
        <TableRow onClick={handleRowClick} className="cursor-pointer">
            <TableCell>
                 <div className="font-medium text-primary hover:underline">{doc.id}</div>
            </TableCell>
            <TableCell>{doc.customerName || 'Walk-in'}</TableCell>
            <TableCell>{format(parseISO(doc.createdAt), 'dd MMM, yyyy')}</TableCell>
            <TableCell>
                <Badge variant={doc.docType === 'order' ? 'secondary' : 'default'} className="capitalize flex items-center gap-1">
                    {doc.docType === 'order' ? <ClipboardList className="h-3 w-3"/> : <FileText className="h-3 w-3"/>}
                    {doc.docType}
                </Badge>
            </TableCell>
            <TableCell className="text-right">PKR {doc.grandTotal.toLocaleString()}</TableCell>
             <TableCell>
                <Badge className={cn("border-transparent capitalize", getStatusBadgeVariant(doc.docType === 'order' ? doc.status : invoiceStatus!))}>
                     {doc.docType === 'order' ? doc.status : invoiceStatus}
                </Badge>
            </TableCell>
        </TableRow>
    );
};


export default function DocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const appReady = useAppReady();
  const { orders, invoices, isOrdersLoading, isInvoicesLoading, loadOrders, loadGeneratedInvoices } = useAppStore(state => ({
    orders: state.orders,
    invoices: state.generatedInvoices,
    isOrdersLoading: state.isOrdersLoading,
    isInvoicesLoading: state.isInvoicesLoading,
    loadOrders: state.loadOrders,
    loadGeneratedInvoices: state.loadGeneratedInvoices
  }));
  
  useEffect(() => {
    if (appReady) {
      loadOrders();
      loadGeneratedInvoices();
    }
  }, [appReady, loadOrders, loadGeneratedInvoices]);

  const isLoading = isOrdersLoading || isInvoicesLoading;

  const combinedDocuments: DocumentType[] = useMemo(() => {
    if (!appReady) return [];
    const orderDocs: DocumentType[] = (orders || []).map(o => ({ ...o, docType: 'order' }));
    const invoiceDocs: DocumentType[] = (invoices || []).map(i => ({ ...i, docType: 'invoice' }));
    return [...orderDocs, ...invoiceDocs].sort((a,b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
  }, [appReady, orders, invoices]);


  const filteredDocuments = useMemo(() => {
    let docs = combinedDocuments;
    
    if (dateRange?.from) {
      docs = docs.filter(doc => {
        const docDate = parseISO(doc.createdAt);
        const toDate = dateRange.to ? startOfDay(dateRange.to) : startOfDay(new Date()); 
        return isWithinInterval(docDate, { start: startOfDay(dateRange.from!), end: toDate });
      });
    }

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      docs = docs.filter(doc => 
        doc.id.toLowerCase().includes(lowerSearchTerm) ||
        (doc.customerName && doc.customerName.toLowerCase().includes(lowerSearchTerm))
      );
    }
    
    return docs;
  }, [combinedDocuments, dateRange, searchTerm]);

  const renderTable = (docs: DocumentType[]) => {
      if (isLoading) {
         return (
            <div className="text-center py-12">
                <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
                <p className="text-muted-foreground">Fetching documents...</p>
            </div>
         );
      }
      if (docs.length === 0) {
          return (
             <div className="text-center py-12 bg-card rounded-lg shadow-sm">
                <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Documents Found</h3>
                <p className="text-muted-foreground">
                    {searchTerm || dateRange ? "Try adjusting your search or filter." : "No orders or invoices have been created yet."}
                </p>
            </div>
          );
      }
      return (
        <Card>
            <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Total (PKR)</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {docs.map((doc) => <DocumentRow key={`${doc.docType}-${doc.id}`} doc={doc} />)}
            </TableBody>
            </Table>
        </Card>
      );
  };
  
  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><FileText className="w-8 h-8 mr-3"/>Documents</h1>
          <p className="text-muted-foreground">Search and manage all invoices and custom orders.</p>
        </div>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative flex-grow w-full">
                    <Input
                    type="search"
                    placeholder="Search by ID or Customer Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                </div>
                <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full md:w-auto md:justify-self-end" />
            </div>
        </CardContent>
      </Card>
      
      <Tabs defaultValue="all">
        <TabsList className="grid w-full grid-cols-3 md:w-fit md:grid-cols-3 mb-4">
          <TabsTrigger value="all">All ({filteredDocuments.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({filteredDocuments.filter(d => d.docType === 'invoice').length})</TabsTrigger>
          <TabsTrigger value="orders">Orders ({filteredDocuments.filter(d => d.docType === 'order').length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          {renderTable(filteredDocuments)}
        </TabsContent>
        <TabsContent value="invoices">
          {renderTable(filteredDocuments.filter(d => d.docType === 'invoice'))}
        </TabsContent>
        <TabsContent value="orders">
          {renderTable(filteredDocuments.filter(d => d.docType === 'order'))}
        </TabsContent>
      </Tabs>
      
    </div>
  );
}
