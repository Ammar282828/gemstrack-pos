
"use client";

import { isOwing, owedToYou } from '@/lib/owed';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { ListSkeleton } from '@/components/shared/skeletons';
import Link from 'next/link';
import { useAppStore, Order, Invoice, Customer, ORDER_STATUSES, OrderStatus } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, FileText, Calendar, Upload, CheckCircle2, ShoppingBag, Link2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { cn, settledRowClass, shopifyRowClass, mineRowClass } from '@/lib/utils';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, writeBatch, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { mergeInstructions } from '@/lib/workshop';
import { describePlating } from '@/lib/materials';
import { STORE_CONFIG, storeLinksUrl, STORE_LOGO_URL } from '@/lib/store-config';
import { saveInvoicePdf } from '@/lib/invoice-pdf';
import { PrintButton } from '@/components/shared/print-button';
import { generateOrderSlipPDF } from '@/lib/order-slip-pdf';
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import type { TakenBy } from '@/lib/store';
import QRCode from 'qrcode.react';
import { GRADUATIONS, bucketOf, type Graduation } from '@/lib/date-grouping';
import { fitText } from '@/lib/pdf-text';
import { label } from '@/lib/pdf-chrome';
import { useMe, useMineFilter } from '@/hooks/use-me';
import { RecordPaymentDialog } from '@/components/invoice/record-payment-dialog';
import { PageShell } from '@/components/shared/page-shell';
import { Monogram, Pill, MineTag, ChipRow, FilterChip, Segmented, SearchField, EmptyState, LedgerSection, toneClasses, type Tone } from '@/components/ledger';

type DocumentType = (Order | Invoice) & { docType: 'order' | 'invoice' };

/** How many pieces an invoice carries; an order's slip is never split. */
const pieceCount = (d: DocumentType): number => {
  if (d.docType !== 'invoice') return 1;
  const items = (d as Invoice).items;
  return Array.isArray(items) ? items.length : Object.keys(items || {}).length;
};



/** An order's stage and an invoice's payment, each in its one tone (a.2): owed is amber, never red. */
const STATUS_TONE: Record<string, Tone> = {
  Pending: 'owed', 'In Progress': 'working', Completed: 'settled', Cancelled: 'quiet', Refunded: 'quiet', Paid: 'settled', Unpaid: 'owed',
};
const statusTone = (status: string): Tone => STATUS_TONE[status] ?? 'quiet';

/** What the sale was of, in a line: the pieces' names. */
const soldLine = (d: DocumentType): string => {
  const items = (d as { items?: unknown }).items;
  const list = Array.isArray(items) ? items : Object.values(items || {});
  return (list as { name?: string }[]).map(i => i?.name).filter(Boolean).join(', ');
};

const getDocStatus = (doc: DocumentType): Order['status'] | 'Paid' | 'Unpaid' => {
  if (doc.docType === 'order') {
    return (doc as Order).status;
  }
  const inv = doc as Invoice;
  if (inv.status === 'Refunded') return 'Refunded';
  return inv.balanceDue <= 0 ? 'Paid' : 'Unpaid';
};

const isShopifyDoc = (doc: DocumentType): boolean =>
  doc.docType === 'invoice' && !!((doc as Invoice).source?.startsWith('shopify'));

type RowProps = { doc: DocumentType; onPrint: () => void; onPrintPerPiece?: () => void; onMarkPaid?: () => void; onStatusChange?: (status: OrderStatus) => void; onSendPaymentLink?: () => void; isSendingLink?: boolean; mine?: boolean };

