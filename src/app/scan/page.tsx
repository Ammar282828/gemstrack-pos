
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { QrCode, Search, X, VideoOff, ShoppingCart, Trash2, ExternalLink, ListPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsStoreHydrated } from '@/lib/store';
import {
  Html5QrcodeScanner,
  Html5QrcodeScanType,
  Html5QrcodeSupportedFormats,
  QrcodeErrorCallback,
  QrcodeSuccessCallback,
  Html5QrcodeScannerState
} from 'html5-qrcode';

const qrReaderElementId = "qr-reader-container";

// Adapted CartSummaryItem logic for this page
const ScannedItemDisplay: React.FC<{ item: NonNullable<ReturnType<typeof selectCartDetails>[0]>, removeFromCart: (sku: string) => void }> = ({ item, removeFromCart }) => {
  return (
    <div className="flex justify-between items-center py-2">
      <div>
        <p className="font-medium text-sm leading-tight">{item.name}</p>
        <p className="text-xs text-muted-foreground">Qty: {item.quantity} &bull; Unit: PKR {item.totalPrice.toLocaleString()}</p>
      </div>
      <div className="flex items-center space-x-2">
        <p className="font-semibold text-sm text-primary">PKR {item.lineItemTotal.toLocaleString()}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10"
          onClick={() => removeFromCart(item.sku)}
          aria-label={`Remove ${item.name} from cart`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};


export default function ScanPOSPage() {
  const { toast } = useToast();
  const [skuInput, setSkuInput] = useState('');
  const isHydrated = useIsStoreHydrated();

  const { addToCart, removeFromCart: removeFromCartAction } = useAppStore();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const html5QrcodeScannerRef = useRef<Html5QrcodeScanner | null>(null);

  const onScanFailure: QrcodeErrorCallback = useCallback((error) => {
    // console.warn(`[GemsTrack] QR Scan Error: ${error}`); // Can be noisy
  }, []);

  const onScanSuccess: QrcodeSuccessCallback = useCallback((decodedText, decodedResult) => {
    const allProducts = useAppStore.getState().products;
    const product = allProducts.find(p => p.sku === decodedText.trim());

    if (product) {
      addToCart(product.sku);
      toast({ title: "Item Added", description: `${product.name} added to cart.` });
    } else {
      toast({ title: "Product Not Found", description: `No product found with scanned SKU: ${decodedText.trim()}`, variant: "destructive" });
    }
    // Do not clear or stop the scanner here to allow continuous scanning
  }, [addToCart, toast]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const containerElement = document.getElementById(qrReaderElementId);
    if (!containerElement) {
      console.error(`[GemsTrack] QR Reader container element with ID '${qrReaderElementId}' not found.`);
      setHasCameraPermission(false);
      return;
    }

    if (html5QrcodeScannerRef.current &&
        html5QrcodeScannerRef.current.getState &&
        (html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.SCANNING ||
         html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.PAUSED)) {
      return; // Scanner already active
    }

    // Clear any previous instance if it exists but isn't active (e.g., after an error)
    if (html5QrcodeScannerRef.current && typeof html5QrcodeScannerRef.current.clear === 'function') {
      try {
        if (html5QrcodeScannerRef.current.getState && html5QrcodeScannerRef.current.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
           html5QrcodeScannerRef.current.clear().catch(e => console.error("Error clearing old scanner in useEffect (before new render):", e));
        }
      } catch (e) {
        console.error("Error during pre-emptive clear in useEffect:", e);
      }
      html5QrcodeScannerRef.current = null;
    }

    const scanner = new Html5QrcodeScanner(
      qrReaderElementId,
      {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = Math.floor(minEdge * 0.7);
          return { width: qrboxSize, height: qrboxSize };
        },
        rememberLastUsedCamera: true,
        supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
      },
      false // verbose
    );

    try {
      scanner.render(onScanSuccess, onScanFailure);
      html5QrcodeScannerRef.current = scanner;
      setHasCameraPermission(true);
    } catch (error) {
      console.error("[GemsTrack] Error calling scanner.render(): ", error);
      toast({
          title: "Scanner Error",
          description: "Could not start QR scanner. Check camera permissions or try manual entry.",
          variant: "destructive"
      });
      setHasCameraPermission(false);
      if (scanner && typeof scanner.clear === 'function') {
           try { scanner.clear().catch(e => console.error("Error clearing scanner after render fail:", e)); }
           catch(e) { console.error("Synchronous error clearing scanner after render fail:", e); }
      }
      html5QrcodeScannerRef.current = null;
    }

    return () => {
      const scannerInstance = html5QrcodeScannerRef.current;
      if (scannerInstance && typeof scannerInstance.clear === 'function') {
        try {
          if (scannerInstance.getState &&
              (scannerInstance.getState() === Html5QrcodeScannerState.SCANNING ||
               scannerInstance.getState() === Html5QrcodeScannerState.PAUSED)) {
            scannerInstance.clear().catch(err => {
              console.error("[GemsTrack] Error clearing scanner on component unmount:", err);
            });
          }
        } catch (e) {
            console.error("[GemsTrack] Synchronous error during unmount clear:", e);
        }
      }
      html5QrcodeScannerRef.current = null;
    };
  }, [isHydrated, onScanSuccess, onScanFailure, toast]);


  const handleManualSkuAdd = () => {
    if (!skuInput.trim()) {
      toast({ title: "Input SKU", description: "Please enter a SKU to add.", variant: "destructive" });
      return;
    }
    const allProducts = useAppStore.getState().products;
    const product = allProducts.find(p => p.sku === skuInput.trim());

    if (product) {
      addToCart(product.sku);
      toast({ title: "Item Added", description: `${product.name} added to cart.` });
      setSkuInput(''); // Clear input after adding
    } else {
      toast({ title: "Product Not Found", description: `No product found with SKU: ${skuInput.trim()}`, variant: "destructive" });
    }
  };

  if (!isHydrated) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Loading POS Scanner...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left/Main Column: Scanner and Manual Input */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="text-center">
              <QrCode className="w-12 h-12 mx-auto text-primary mb-3" />
              <CardTitle className="text-2xl">Point of Sale - Scan Items</CardTitle>
              <CardDescription>Scan product QR codes to add them to the current sale. Or, enter SKU manually.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div id={qrReaderElementId} className="w-full aspect-[4/3] md:aspect-video border rounded-md bg-muted overflow-hidden mx-auto max-w-lg">
                {hasCameraPermission === null && !html5QrcodeScannerRef.current && (
                     <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <VideoOff className="w-12 h-12 mb-2" />
                        <p>Initializing QR Scanner...</p>
                        <p className="text-xs">Waiting for camera permission.</p>
                    </div>
                )}
              </div>

              {hasCameraPermission === false && (
                <Alert variant="destructive">
                  <AlertTitle>Camera Access Denied or Scanner Error</AlertTitle>
                  <AlertDescription>
                    Could not access the camera or start the QR scanner. Please ensure camera permissions are enabled. You can use manual SKU entry.
                  </AlertDescription>
                </Alert>
              )}

              <div className="pt-4">
                <Label htmlFor="sku-input" className="text-sm font-medium">Enter SKU Manually to Add</Label>
                <div className="flex items-center space-x-2 mt-1">
                    <Input
                    id="sku-input"
                    type="text"
                    value={skuInput}
                    onChange={(e) => setSkuInput(e.target.value)}
                    placeholder="e.g., RIN-000001"
                    className="text-base"
                    onKeyPress={(e) => { if (e.key === 'Enter') handleManualSkuAdd(); }}
                    />
                     {skuInput && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSkuInput('')}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Clear SKU input"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>
                 <Button size="lg" className="w-full mt-3" onClick={handleManualSkuAdd}>
                    <ListPlus className="mr-2 h-5 w-5" /> Add SKU to Sale
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Cart Summary */}
        <div className="lg:col-span-1 sticky top-8">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl flex items-center">
                <ShoppingCart className="w-5 h-5 mr-2 text-primary" />
                Current Sale
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cartItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Scan or add products to start a sale.</p>
              ) : (
                <ScrollArea className="h-[300px] pr-3 mb-4">
                  <div className="space-y-1">
                    {cartItems.map(item => item && (
                      <ScannedItemDisplay key={item.sku} item={item} removeFromCart={removeFromCartAction} />
                    ))}
                  </div>
                </ScrollArea>
              )}
              {cartItems.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="flex justify-between items-center font-semibold text-lg">
                    <span>Subtotal:</span>
                    <span className="text-primary">PKR {cartSubtotal.toLocaleString()}</span>
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter>
              <Button asChild size="lg" className="w-full" disabled={cartItems.length === 0}>
                <Link href="/cart">
                  View Cart & Checkout <ExternalLink className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}


    