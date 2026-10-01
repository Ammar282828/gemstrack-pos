"use client";

/**
 * An invoice, for the shop: `/invoices/<id>`. Its pieces and figures, print, send to the customer,
 * record a payment, change the discount, refund — and Edit, which opens the sale form on its own
 * address (`/invoices/<id>/edit`).
 *
 * It used to be a mode of the cart (`/cart?invoice_id=`), which meant opening an invoice cleared the
 * sale in progress, and its Refund button opened a dialog that only the cart's other mode drew — so
 * it did nothing. This screen never touches the cart (the audit of 2026-10-01).
 * The customer's own page is `/view-invoice/<id>`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppStore, Invoice as InvoiceType, PAYMENT_TYPES, PaymentType } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { describeMetal, describeSettings, describeDelivery, describePlating } from '@/lib/materials';
import { categorySingular } from '@/lib/categories';
import { STORE_CONFIG, storeLinksUrl, STORE_LOGO_URL } from '@/lib/store-config';
import { doc as fsDoc, getDoc as fsGetDoc, setDoc as fsSetDoc } from 'firebase/firestore';
import { db as fsDb } from '@/lib/firebase';
import { invoiceShareUrl, newShareToken } from '@/lib/share-token';
import { whatsAppLink } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MessageSquare, Check, Banknote, Edit, PlusCircle, CalendarIcon, List, RotateCcw, CheckCircle, Lock, XCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveInvoicePdf } from '@/lib/invoice-pdf';
import { PrintButton } from '@/components/shared/print-button';
import QRCode from 'qrcode.react';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { cn, normalizePhoneNumber } from '@/lib/utils';
import { getInvoiceAdjustmentsAmount, getInvoiceExchangeTotal } from '@/lib/financials';
import { stockSku } from '@/lib/sku';
import { format } from 'date-fns';
import { AmountInput } from '@/components/ui/amount-input';
import { invoiceExchanges, describeExchangeEntry } from '@/lib/exchange';
import { OrderCarryOver } from '@/components/invoice/order-carry-over';
import { FormSkeleton } from '@/components/shared/skeletons';
import { PhoneField } from '@/components/ui/phone-field';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import 'react-phone-number-input/style.css';

/** Keys given to older invoices this session, so sending one twice sends the same link. */
const sentKeys = new Map<string, string>();

