"use client";

import React, { useState, useEffect } from 'react';
import { STORE_CONFIG, storeLinksUrl, STORE_LOGO_URL } from '@/lib/store-config';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Invoice, Settings, Customer } from '@/lib/store';
import { Download, CheckCircle, Files } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { saveInvoicePdf } from '@/lib/invoice-pdf';
import QRCode from 'qrcode.react';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';
import { DetailSkeleton } from '@/components/shared/skeletons';
import { useToast } from '@/hooks/use-toast';

export default function ViewInvoicePage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const { toast } = useToast();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pieceCount = !invoice ? 0 : Array.isArray(invoice.items) ? invoice.items.length : Object.keys(invoice.items || {}).length;

  useEffect(() => {
    if (!invoiceId) return;

    const fetchInvoiceData = async () => {
      try {
        // Fetch Invoice
        const invoiceDocRef = doc(db, 'invoices', invoiceId);
        const invoiceDoc = await getDoc(invoiceDocRef);

        if (invoiceDoc.exists()) {
          const fetchedInvoice = { id: invoiceDoc.id, ...invoiceDoc.data() } as Invoice;
          setInvoice(fetchedInvoice);

          // Fetch Customer if customerId exists
          if (fetchedInvoice.customerId) {
            const customerDocRef = doc(db, 'customers', fetchedInvoice.customerId);
            const customerDoc = await getDoc(customerDocRef);
            if (customerDoc.exists()) {
              setCustomer({ id: customerDoc.id, ...customerDoc.data() } as Customer);
            }
          }
        } else {
          setError("Invoice not found. The link may be invalid or the invoice may have been deleted.");
        }

        // Fetch Settings
        const settingsDocRef = doc(db, 'app_settings', 'global');
        const settingsDoc = await getDoc(settingsDocRef);
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as Settings);
        }

      } catch (err) {
        console.error("Error fetching invoice data:", err);
        setError("An error occurred while trying to load the invoice.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoiceData();
  }, [invoiceId]);
  
  const handlePrint = async (perPiece = false) => {
    if (!invoice || !settings) return;
    // A customer opening their own estimate gets no console; a silent failure
    // here is indistinguishable from a dead button.
    try {
      await saveInvoicePdf(invoice, { customer, perPiece });
    } catch (e) {
      console.error('[GemsTrack] estimate PDF failed', e);
      toast({
        title: 'Could not create the PDF',
        description: e instanceof Error ? e.message : 'Something went wrong while drawing it.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <DetailSkeleton sections={2} />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-destructive/10 p-4">
        <Card className="w-full max-w-lg border-destructive">
            <CardHeader>
                <h1 className="text-xl font-semibold text-destructive">Error</h1>
            </CardHeader>
            <CardContent>
                <p>{error || "Invoice could not be loaded."}</p>
            </CardContent>
        </Card>
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
        <Card className="max-w-2xl mx-auto shadow-2xl">
            <CardHeader className="text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-success"/>
                <CardTitle className="text-2xl font-bold">Estimate Ready</CardTitle>
                <CardDescription>
                    Your estimate <span className="font-mono font-medium text-foreground">{invoice.id}</span> is ready for download.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="p-4 border rounded-md bg-background">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-sm text-muted-foreground">Billed to</p>
                            <p className="font-semibold">{invoice.customerName || 'Walk-in Customer'}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground text-right">Grand Total</p>
                            <p className="font-semibold text-xl text-primary text-right">PKR {invoice.grandTotal.toLocaleString()}</p>
                            {getInvoiceAdjustmentsAmount(invoice) !== 0 && (
                                <p className="text-xs text-muted-foreground text-right">
                                    Includes adjustments of PKR {getInvoiceAdjustmentsAmount(invoice).toLocaleString()}
                                </p>
                            )}
                        </div>
                    </div>
                     {invoice.amountPaid > 0 && (
                        <div className="border-t mt-3 pt-3">
                            <div className="flex justify-between items-center">
                                <p className="text-sm text-muted-foreground">Amount Paid</p>
                                <p className="font-semibold text-success">- PKR {invoice.amountPaid.toLocaleString()}</p>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <p className="text-sm text-muted-foreground">Balance Due</p>
                                <p className="font-semibold text-destructive">PKR {invoice.balanceDue.toLocaleString()}</p>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter>
                 <div className="w-full space-y-2">
                   <Button onClick={() => handlePrint()} disabled={!settings} size="lg" className="w-full">
                      <Download className="mr-2 h-5 w-5" /> Download PDF
                  </Button>
                  {pieceCount > 1 && (
                    <Button onClick={() => handlePrint(true)} disabled={!settings} variant="outline" size="lg" className="w-full">
                      <Files className="mr-2 h-5 w-5" /> Each piece on its own page
                      <span className="ml-2 text-xs text-muted-foreground">{pieceCount} pages</span>
                    </Button>
                  )}
                 </div>
            </CardFooter>
        </Card>
         <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>Thank you for your business.</p>
            {settings?.shopName && <p>&copy; {new Date().getFullYear()} {settings.shopName}</p>}
        </footer>
    </div>
  );
}