/** The status an order can change, as a pill with a chevron. */
const OrderStatusSelect: React.FC<{ doc: Order; onStatusChange: (s: OrderStatus) => void }> = ({ doc, onStatusChange }) => {
  const t = toneClasses(statusTone(doc.status));
  return (
    <Select value={doc.status} onValueChange={(val) => onStatusChange(val as OrderStatus)}>
      <SelectTrigger
        onClick={(e) => e.stopPropagation()}
        aria-label={`Status: ${doc.status}`}
        className={cn(
          'h-7 w-fit gap-1 rounded-full border-transparent px-2.5 text-ios-cap font-semibold [@media(pointer:coarse)]:!min-h-7',
          'focus:ring-0 focus:ring-offset-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-80',
          t.ink, t.tint,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ORDER_STATUSES.map(s => (
          <SelectItem key={s} value={s}>{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** The balance in a word: what is due, in credit, or paid. An order shows its stage. */
const BalancePill: React.FC<{ doc: DocumentType }> = ({ doc }) => {
  const status = getDocStatus(doc);
  if (doc.docType === 'order') return <Pill tone={statusTone(status)}>{status}</Pill>;
  const inv = doc as Invoice;
  if (inv.status === 'Refunded') return <Pill tone="quiet">Refunded</Pill>;
  if ((inv.balanceDue || 0) > 0) return <Pill tone="owed">PKR {Math.round(inv.balanceDue).toLocaleString()} due</Pill>;
  if ((inv.balanceDue || 0) < -0.5) return <Pill tone="credit">PKR {Math.round(-inv.balanceDue).toLocaleString()} in credit</Pill>;
  return <Pill tone="settled">Paid</Pill>;
};

/** One row of the phone list (the app's invoice row): who, what, the balance, the total; actions beneath. */
const DocumentCard: React.FC<RowProps> = ({ doc, onPrint, onPrintPerPiece, onMarkPaid, onStatusChange, onSendPaymentLink, isSendingLink, mine }) => {
    const router = useRouter();
    const status = getDocStatus(doc);
    const href = doc.docType === 'order' ? `/orders/${doc.id}` : `/invoices/${doc.id}`;
    const sold = soldLine(doc);
    const open = () => router.push(href);

    return (
        <div
          role="link" tabIndex={0} aria-label={`${doc.id}, ${doc.customerName || 'Walk-in Customer'}`}
          onClick={open}
          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
          className={cn('cursor-pointer py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40', status === 'Completed' && settledRowClass)}
        >
            <div className="flex items-start gap-3">
                <Monogram name={doc.customerName} size={38} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <p className="min-w-0 truncate text-ios-headline font-semibold">{doc.customerName || 'Walk-in Customer'}</p>
                        {mine && <MineTag />}
                    </div>
                    <p className="truncate text-ios-cap text-muted-foreground">
                        {doc.id} · {format(parseISO(doc.createdAt), 'h:mm a')}
                        {doc.docType === 'order' && ' · Order'}
                        {isShopifyDoc(doc) && ' · Shopify'}
                    </p>
                    {sold && <p className="truncate text-ios-sub text-muted-foreground">{sold}</p>}
                </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 pl-[50px]">
                {doc.docType === 'order' && onStatusChange
                    ? <OrderStatusSelect doc={doc as Order} onStatusChange={onStatusChange} />
                    : <BalancePill doc={doc} />}
                <span className="whitespace-nowrap font-serif text-ios-title3 font-semibold tabular-nums">PKR {doc.grandTotal.toLocaleString()}</span>
            </div>
            <div className="-mb-1 mt-1 flex flex-wrap items-center gap-x-1 pl-[42px]">
                <PrintButton pieces={pieceCount(doc)} onPrint={onPrint} onPrintPerPiece={onPrintPerPiece} />
                {status === 'Unpaid' && onMarkPaid && (
                    <Button variant="ghost" size="sm" className="text-tone-settled-ink hover:text-tone-settled-ink" onClick={(e) => { e.stopPropagation(); onMarkPaid(); }}>
                        <CheckCircle2 className="mr-1.5 h-4 w-4" /> Record payment
                    </Button>
                )}
                {doc.docType === 'invoice' && status === 'Unpaid' && onSendPaymentLink && (
                    <Button variant="ghost" size="sm" className="text-tone-working-ink hover:text-tone-working-ink" disabled={isSendingLink} onClick={(e) => { e.stopPropagation(); onSendPaymentLink(); }}>
                        {isSendingLink ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
                        {(doc as Invoice).shopifyCheckoutUrl ? 'Copy link' : 'Payment link'}
                    </Button>
                )}
            </div>
        </div>
    );
};

const DocumentRow: React.FC<RowProps> = ({ doc, onPrint, onPrintPerPiece, onMarkPaid, onStatusChange, onSendPaymentLink, isSendingLink, mine }) => {
    const router = useRouter();
    const status = getDocStatus(doc);

    const handleRowClick = () => {
        if (doc.docType === 'order') {
            router.push(`/orders/${doc.id}`);
        } else {
            router.push(`/invoices/${doc.id}`);
        }
    };

    return (
        <TableRow onClick={handleRowClick} className={cn('cursor-pointer',
          status === 'Completed' && settledRowClass, isShopifyDoc(doc) && shopifyRowClass, mine && mineRowClass)} title={mine ? 'Taken by you' : undefined}>
            <TableCell>
                 <div className="whitespace-nowrap font-medium text-foreground hover:underline">{doc.id}</div>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-2.5">
                    <Monogram name={doc.customerName} size={28} />
                    <span className="truncate">{doc.customerName || 'Walk-in'}</span>
                    {mine && <MineTag />}
                </div>
            </TableCell>
            <TableCell className="hidden whitespace-nowrap 2xl:table-cell">{format(parseISO(doc.createdAt), 'dd MMM, yyyy')}</TableCell>
            <TableCell className="hidden 2xl:table-cell">
                <div className="flex flex-wrap items-center gap-1">
                    <Pill tone={doc.docType === 'order' ? 'working' : 'quiet'} className="capitalize">{doc.docType}</Pill>
                    {isShopifyDoc(doc) && <Pill tone="settled" icon={<ShoppingBag />}>Shopify</Pill>}
                </div>
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">PKR {doc.grandTotal.toLocaleString()}</TableCell>
             {/* One shape for the whole column. An order rendered as a
                 bordered select box while an invoice rendered as a coloured
                 pill, so the same column carried two different objects. Both
                 are pills now; the order's is simply the one you can change,
                 and the chevron is what says so. */}
             <TableCell>
                {doc.docType === 'order' && onStatusChange
                    ? <OrderStatusSelect doc={doc as Order} onStatusChange={onStatusChange} />
                    : <BalancePill doc={doc} />}
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-1">
                    <PrintButton pieces={pieceCount(doc)} onPrint={onPrint} onPrintPerPiece={onPrintPerPiece} />
                    {status === 'Unpaid' && onMarkPaid && (
                        <Button variant="ghost" size="sm" className="text-tone-settled-ink hover:text-tone-settled-ink" onClick={(e) => { e.stopPropagation(); onMarkPaid(); }}>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Paid
                        </Button>
                    )}
                    {doc.docType === 'invoice' && status === 'Unpaid' && onSendPaymentLink && (
                        <Button variant="ghost" size="sm" className="text-tone-working-ink hover:text-tone-working-ink" disabled={isSendingLink} onClick={(e) => { e.stopPropagation(); onSendPaymentLink(); }}>
                            {isSendingLink ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2 className="w-4 h-4 mr-1" />}
                            {(doc as Invoice).shopifyCheckoutUrl ? 'Link' : 'Pay Link'}
                        </Button>
                    )}
                </div>
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
    const itemSubtotal = items.reduce((sum, item) => sum + (item.itemTotal || 0), 0);
    const adjustmentsAmount = total - (itemSubtotal - discount);

    lastInvoiceNumber++;
    const invoiceId = `INV-${String(lastInvoiceNumber).padStart(6, '0')}`;

    const invoice = {
      id: invoiceId,
      shopifyOrderName: h['Name'],
      customerId: '',
      customerName: billingName,
      customerContact: h['Billing Phone'] || h['Phone'] || '',
      items,
      subtotal: itemSubtotal,
      discountAmount: discount,
      ...(adjustmentsAmount !== 0 && { adjustmentsAmount }),
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

function monthKeyOf(iso: string | undefined): string {
  return (iso || '').slice(0, 7); // "YYYY-MM"
}
function monthLabel(key: string): string {
  if (!key) return '—';
  const d = new Date(key + '-01T00:00:00');
  return isNaN(d.getTime()) ? key : d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

export default function DocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [monthFilter, setMonthFilter] = useState<string>('All');
  // Starts on whoever is signed in (lib/people.ts); Anyone is one tap away.
  // Everyone's sales to start with; the signed-in person's own are highlighted, not filtered (2026-10-05).
  const [takenByFilter, setTakenByFilter] = useMineFilter('invoices', { startOnMe: false });
  const me = useMe();
  /**
   * How the list is broken up. Day by default — the usual question is what
   * happened recently — with the same graduations Expenses offers, plus a
   * status view for chasing what is still owed.
   */
  const [groupBy, setGroupBy] = useState<'status' | Graduation>('day');
  const [activeTab, setActiveTab] = useState<'all' | 'invoices' | 'orders' | 'shopify'>('all');
  // Phone: the finer filters fold behind one chip; from lg they sit in the row.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: number; firstNames: string[] } | null>(null);
  const [importProgress, setImportProgress] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const appReady = useAppReady();
  const { orders, generatedInvoices, isOrdersLoading, isInvoicesLoading, loadOrders, loadGeneratedInvoices, settings, customers, updateInvoicePayment, updateOrderStatus } = useAppStore(state => ({
    orders: state.orders,
    generatedInvoices: state.generatedInvoices,
    isOrdersLoading: state.isOrdersLoading,
    isInvoicesLoading: state.isInvoicesLoading,
    loadOrders: state.loadOrders,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
    settings: state.settings,
    customers: state.customers,
    updateInvoicePayment: state.updateInvoicePayment,
    updateOrderStatus: state.updateOrderStatus,
  }));

  /** `perPiece` prints a multi-piece invoice as one invoice per piece — see lib/invoice-pdf. */
  const handlePrint = async (document: DocumentType, perPiece = false) => {
    // Neither call was awaited or caught, so anything that went wrong while
    // drawing became an unhandled rejection: the operator pressed Print, no
    // file appeared, and nothing said why.
    try {
      if (document.docType === 'invoice') {
        const inv = document as Invoice;
        const customer = inv.customerId ? customers.find(c => c.id === inv.customerId) : null;
        await saveInvoicePdf(inv, { customer, perPiece });
      } else {
        await generateOrderSlipPDF(document as Order, settings);
      }
    } catch (e) {
      console.error('[GemsTrack] PDF generation failed', e);
      toast({
        title: 'Could not create the PDF',
        description: e instanceof Error ? e.message : 'Something went wrong while drawing the document.',
        variant: 'destructive',
      });
    }
  };

  // "Mark Paid" opens the payment dialog, balance filled in, method to choose. It used to record the
  // whole balance at once with no method and no confirmation (audit, 2026-10-01).
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const handleMarkPaid = (document: DocumentType) => {
    if (document.docType !== 'invoice') return;
    const inv = document as Invoice;
    if (inv.balanceDue > 0) setPayingInvoice(inv);
  };

  const handleOrderStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      toast({ title: 'Status Updated', description: `Order ${orderId} changed to "${newStatus}".` });
    } catch {
      toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' });
    }
  };

  const [sendingLinkId, setSendingLinkId] = useState<string | null>(null);

  const handleSendPaymentLink = async (invoice: Invoice) => {
    // Always re-POST so the draft order reflects the current invoice state
    // (line items, totals, tax-exempt flag). The endpoint PUT-updates if the
    // invoice already has a shopifyDraftOrderId, otherwise it creates one.
    setSendingLinkId(invoice.id);
    try {
      const res = await authedFetch('/api/shopify/push/draft-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create payment link');
      await navigator.clipboard.writeText(data.checkoutUrl);
      toast({
        title: invoice.shopifyCheckoutUrl ? 'Link Refreshed & Copied' : 'Payment Link Created',
        description: 'Checkout link copied to clipboard. Share it with the customer via WhatsApp or SMS.',
      });
      loadGeneratedInvoices();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSendingLinkId(null);
    }
  };

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
        toast({ title: 'Import Failed', description: e.message || 'An unexpected error occurred.', variant: 'destructive' });
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

  // Months present in the data — most recent first
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of combinedDocuments) {
      const k = monthKeyOf(d.createdAt);
      if (k) set.add(k);
    }
    return Array.from(set).sort().reverse();
  }, [combinedDocuments]);

  const filteredDocuments = useMemo(() => {
    let docs = combinedDocuments;

    if (takenByFilter) {
      // Orders appear in this list too; both carry takenBy, so one filter covers both.
      docs = docs.filter(doc => (doc as { takenBy?: string }).takenBy === takenByFilter);
    }
    if (monthFilter !== 'All') {
      docs = docs.filter(doc => monthKeyOf(doc.createdAt) === monthFilter);
    }

    if (dateRange?.from) {
      docs = docs.filter(doc => {
        const docDate = parseISO(doc.createdAt);
        const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
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
  }, [combinedDocuments, dateRange, searchTerm, monthFilter, takenByFilter]);

  /** One section of the list, with what it is worth and what is still owed. */
  const buildSections = React.useCallback((docs: DocumentType[]) => {
    // Owing by the ERP's one rule (lib/owed.ts): an invoice not refunded with a balance above zero.
    const owedOf = (d: DocumentType) =>
      d.docType === 'invoice' && isOwing(d as Invoice) ? (d as Invoice).balanceDue || 0 : 0;
    const valueOf = (d: DocumentType) =>
      d.docType === 'invoice' ? ((d as Invoice).grandTotal || 0) : ((d as Order).grandTotal || 0);

    const out: { key: string; title: string; hint: string; danger?: boolean; rows: DocumentType[] }[] = [];
    const push = (key: string, title: string, hint: string, rows: DocumentType[], danger?: boolean) => {
      if (rows.length) out.push({ key, title, hint, rows, danger });
    };

    if (groupBy === 'status') {
      const owing = docs.filter(d => owedOf(d) > 0)
        // Oldest debt first: that is the one to chase.
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      const orders = docs.filter(d => d.docType === 'order' && owedOf(d) === 0);
      const settled = docs.filter(d => d.docType === 'invoice' && owedOf(d) === 0)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      push('owing', 'Awaiting payment', 'oldest first', owing, true);
      push('orders', 'Orders not yet invoiced', 'still in the workshop', orders);
      push('settled', 'Settled', 'nothing outstanding', settled);
    } else {
      const index = new Map<string, number>();
      for (const d of docs) {
        if (!d.createdAt) continue;
        const b = bucketOf(parseISO(d.createdAt), groupBy);
        let i = index.get(b.key);
        if (i === undefined) {
          i = out.length; index.set(b.key, i);
          out.push({ key: b.key, title: b.label, hint: b.sub, rows: [] });
        }
        out[i].rows.push(d);
      }
    }

    return out.map(s => ({
      ...s,
      billed: s.rows.reduce((n, d) => n + valueOf(d), 0),
      owed: s.rows.reduce((n, d) => n + owedOf(d), 0),
    }));
  }, [groupBy]);

  /** Split once. The tab counts ran three filters over every document on
   *  every render, and the tab bodies then filtered the same list again. */
  const byTab = useMemo(() => {
    const invoicesOnly: DocumentType[] = [], ordersOnly: DocumentType[] = [], shopifyOnly: DocumentType[] = [];
    for (const d of filteredDocuments) {
      if (d.docType === 'order') ordersOnly.push(d);
      else if (isShopifyDoc(d)) shopifyOnly.push(d);
      else invoicesOnly.push(d);
    }
    return { all: filteredDocuments, invoices: invoicesOnly, orders: ordersOnly, shopify: shopifyOnly };
  }, [filteredDocuments]);

  const renderContent = (docs: DocumentType[]) => {
      if (isLoading) return <ListSkeleton rows={6} />;
      if (docs.length === 0) {
          return (
            <EmptyState
              icon={<FileText />}
              title="Nothing found"
              description={searchTerm || dateRange ? "Try adjusting your search or filter." : "No orders or invoices have been created yet."}
              className="rounded-card bg-card"
            />
          );
      }
      const sections = buildSections(docs);

      const rowProps = (d: DocumentType) => ({
        doc: d,
        onPrint: () => handlePrint(d),
        onPrintPerPiece: d.docType === 'invoice' ? () => handlePrint(d, true) : undefined,
        onMarkPaid: d.docType === 'invoice' && (d as Invoice).balanceDue > 0 ? () => handleMarkPaid(d) : undefined,
        onStatusChange: d.docType === 'order' ? (s: OrderStatus) => handleOrderStatusChange(d.id, s) : undefined,
        onSendPaymentLink: d.docType === 'invoice' ? () => handleSendPaymentLink(d as Invoice) : undefined,
        isSendingLink: sendingLinkId === d.id,
        mine: !!me && (d as { takenBy?: string }).takenBy === me,
      });

      // The table's group row: wraps rather than squeezes (the figures took the row and the title was drawn under them).
      const heading = (s: typeof sections[number]) => (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className={cn('text-sm font-semibold truncate min-w-0', s.danger && 'text-tone-owed-ink')}>{s.title}</span>
            {s.hint && <span className="text-2xs text-muted-foreground flex-shrink-0">{s.hint}</span>}
          </div>
          <div className="ml-auto flex items-baseline gap-2 flex-shrink-0">
            <span className="text-2xs text-muted-foreground">{s.rows.length}</span>
            {s.owed > 0 && (
              <span className="text-sm font-semibold tabular-nums text-tone-owed-ink">{pkr(s.owed)} owed</span>
            )}
            <span className="text-sm font-semibold tabular-nums">{pkr(s.billed)}</span>
          </div>
        </div>
      );

      return (
        <>
          {/* One table, not one per group: 176 separate <Table> elements for 461 documents was 176 scroll
              containers. Below lg the app's rows: a card per group, a divided row per document. */}
          <div className="lg:hidden space-y-5 cv-list">
            {sections.map(s => (
              // Skipped while off screen (globals.css .cv-list); a row is ~132px tall on a phone.
              <div key={s.key} style={{ '--cv-size': `${40 + s.rows.length * 132}px` } as React.CSSProperties}>
                <LedgerSection
                  title={s.title}
                  count={groupBy === 'status' && s.owed > 0 ? `${s.rows.length} · ${pkr(s.owed)} owed` : s.rows.length}
                  trailing={pkr(s.billed)}
                >
                  {s.rows.map(d => <DocumentCard key={`${d.docType}-${d.id}`} {...rowProps(d)} />)}
                </LedgerSection>
              </div>
            ))}
          </div>

          <Card className="hidden lg:block">
            <CardContent className="p-0 scroll-shadow-x overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Date</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Type</TableHead>
                    <TableHead className="text-right">Total (PKR)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map(s => (
                    <React.Fragment key={s.key}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={7} className="py-1.5">{heading(s)}</TableCell>
                      </TableRow>
                      {s.rows.map(d => <DocumentRow key={`${d.docType}-${d.id}`} {...rowProps(d)} />)}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      );
  };
  
  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  const pkr = (n: number) => 'PKR ' + Math.round(n).toLocaleString();
  // The whole book's figure, whatever the filters show (the dashboard's "Owed to you").
  const owedAll = owedToYou(generatedInvoices);

  return (
    <PageShell
      // On a phone only what is owed; the sentence around it is for the desk.
      subtitle={<><span className="hidden sm:inline">Every invoice and order, and what is still owed on it{owedAll.total > 0 && ' — '}</span>{owedAll.total > 0 && <><span className="font-medium text-tone-owed-ink">{pkr(owedAll.total)} owed</span> on {owedAll.invoices.length} invoice{owedAll.invoices.length === 1 ? '' : 's'}</>}<span className="hidden sm:inline">.</span></>}
      // A Shopify CSV is imported at a desk, never from a phone: the full-width button was the first
      // thing under the title there.
      action={
        <Button variant="outline" size="sm" className="hidden flex-shrink-0 sm:inline-flex"
          onClick={() => { setImportOpen(true); setImportFile(null); setImportPreview(null); setImportProgress([]); setImportDone(false); }}>
          <Upload className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Import Shopify CSV</span><span className="sm:hidden">Import</span>
        </Button>
      }
    >


      {/* The app's controls: a capsule search, the kind of document as chips, the finer filters behind one chip
          on a phone and in the row from lg. The date-range popover opens inside them. */}
      {(() => {
        const activeFilters = (monthFilter !== 'All' ? 1 : 0) + (dateRange?.from ? 1 : 0) + (takenByFilter ? 1 : 0);
        return (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <SearchField className="lg:max-w-md lg:flex-1" value={searchTerm} onChange={setSearchTerm} placeholder="Search invoices and orders" />
              <ChipRow label="Show" className="lg:mx-0 lg:px-0">
                {([
                  { value: 'all', label: 'All', n: byTab.all.length },
                  { value: 'invoices', label: 'Invoices', n: byTab.invoices.length },
                  { value: 'orders', label: 'Orders', n: byTab.orders.length },
                  { value: 'shopify', label: 'Shopify', n: byTab.shopify.length },
                ] as const).map(tab => (
                  <FilterChip key={tab.value} title={tab.label} count={tab.n} chosen={activeTab === tab.value} onClick={() => setActiveTab(tab.value)} />
                ))}
                <FilterChip
                  className="lg:hidden"
                  title={filtersOpen ? 'Hide filters' : 'Filters'}
                  count={activeFilters || undefined}
                  chosen={filtersOpen || activeFilters > 0}
                  onClick={() => setFiltersOpen(o => !o)}
                />
              </ChipRow>
            </div>
            <div
              className={cn('flex-col gap-2 lg:flex lg:flex-row lg:flex-wrap lg:items-center', filtersOpen ? 'flex rounded-card bg-card p-3' : 'hidden', 'lg:rounded-none lg:bg-transparent lg:p-0')}
              aria-label="Filters"
            >
              <Segmented
                label="Group by"
                value={groupBy}
                onChange={(v) => setGroupBy(v as 'status' | Graduation)}
                options={[{ value: 'status', label: 'Status' }, ...GRADUATIONS.map(g => ({ value: g.id as string, label: g.label }))]}
                className="w-full lg:w-auto"
              />
              <TakenByPicker value={takenByFilter} onChange={setTakenByFilter} allowAny anyLabel="Anyone"
                aria-label="Taken by" className="w-full lg:w-[150px]" />
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger className="w-full lg:w-[180px]">
                  <Calendar className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0" />
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All time</SelectItem>
                  {monthOptions.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
              <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full lg:w-auto" />
            </div>
          </div>
        );
      })()}
      
      {/* Shopify CSV Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!isImporting) setImportOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Shopify orders (CSV)</DialogTitle>
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
              <CheckCircle2 className="w-12 h-12 text-success" />
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

      {/* Hidden QR code elements needed for PDF generation */}
      <div style={{ display: 'none' }}>
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
          <QRCode id="links-qr-code" value={storeLinksUrl()} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
      </div>

      {renderContent(byTab[activeTab])}

      <RecordPaymentDialog invoice={payingInvoice} open={!!payingInvoice} onOpenChange={o => { if (!o) setPayingInvoice(null); }} />
    </PageShell>
  );
}