export function InvoiceViewer({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const appReady = useAppReady();
  const { customers, settings, allInvoices, hasInvoicesLoaded, updateInvoicePayment, refundInvoicePartial, updateInvoiceDiscount, deleteInvoice, deleteInvoicePayment, loadCustomers, loadGeneratedInvoices } = useAppStore(state => ({
    customers: state.customers,
    settings: state.settings,
    allInvoices: state.generatedInvoices,
    // A list that was refused counts as read: the invoice is then read by itself (and a refusal says so).
    hasInvoicesLoaded: state.hasInvoicesLoaded || !!state.invoicesError,
    updateInvoicePayment: state.updateInvoicePayment,
    refundInvoicePartial: state.refundInvoicePartial,
    updateInvoiceDiscount: state.updateInvoiceDiscount,
    deleteInvoice: state.deleteInvoice, deleteInvoicePayment: state.deleteInvoicePayment,
    loadCustomers: state.loadCustomers,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
  }));

  useEffect(() => {
    if (appReady) { loadCustomers(); loadGeneratedInvoices(); }
  }, [appReady, loadCustomers, loadGeneratedInvoices]);

  // The live list is the source; what an action hands back shows at once, until the list catches up.
  // An invoice the list doesn't hold (older than what it loads, or a moment old) is read by itself.
  const [latest, setLatest] = useState<InvoiceType | null>(null);
  const [fetched, setFetched] = useState<InvoiceType | null | undefined>(undefined);
  const [readError, setReadError] = useState<string | null>(null);
  const fromList = useMemo(() => allInvoices.find(i => i.id === invoiceId) ?? null, [allInvoices, invoiceId]);
  useEffect(() => {
    if (!appReady || !hasInvoicesLoaded || fromList || fetched !== undefined) return;
    let gone = false;
    fsGetDoc(fsDoc(fsDb, 'invoices', invoiceId))
      .then(s => { if (!gone) setFetched(s.exists() ? ({ ...(s.data() as InvoiceType), id: s.id }) : null); })
      .catch(e => { if (!gone) { setReadError(e instanceof Error ? e.message : String(e)); setFetched(null); } });
    return () => { gone = true; };
  }, [appReady, hasInvoicesLoaded, fromList, fetched, invoiceId]);
  const invoice: InvoiceType | null = (latest?.id === invoiceId ? latest : null) ?? fromList ?? fetched ?? null;
  // Once the list has the change an action made, the list wins again.
  useEffect(() => { if (latest && fromList && fromList !== latest) setLatest(null); }, [fromList]); // eslint-disable-line react-hooks/exhaustive-deps

  const paymentLockRef = useRef(false);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isEditingDiscount, setIsEditingDiscount] = useState(false);
  const [editDiscountInput, setEditDiscountInput] = useState<string>('');
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundMode, setRefundMode] = useState<'full' | 'partial'>('full');
  const [partialRefundAmount, setPartialRefundAmount] = useState<string>('');
  const [partialRefundReason, setPartialRefundReason] = useState<string>('');
  // Cash by default — most of the counter trade is cash.
  const [paymentMethod, setPaymentMethod] = useState<PaymentType>('Cash');
  const [paymentRef, setPaymentRef] = useState('');
  // The number to send to: the invoice's own, else its customer's (it used to start empty on an opened invoice).
  const [phone, setPhone] = useState('');
  const phoneFor = invoice?.customerContact || (invoice?.customerId ? customers.find(c => c.id === invoice.customerId)?.phone : '') || '';
  useEffect(() => { if (phoneFor && !phone) setPhone(normalizePhoneNumber(phoneFor)); }, [phoneFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecordPayment = async (overrideAmount?: number) => {
    if (!invoice) return;
    const amount = overrideAmount ?? parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive payment amount.", variant: "destructive" });
      return;
    }
    if (amount > invoice.balanceDue) {
      toast({ title: "Overpayment", description: `Payment cannot exceed the balance due of PKR ${invoice.balanceDue.toLocaleString()}.`, variant: "destructive" });
      return;
    }
    // A ref, not the isSubmitting state: React batches state updates, so a fast double-click can fire
    // this twice before the disabled prop re-renders (INV-000257: two payments 1.3 seconds apart).
    if (paymentLockRef.current) return;
    paymentLockRef.current = true;
    setIsSubmittingPayment(true);
    try {
      const updated = await updateInvoicePayment(invoice.id, amount, new Date().toISOString(), paymentMethod, paymentRef);
      if (!updated) throw new Error('No invoice came back from the store.');
      setLatest(updated);
      setPaymentAmount('');
      setPaymentRef('');
      toast({ title: "Payment recorded", description: `PKR ${amount.toLocaleString()} by ${paymentMethod}.` });
    } catch {
      toast({ title: "Error", description: "Failed to record payment.", variant: "destructive" });
    } finally {
      paymentLockRef.current = false;
      setIsSubmittingPayment(false);
    }
  };

  const handleSaveDiscount = async () => {
    if (!invoice) return;
    const amount = parseFloat(editDiscountInput) || 0;
    if (amount < 0) { toast({ title: "Invalid", description: "Discount cannot be negative.", variant: "destructive" }); return; }
    if (amount > invoice.subtotal) { toast({ title: "Invalid", description: "Discount cannot exceed subtotal.", variant: "destructive" }); return; }
    setIsSavingDiscount(true);
    try {
      const updated = await updateInvoiceDiscount(invoice.id, amount);
      if (!updated) throw new Error('Failed to update discount.');
      setLatest(updated);
      setIsEditingDiscount(false);
      toast({ title: "Discount updated", description: `Discount set to PKR ${amount.toLocaleString()}.` });
    } catch {
      toast({ title: "Error", description: "Failed to update discount.", variant: "destructive" });
    } finally {
      setIsSavingDiscount(false);
    }
  };

  /**
   * Open WhatsApp to the customer, message written, the invoice linked. Synchronous, so the tap's
   * activation is still there when window.open asks for it; wa.me cannot carry a file, so the invoice
   * goes as a link to its own page (Print's sheet lists WhatsApp for the PDF).
   */
  const handleSendWhatsApp = (invoiceToSend: InvoiceType) => {
    if (!phone) {
      toast({ title: "No phone number", description: "Enter the customer's WhatsApp number.", variant: "destructive" });
      return;
    }
    let message = `Dear ${invoiceToSend.customerName || 'Customer'},\n\n`;
    message += `Here is your estimate from ${settings.shopName}.\n\n`;
    message += `*Estimate ID:* ${invoiceToSend.id}\n`;
    message += `*Total Amount:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    if (invoiceToSend.amountPaid > 0) {
      message += `*Amount Paid:* PKR ${invoiceToSend.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
      message += `*Balance Due:* PKR ${invoiceToSend.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    } else {
      message += `*Amount Due:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    }
    message += `Thank you for your business.`;

    const appUrl = typeof window !== 'undefined' ? window.location.origin : STORE_CONFIG.appUrl;
    // The link carries the invoice's key: its page is closed to anyone without it. An invoice from
    // before keys existed gets one now — chosen here, not after a round trip, because window.open
    // below must run inside the tap — and it is saved as the link goes out.
    let key = invoiceToSend.shareToken || sentKeys.get(invoiceToSend.id);
    if (!key) {
      key = newShareToken();
      sentKeys.set(invoiceToSend.id, key);
      fsSetDoc(fsDoc(fsDb, 'invoices', invoiceToSend.id), { shareToken: key }, { merge: true })
        .catch(e => toast({ title: 'The link may not open', description: `Could not save its key: ${(e as Error).message}`, variant: 'destructive' }));
    }
    message += `\n\nView estimate: ${invoiceShareUrl(appUrl, invoiceToSend.id, key)}`;
    window.open(whatsAppLink(phone, message), '_blank');
    toast({ title: "Opening WhatsApp", description: "The message is written — press send." });
  };

  const printInvoice = async (invoiceToPrint: InvoiceType, perPiece = false) => {
    try {
      const customer = invoiceToPrint.customerId ? customers.find(c => c.id === invoiceToPrint.customerId) : null;
      await saveInvoicePdf(invoiceToPrint, { customer, perPiece });
    } catch (e) {
      console.error('[GemsTrack] invoice PDF failed', e);
      toast({ title: 'Could not create the PDF', description: e instanceof Error ? e.message : 'Something went wrong while drawing it.', variant: 'destructive' });
    }
  };

  // Deleting (a mistake, a sale entered twice) asks for the delete code in the store (lib/delete-code.ts).
  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    try {
      await deleteInvoice(invoice.id, false);
      toast({ title: `Invoice ${invoice.id} deleted`, description: 'Its ledger rows went with it, and pieces only it had sold are back in stock.' });
      router.push('/invoices');
    } catch (e) {
      toast({ title: 'Not deleted', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };
  const handleDeletePayment = async (index: number, p: { amount: number; date: string }) => {
    if (!invoice) return;
    try {
      const updated = await deleteInvoicePayment(invoice.id, index, { amount: p.amount, date: p.date });
      setLatest(updated);
      toast({ title: 'Payment deleted', description: `PKR ${p.amount.toLocaleString()} taken off ${invoice.id}. Now due: PKR ${updated.balanceDue.toLocaleString()}.` });
    } catch (e) {
      toast({ title: 'Not deleted', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const handleRefundInvoice = async () => {
    if (!invoice) return;
    setIsRefunding(true);
    try {
      if (refundMode === 'full') {
        await deleteInvoice(invoice.id, false); // false = restore stock
        toast({ title: 'Invoice refunded', description: `Invoice ${invoice.id} has been deleted and its pieces returned to stock.` });
        setIsRefundDialogOpen(false);
        router.push('/invoices');
        return;
      }
      const amt = parseFloat(partialRefundAmount);
      if (!(amt > 0)) {
        toast({ title: 'Invalid amount', description: 'Enter a refund amount greater than 0.', variant: 'destructive' });
        return;
      }
      const updated = await refundInvoicePartial(invoice.id, amt, partialRefundReason || undefined);
      if (!updated) {
        toast({ title: 'Error', description: 'Failed to record partial refund.', variant: 'destructive' });
        return;
      }
      setLatest(updated);
      toast({ title: 'Partial refund recorded', description: `PKR ${amt.toLocaleString()} refunded on Invoice ${invoice.id}.` });
      setPartialRefundAmount('');
      setPartialRefundReason('');
      setIsRefundDialogOpen(false);
    } catch (e) {
      toast({ title: 'Not refunded', description: e instanceof Error ? e.message : 'Failed to process refund.', variant: 'destructive' });
    } finally {
      setIsRefunding(false);
    }
  };

  if (!appReady || (!invoice && (!hasInvoicesLoaded || fetched === undefined))) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-4xl">
        <FormSkeleton fields={6} columns={2} />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="container mx-auto p-4 text-center max-w-xl">
        <h2 className="text-xl font-semibold mt-8">{readError ? `Could not read ${invoiceId}` : `Invoice ${invoiceId} not found`}</h2>
        <p className="text-sm text-muted-foreground mt-1">{readError ? `${readError} Sign in with an account of this shop and try again.` : 'It may have been refunded in full, which removes it.'}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild variant="outline"><Link href="/invoices">All invoices</Link></Button>
          <Button asChild><Link href="/invoices/new"><PlusCircle className="mr-2 h-4 w-4"/>New sale</Link></Button>
        </div>
      </div>
    );
  }

  return (
      <div className="bg-muted min-h-screen p-4 sm:p-8">
        <div style={{ display: 'none' }}>
          <img id="shop-logo" src={STORE_LOGO_URL} crossOrigin="anonymous" alt="" loading="lazy" decoding="async" />
          <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
          <QRCode id="links-qr-code" value={storeLinksUrl()} size={128} />
          <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
        </div>
        <Card className="max-w-4xl mx-auto shadow-lg">
           <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                <div className="min-w-0">
                    {/* You reach this page by opening an existing invoice, so
                        "created successfully" was announcing something that had
                        not just happened. The identifier leads, and the line
                        under it says what is actually owed. */}
                    <CardTitle className="text-2xl font-bold font-mono">{invoice.id}</CardTitle>
                    <CardDescription className="mt-1">
                      {invoice.customerName || 'Walk-in Customer'}
                      {' · '}
                      {new Date(invoice.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      {invoice.takenBy && <>{' · taken by '}{invoice.takenBy}</>}
                    </CardDescription>
                    <div className="flex items-center gap-2 mt-2">
                      {(invoice.balanceDue || 0) > 0 ? (
                        <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/5">
                          PKR {(invoice.balanceDue || 0).toLocaleString()} due
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-success border-success/40 bg-success/5">Paid in full</Badge>
                      )}
                      {invoice.status === 'Refunded' && <Badge variant="destructive">Refunded</Badge>}
                    </div>
                </div>
                 <div className="flex gap-2 flex-col sm:flex-row">
                    <Button asChild variant="outline">
                      <Link href={`/invoices/${invoice.id}/edit`}><Edit className="mr-2 h-4 w-4"/> Edit invoice</Link>
                    </Button>
                     <PrintButton
                      variant="default" size="default"
                      pieces={Array.isArray(invoice.items) ? invoice.items.length : Object.keys(invoice.items || {}).length}
                      onPrint={() => printInvoice(invoice)}
                      onPrintPerPiece={() => printInvoice(invoice, true)}
                    />
                    {invoice.status !== 'Refunded' && (
                      <Button variant="outline" onClick={() => setIsRefundDialogOpen(true)} className="border-destructive text-destructive hover:bg-destructive/10">
                        <RotateCcw className="mr-2 h-4 w-4"/> Refund
                      </Button>
                    )}
                    <Button variant="ghost" onClick={handleDeleteInvoice} className="text-destructive hover:bg-destructive/10 hover:text-destructive" title="Delete this invoice (asks for the delete code)">
                      <Trash2 className="mr-2 h-4 w-4"/> Delete
                    </Button>
                    <Button asChild variant="ghost">
                      <Link href="/invoices/new"><PlusCircle className="mr-2 h-4 w-4"/> New sale</Link>
                    </Button>
                 </div>
            </div>
           </CardHeader>
           <CardContent className="space-y-6">
                {invoice.internalNote && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p className="font-semibold flex items-center text-warning"><Lock className="w-3.5 h-3.5 mr-1.5"/>For the shop <span className="ml-1.5 font-normal">(never printed)</span></p>
                    <p className="text-warning whitespace-pre-wrap mt-1">{invoice.internalNote}</p>
                  </div>
                )}
                {/* An order's advances, exchange and the rest, read from the order itself. */}
                <OrderCarryOver invoice={invoice} />
                <div className="p-4 border rounded-md bg-background">
                    {(() => {
                      const shipTo = describeDelivery(invoice.delivery);
                      if (!shipTo.length) return null;
                      return (
                        <>
                          <div className="mb-4">
                            <p className="text-2xs uppercase tracking-wide text-muted-foreground">Deliver to</p>
                            {shipTo.map(l => <p key={l} className="text-sm">{l}</p>)}
                          </div>
                          <Separator/>
                        </>
                      );
                    })()}
                    {/* Item cards, not a two-column table. The screen was
                        showing less than the printed invoice: name, size, SKU
                        and a total, while the PDF carried the metal, the
                        weight, the stones and the cost breakdown. */}
                    <div className="space-y-3 mt-4">
                      {invoice.items.map((item, index) => {
                        const spec: [string, string][] = [];
                        spec.push(['Metal', describeMetal(item.metalType, item.karat)]);
                        if ((item.metalWeightG ?? 0) > 0) spec.push(['Weight', `${item.metalWeightG}g`]);
                        if (item.size) spec.push(['Size', item.size]);
                        const finish = describePlating(item);
                        if (finish) spec.push(['Finish', finish]);
                        if ((item.stoneWeightG ?? 0) > 0) spec.push(['Stone weight', `${item.stoneWeightG}g`]);
                        if (stockSku(item.sku)) spec.push(['SKU', item.sku]);

                        const costs: [string, number][] = [];
                        if ((item.metalCost ?? 0) > 0) costs.push(['Metal', item.metalCost]);
                        if ((item.wastageCost ?? 0) > 0) costs.push([`Wastage (${item.wastagePercentage}%)`, item.wastageCost]);
                        if ((item.makingCharges ?? 0) > 0) costs.push(['Making', item.makingCharges]);
                        if ((item.diamondChargesIfAny ?? 0) > 0) costs.push(['Diamonds', item.diamondChargesIfAny]);
                        if ((item.stoneChargesIfAny ?? 0) > 0) costs.push(['Stones', item.stoneChargesIfAny]);
                        if ((item.miscChargesIfAny ?? 0) > 0) costs.push(['Misc', item.miscChargesIfAny]);

                        return (
                          <div key={item.sku ?? index} className="rounded-lg border p-3">
                            <div className="flex items-baseline justify-between gap-3">
                              <div className="min-w-0">
                                {item.itemCategory && (
                                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {categorySingular(item.itemCategory) || item.itemCategory}
                                  </span>
                                )}
                                <p className="font-semibold truncate">{item.name}</p>
                              </div>
                              <span className="font-semibold tabular-nums flex-shrink-0">
                                PKR {item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>

                            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-sm">
                              {spec.map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                                  <dd className="truncate" title={value}>{value}</dd>
                                </div>
                              ))}
                            </dl>

                            {/* The same lines the printed invoice carries, so
                                the screen and the paper agree. */}
                            {describeSettings(item).filter(l => !l.startsWith('Finish:') && !l.startsWith('Stone weight:')).map(line => (
                              <p key={line} className="text-xs mt-1.5 text-muted-foreground">{line}</p>
                            ))}

                            {costs.length > 0 && (
                              <div className="mt-2 pt-2 border-t flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                                {costs.map(([label, amount]) => (
                                  <span key={label} className="tabular-nums">
                                    {label} {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                     <Separator className="mt-4"/>
                     <div className="pt-4 space-y-2 text-right">
                        <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Subtotal:</span> <span className="w-32 font-medium">PKR {invoice.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        <div className="flex justify-end items-center gap-2">
                          <span className="text-muted-foreground">Discount:</span>
                          {isEditingDiscount ? (
                            <div className="flex items-center gap-1">
                              <AmountInput
                                value={editDiscountInput}
                                onValueChange={v => setEditDiscountInput(v === undefined ? '' : String(v))}
                                className="w-32 text-right h-8"
                                aria-label="Discount"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDiscount(); if (e.key === 'Escape') setIsEditingDiscount(false); }}
                              />
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleSaveDiscount} disabled={isSavingDiscount} aria-label="Confirm">
                                {isSavingDiscount ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setIsEditingDiscount(false)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              className="w-32 font-medium text-right hover:underline cursor-pointer"
                              onClick={() => { setEditDiscountInput(String(invoice.discountAmount)); setIsEditingDiscount(true); }}
                            >
                              {invoice.discountAmount > 0 ? `- PKR ${invoice.discountAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}` : 'Add discount'}
                            </button>
                          )}
                        </div>
                        {/* The trade-in the customer brought in. It was already taken
                            off the total and printed on the bill, but never shown here,
                            so the figures on screen did not add up. */}
                        {getInvoiceExchangeTotal(invoice) > 0 && (
                          <div className="flex justify-end items-start gap-4">
                            <span className="text-muted-foreground text-right">
                              Exchange:
                              {invoiceExchanges(invoice).map((e, i) => (
                                <span key={i} className="block text-xs">
                                  {describeExchangeEntry(e)}{invoiceExchanges(invoice).length > 1 ? ` — ${e.value.toLocaleString()}` : ''}
                                </span>
                              ))}
                            </span>
                            <span className="w-32 font-medium flex-shrink-0">- PKR {getInvoiceExchangeTotal(invoice).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                          </div>
                        )}
                        {getInvoiceAdjustmentsAmount(invoice) !== 0 && <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Adjustments:</span> <span className="w-32 font-medium">PKR {getInvoiceAdjustmentsAmount(invoice).toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>}
                        <div className="flex justify-end items-center gap-4 text-lg font-bold"><span className="text-muted-foreground">Grand Total:</span> <span className="w-32">PKR {invoice.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        {invoice.amountPaid > 0 && (
                          <div className="flex justify-end items-center gap-4 text-success"><span>Paid:</span> <span className="w-32 font-medium">PKR {invoice.amountPaid.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        )}
                        <div className={cn('flex justify-end items-center gap-4 font-semibold', invoice.balanceDue > 0 ? 'text-destructive' : 'text-muted-foreground')}><span>Balance due:</span> <span className="w-32">PKR {invoice.balanceDue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                     </div>
                </div>

                <Separator />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                         <h3 className="font-semibold text-lg">Send to customer</h3>
                         <div className="space-y-2">
                            <Label htmlFor="whatsapp-number">WhatsApp number</Label>
                             <PhoneField
                                value={phone || undefined}
                                onChange={(val) => setPhone(val || '')}
                                aria-label="WhatsApp number"
                            />
                        </div>
                        <Button onClick={() => handleSendWhatsApp(invoice)} className="w-full">
                            <MessageSquare className="mr-2 h-4 w-4"/> Send via WhatsApp
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Record a payment</h3>
                        {invoice.balanceDue <= 0 ? (
                          <p className="text-sm text-muted-foreground">Nothing outstanding on this invoice.</p>
                        ) : (
                        <>
                        <div className="space-y-2">
                            <Label htmlFor="payment-amount">Amount received (PKR)</Label>
                            <AmountInput 
                                id="payment-amount" 
                                placeholder={`Balance due: ${invoice.balanceDue.toLocaleString()}`}
                                value={paymentAmount}
                                onValueChange={v => setPaymentAmount(v === undefined ? '' : String(v))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Paid by</Label>
                            <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as PaymentType)}>
                              <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PAYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">
                              {paymentMethod === 'Cheque' ? 'Cheque no.'
                                : paymentMethod === 'Card' ? 'Last 4 digits'
                                : paymentMethod === 'Bank Transfer' ? 'Reference' : 'Note'}
                            </Label>
                            <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                              placeholder="Optional" aria-label="Payment reference"
                              disabled={paymentMethod === 'Cash'} />
                          </div>
                        </div>

                        <Button 
                            className="w-full"
                            disabled={!paymentAmount || isSubmittingPayment || invoice.balanceDue <= 0}
                            onClick={() => handleRecordPayment()}
                        >
                            {isSubmittingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Banknote className="mr-2 h-4 w-4"/>}
                            Record payment
                        </Button>

                        {invoice.balanceDue > 0 && (
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={isSubmittingPayment}
                            onClick={() => handleRecordPayment(invoice.balanceDue)}
                          >
                            {isSubmittingPayment
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                              : <CheckCircle className="mr-2 h-4 w-4"/>}
                            Mark paid — PKR {invoice.balanceDue.toLocaleString()}
                          </Button>
                        )}
                        </>
                        )}
                    </div>
                </div>
                 {invoice.paymentHistory && invoice.paymentHistory.length > 0 && (
                     <div>
                        <h3 className="text-lg font-semibold flex items-center mb-2"><List className="mr-2 h-5 w-5"/>Payment history</h3>
                        <div className="rounded-lg border overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead><CalendarIcon className="h-4 w-4 inline-block mr-1"/> Date</TableHead>
                                            <TableHead>Method</TableHead>
                                            <TableHead className="hidden sm:table-cell">Notes</TableHead>
                                            <TableHead className="text-right">Amount (PKR)</TableHead>
                                            <TableHead className="w-10"><span className="sr-only">Delete</span></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {invoice.paymentHistory.map((p, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{format(new Date(p.date), 'PP')}</TableCell>
                                                <TableCell>
                                                  {/* Older records predate payment types and have no method. */}
                                                  {p.method
                                                    ? <Badge variant="outline" className="text-2xs">{p.method}</Badge>
                                                    : <span className="text-muted-foreground text-xs">—</span>}
                                                  {p.reference && <span className="block text-2xs text-muted-foreground mt-0.5">{p.reference}</span>}
                                                </TableCell>
                                                <TableCell className="hidden sm:table-cell">{p.notes || 'Payment received'}</TableCell>
                                                <TableCell className="text-right font-medium">{p.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                                <TableCell className="p-1 text-right">
                                                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    aria-label={`Delete the payment of PKR ${p.amount.toLocaleString()}`} title="Delete this payment (asks for the delete code)"
                                                    onClick={() => handleDeletePayment(index, p)}>
                                                    <Trash2 className="h-4 w-4" />
                                                  </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                        </div>
                     </div>
                 )}

           </CardContent>
        </Card>
      <AlertDialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund Invoice {invoice.id}</AlertDialogTitle>
            <AlertDialogDescription>
              {refundMode === 'full'
                ? 'A full refund deletes the invoice, removes all hisaab entries, and returns all items to stock. This cannot be undone.'
                : 'A partial refund records a negative payment on this invoice and issues a matching refund on Shopify. The invoice stays in your records.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={refundMode === 'full' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRefundMode('full')}
                disabled={isRefunding}
              >Full refund</Button>
              <Button
                type="button"
                variant={refundMode === 'partial' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRefundMode('partial')}
                disabled={isRefunding}
              >Partial refund</Button>
            </div>

            {refundMode === 'partial' && (
              <div className="space-y-2 pt-2">
                <Label htmlFor="refund-amount">Refund amount (PKR)</Label>
                <AmountInput
                  id="refund-amount"
                  inputMode="decimal"
                  placeholder="e.g. 1500"
                  value={partialRefundAmount}
                  onValueChange={v => setPartialRefundAmount(v === undefined ? '' : String(v))}
                  disabled={isRefunding}
                />
                <Label htmlFor="refund-reason">Reason (optional)</Label>
                <Input
                  id="refund-reason"
                  placeholder="e.g. damaged item"
                  value={partialRefundReason}
                  onChange={e => setPartialRefundReason(e.target.value)}
                  disabled={isRefunding}
                />
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRefunding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefundInvoice}
              disabled={isRefunding || (refundMode === 'partial' && !(parseFloat(partialRefundAmount) > 0))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRefunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              {refundMode === 'full' ? 'Yes, Refund Invoice' : 'Record Partial Refund'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
  );
}
