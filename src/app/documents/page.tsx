
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAppStore, Order, Invoice } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, FileText, ClipboardList, AlertTriangle, User, Calendar, DollarSign, Eye, Upload, CheckCircle2, ShoppingBag } from 'lucide-react';
import { format, parseISO, isWithinInterval, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, writeBatch, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';


type DocumentType = (Order | Invoice) & { docType: 'order' | 'invoice' };

const getStatusBadgeVariant = (status: Order['status'] | 'Paid' | 'Unpaid') => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
      case 'Refunded': return 'bg-purple-500/80 text-purple-50';
      case 'Paid': return 'bg-green-600/80 text-green-50';
      case 'Unpaid': return 'bg-orange-500/80 text-orange-50';
      default: return 'secondary';
    }
};

const getDocStatus = (doc: DocumentType): Order['status'] | 'Paid' | 'Unpaid' => {
  if (doc.docType === 'order') {
    return (doc as Order).status;
  }
  return (doc as Invoice).balanceDue <= 0 ? 'Paid' : 'Unpaid';
};

const isShopifyDoc = (doc: DocumentType): boolean =>
  doc.docType === 'invoice' && !!((doc as Invoice).source?.startsWith('shopify'));


const DocumentCard: React.FC<{ doc: DocumentType }> = ({ doc }) => {
    const router = useRouter();
    const status = getDocStatus(doc);
    
    const handleCardClick = () => {
        if (doc.docType === 'order') {
            router.push(`/orders/${doc.id}`);
        } else {
            router.push(`/cart?invoice_id=${doc.id}`);
        }
    };

    return (
        <Card className="mb-4" onClick={handleCardClick}>
            <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="font-bold text-primary hover:underline text-lg">{doc.id}</div>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <Badge variant={doc.docType === 'order' ? 'secondary' : 'default'} className="capitalize flex items-center gap-1 w-fit">
                                {doc.docType === 'order' ? <ClipboardList className="h-3 w-3"/> : <FileText className="h-3 w-3"/>}
                                {doc.docType}
                            </Badge>
                            {isShopifyDoc(doc) && (
                                <Badge className="bg-green-600/80 text-green-50 border-transparent flex items-center gap-1 w-fit">
                                    <ShoppingBag className="h-3 w-3"/> Shopify
                                </Badge>
                            )}
                        </div>
                    </div>
                    <Badge className={cn("border-transparent capitalize", getStatusBadgeVariant(status))}>{status}</Badge>
                </div>
                 <div className="text-sm text-foreground space-y-2 pt-2 border-t mt-2">
                    <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground"/> 
                        <span>{doc.customerName || 'Walk-in Customer'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground"/> 
                        <span>{format(parseISO(doc.createdAt), 'MMM dd, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-muted-foreground"/> 
                        <span>Total: <span className="font-bold text-primary">PKR {doc.grandTotal.toLocaleString()}</span></span>
                    </div>
                </div>
            </CardContent>
             <CardFooter className="p-2 border-t bg-muted/30">
                <Button variant="ghost" className="w-full justify-center">
                    <Eye className="w-4 h-4 mr-2" /> View Details
                </Button>
            </CardFooter>
        </Card>
    );
};


const DocumentRow: React.FC<{ doc: DocumentType }> = ({ doc }) => {
    const router = useRouter();
    const status = getDocStatus(doc);

    const handleRowClick = () => {
        if (doc.docType === 'order') {
            router.push(`/orders/${doc.id}`);
        } else {
            router.push(`/cart?invoice_id=${doc.id}`);
        }
    };

    return (
        <TableRow onClick={handleRowClick} className="cursor-pointer">
            <TableCell>
                 <div className="font-medium text-primary hover:underline">{doc.id}</div>
            </TableCell>
            <TableCell>{doc.customerName || 'Walk-in'}</TableCell>
            <TableCell>{format(parseISO(doc.createdAt), 'dd MMM, yyyy')}</TableCell>
            <TableCell>
                <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant={doc.docType === 'order' ? 'secondary' : 'default'} className="capitalize flex items-center gap-1">
                        {doc.docType === 'order' ? <ClipboardList className="h-3 w-3"/> : <FileText className="h-3 w-3"/>}
                        {doc.docType}
                    </Badge>
                    {isShopifyDoc(doc) && (
                        <Badge className="bg-green-600/80 text-green-50 border-transparent flex items-center gap-1">
                            <ShoppingBag className="h-3 w-3"/> Shopify
                        </Badge>
                    )}
                </div>
            </TableCell>
            <TableCell className="text-right">PKR {doc.grandTotal.toLocaleString()}</TableCell>
             <TableCell>
                <Badge className={cn("border-transparent capitalize", getStatusBadgeVariant(status))}>
                     {status}
                </Badge>
            </TableCell>
        </TableRow>
    );
};


// --- CSV Parsing ---
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
    return row;
  });
}

async function importShopifyCSV(
  csvContent: string,
  onProgress: (msg: string) => void,
): Promise<number> {
  const rows = parseCSV(csvContent);
  onProgress(`Parsed ${rows.length} rows…`);

  // Group rows by Shopify order Name (multi-item orders have one row per line item)
  // Only accept valid Shopify order names like #1001 — skip corrupt/metadata rows
  const VALID_ORDER_NAME = /^#\d+$/;
  const orderMap = new Map<string, { header: Record<string, string>; items: Record<string, string>[] }>();
  for (const row of rows) {
    const name = row['Name'];
    if (!name || !VALID_ORDER_NAME.test(name)) continue;
    if (!orderMap.has(name)) orderMap.set(name, { header: row, items: [] });
    orderMap.get(name)!.items.push(row);
  }
  onProgress(`${rows.length} rows → ${orderMap.size} unique orders…`);

  // Get current lastInvoiceNumber
  const settingsSnap = await getDoc(doc(db, 'app_settings', 'global'));
  let lastInvoiceNumber: number = (settingsSnap.data()?.lastInvoiceNumber as number) || 7;
  onProgress(`Starting from INV-${String(lastInvoiceNumber + 1).padStart(6, '0')}…`);

  // Sort orders chronologically
  const sortedOrders = [...orderMap.values()].sort((a, b) =>
    new Date(a.header['Created at']).getTime() - new Date(b.header['Created at']).getTime()
  );

  let batch = writeBatch(db);
  let batchCount = 0;
  let imported = 0;

  for (const order of sortedOrders) {
    const h = order.header;
    const createdAt = h['Created at'] ? new Date(h['Created at']).toISOString() : new Date().toISOString();
    const billingName = h['Billing Name'] || h['Shipping Name'] || 'Walk-in Customer';
    const total = parseFloat(h['Total']) || 0;
    const subtotal = parseFloat(h['Subtotal']) || total;
    const discount = parseFloat(h['Discount Amount']) || 0;
    const financialStatus = h['Financial Status'] || 'paid';
    const amountPaid = financialStatus === 'paid' ? total : 0;
    const balanceDue = total - amountPaid;

    const items = order.items.map(row => {
      const price = parseFloat(row['Lineitem price']) || 0;
      const qty = parseInt(row['Lineitem quantity']) || 1;
      const sku = row['Lineitem sku'] || `SHOP-${h['Name'].replace('#', '')}-${(row['Lineitem name'] || '').slice(0, 8)}`;
      return {
        sku,
        name: row['Lineitem name'] || 'Item',
        categoryId: '',
        metalType: 'gold',
        karat: '21k',
        metalWeightG: 0,
        stoneWeightG: 0,
        quantity: qty,
        unitPrice: price,
        itemTotal: price * qty,
        metalCost: 0,
        wastageCost: 0,
        wastagePercentage: 0,
        makingCharges: price * qty,
        diamondChargesIfAny: 0,
        stoneChargesIfAny: 0,
        miscChargesIfAny: 0,
      };
    });

    lastInvoiceNumber++;
    const invoiceId = `INV-${String(lastInvoiceNumber).padStart(6, '0')}`;

    const invoice = {
      id: invoiceId,
      shopifyOrderName: h['Name'],
      customerId: '',
      customerName: billingName,
      customerContact: h['Billing Phone'] || h['Phone'] || '',
      items,
      subtotal,
      discountAmount: discount,
      grandTotal: total,
      amountPaid,
      balanceDue,
      createdAt,
      ratesApplied: {},
      paymentHistory: amountPaid > 0 ? [{ amount: amountPaid, date: createdAt, notes: 'Shopify payment' }] : [],
      source: 'shopify_import',
    };

    batch.set(doc(db, 'invoices', invoiceId), invoice);
    batchCount++;
    imported++;

    if (batchCount >= 400) {
      await batch.commit();
      onProgress(`Committed batch (${imported} so far)…`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  await updateDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber });
  return imported;
}

export default function DocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: number; firstNames: string[] } | null>(null);
  const [importProgress, setImportProgress] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const appReady = useAppReady();
  const { orders, generatedInvoices, isOrdersLoading, isInvoicesLoading, loadOrders, loadGeneratedInvoices } = useAppStore(state => ({
    orders: state.orders,
    generatedInvoices: state.generatedInvoices,
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportDone(false);
    setImportProgress([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const rows = parseCSV(content);
      const firstNames = rows.slice(0, 5).map(r => r['Billing Name'] || r['Shipping Name'] || 'Walk-in');
      setImportPreview({ rows: rows.length, firstNames });
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    setImportProgress([]);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target?.result as string;
      try {
        const count = await importShopifyCSV(content, (msg) => {
          setImportProgress(prev => [...prev, msg]);
        });
        setImportDone(true);
        toast({ title: `Imported ${count} invoices`, description: 'Shopify CSV import complete.' });
        loadGeneratedInvoices();
      } catch (e: any) {
        toast({ title: 'Import Failed', description: e.message || 'Something went wrong.', variant: 'destructive' });
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(importFile);
  };

  const isLoading = isOrdersLoading || isInvoicesLoading;

  const combinedDocuments: DocumentType[] = useMemo(() => {
    if (!appReady) return [];
    const orderDocs: DocumentType[] = (orders || []).map(o => ({ ...o, docType: 'order' }));
    const invoiceDocs: DocumentType[] = (generatedInvoices || []).map(i => ({ ...i, docType: 'invoice' }));
    return [...orderDocs, ...invoiceDocs].sort((a,b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
  }, [appReady, orders, generatedInvoices]);


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

  const renderContent = (docs: DocumentType[]) => {
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
        <>
            {/* Mobile View: Cards */}
            <div className="md:hidden">
                {docs.map((doc) => <DocumentCard key={`${doc.docType}-${doc.id}`} doc={doc} />)}
            </div>

            {/* Desktop View: Table */}
            <Card className="hidden md:block">
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
        </>
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
        <Button variant="outline" onClick={() => { setImportOpen(true); setImportFile(null); setImportPreview(null); setImportProgress([]); setImportDone(false); }}>
          <Upload className="w-4 h-4 mr-2" /> Import Shopify CSV
        </Button>
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
      
      {/* Shopify CSV Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!isImporting) setImportOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Shopify Orders CSV</DialogTitle>
            <DialogDescription>
              Upload a Shopify orders export CSV. Each row becomes an invoice. Invoices are numbered sequentially from the last invoice number.
            </DialogDescription>
          </DialogHeader>

          {!importDone ? (
            <div className="space-y-4 py-2">
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {importFile ? importFile.name : 'Click to select CSV file'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {importPreview && (
                <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                  <p className="font-medium">{importPreview.rows} rows detected</p>
                  <p className="text-muted-foreground">First entries: {importPreview.firstNames.join(', ')}{importPreview.rows > 5 ? '…' : ''}</p>
                </div>
              )}

              {importProgress.length > 0 && (
                <div className="bg-muted rounded-md p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                  {importProgress.map((msg, i) => <p key={i}>{msg}</p>)}
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-lg">Import Complete</p>
              <p className="text-muted-foreground text-sm">All invoices have been saved to Firestore.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={isImporting}>Cancel</Button>
            {!importDone && (
              <Button onClick={handleImport} disabled={!importFile || isImporting}>
                {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isImporting ? 'Importing…' : 'Import'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="all">
        <TabsList className="grid w-full grid-cols-4 md:w-fit md:grid-cols-4 mb-4">
          <TabsTrigger value="all">All ({filteredDocuments.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({filteredDocuments.filter(d => d.docType === 'invoice' && !isShopifyDoc(d)).length})</TabsTrigger>
          <TabsTrigger value="orders">Orders ({filteredDocuments.filter(d => d.docType === 'order').length})</TabsTrigger>
          <TabsTrigger value="shopify" className="flex items-center gap-1">
            <ShoppingBag className="h-3 w-3" /> Shopify ({filteredDocuments.filter(d => isShopifyDoc(d)).length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          {renderContent(filteredDocuments)}
        </TabsContent>
        <TabsContent value="invoices">
          {renderContent(filteredDocuments.filter(d => d.docType === 'invoice' && !isShopifyDoc(d)))}
        </TabsContent>
        <TabsContent value="orders">
          {renderContent(filteredDocuments.filter(d => d.docType === 'order'))}
        </TabsContent>
        <TabsContent value="shopify">
          {renderContent(filteredDocuments.filter(d => isShopifyDoc(d)))}
        </TabsContent>
      </Tabs>
      
    </div>
  );
}
