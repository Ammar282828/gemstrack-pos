
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Product, useAppReady } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { QrCode, X, VideoOff, ShoppingCart, Trash2, ExternalLink, ListPlus, ScanLine, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Html5QrcodeScanner,
  Html5QrcodeScanType,
  Html5QrcodeSupportedFormats,
  QrcodeErrorCallback,
  QrcodeSuccessCallback,
  Html5QrcodeScannerState
} from 'html5-qrcode';

const qrReaderElementId = "qr-reader-container";

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
  const appReady = useAppReady();

  const { addToCart, removeFromCart: removeFromCartAction, products } = useAppStore(state => ({
      addToCart: state.addToCart,
      removeFromCart: state.removeFromCart,
      products: state.products
  }));
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(true);
  const html5QrcodeScannerRef = useRef<Html5QrcodeScanner | null>(null);

  const onScanFailure: QrcodeErrorCallback = useCallback((error) => {
     console.warn(`[GemsTrack] QR Scan Error or Not Found: ${error}`);
  }, []);

  const onScanSuccess: QrcodeSuccessCallback = useCallback(async (decodedText, decodedResult) => {
    const product = products.find(p => p.sku === decodedText.trim());

    if (product) {
      addToCart(product.sku);
      toast({ title: "Item Added", description: `${product.name} added to cart.` });
    } else {
      toast({ title: "Product Not Found", description: `No product found with scanned SKU: ${decodedText.trim()}`, variant: "destructive" });
    }
  }, [addToCart, toast, products]);


  useEffect(() => {
    if (!appReady) return; // Don't initialize scanner until app data (products) is ready

    if (isScannerActive) {
      const containerElement = document.getElementById(qrReaderElementId);
      if (!containerElement) {
        console.warn(`[GemsTrack] QR Reader container element with ID '${qrReaderElementId}' not found.`);
        setHasCameraPermission(false);
        return;
      }
      while (containerElement.firstChild) {
        containerElement.removeChild(containerElement.firstChild);
      }

      if (!html5QrcodeScannerRef.current) {
        const newScanner = new Html5QrcodeScanner(
          qrReaderElementId,
          {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const qrboxSize = Math.floor(minEdge * 0.8);
              return { width: qrboxSize, height: qrboxSize };
            },
            rememberLastUsedCamera: true,
            supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
          },
          false 
        );

        try {
          newScanner.render(onScanSuccess, onScanFailure);
          html5QrcodeScannerRef.current = newScanner; 
          setHasCameraPermission(true);
        } catch (renderError) {
          console.error("[GemsTrack] Error calling scanner.render(): ", renderError);
          setHasCameraPermission(false);
          if (newScanner && typeof newScanner.clear === 'function') {
            newScanner.clear().catch(err => {
              console.warn("[GemsTrack] Error clearing scanner after render fail:", err);
            });
          }
          html5QrcodeScannerRef.current = null;
        }
      }
    } else { 
      if (html5QrcodeScannerRef.current) {
        const scannerToClear = html5QrcodeScannerRef.current;
        html5QrcodeScannerRef.current = null; 
        if (scannerToClear.getState && scannerToClear.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
          scannerToClear.clear().catch(err => {
            console.warn("[GemsTrack] Error clearing scanner (isScannerActive false):", err);
          });
        }
      }
    }

    return () => {
      const scannerToClear = html5QrcodeScannerRef.current;
      html5QrcodeScannerRef.current = null; 
      
      if (scannerToClear && typeof scannerToClear.clear === 'function') {
         try {
          if (scannerToClear.getState && scannerToClear.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
            scannerToClear.clear().catch(err => {
               console.warn("[GemsTrack] Error clearing scanner on cleanup (was active):", err);
            });
          }
        } catch (e) {
             console.warn("[GemsTrack] Error during scanner state check/clear on cleanup:", e);
             scannerToClear.clear().catch(err_1 => {
                 console.warn("[GemsTrack] Error clearing scanner on cleanup (fallback):", err_1);
             });
        }
      }
    };
  }, [appReady, isScannerActive, onScanSuccess, onScanFailure]);

  const handleManualSkuAdd = () => {
    if (!skuInput.trim()) {
      toast({ title: "Input SKU", description: "Please enter a SKU to add.", variant: "destructive" });
      return;
    }
    const product = products.find(p => p.sku === skuInput.trim());

    if (product) {
      addToCart(product.sku);
      toast({ title: "Item Added", description: `${product.name} added to cart.` });
      setSkuInput('');
    } else {
      toast({ title: "Product Not Found", description: `No product found with SKU: ${skuInput.trim()}`, variant: "destructive" });
    }
  };

  const toggleScanner = () => {
    setIsScannerActive(prev => !prev);
  };

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading POS Scanner...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

        {/* --- Right Column (Cart Summary) - MOVED TO TOP ON MOBILE --- */}
        <div className="lg:col-span-1 lg:sticky lg:top-8 order-1 lg:order-2">
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

        {/* --- Left Column (Scanner & Manual Input) --- */}
        <div className="lg:col-span-2 space-y-6 order-2 lg:order-1">
          <Card>
            <CardHeader className="text-center">
              <QrCode className="w-12 h-12 mx-auto text-primary mb-3" />
              <CardTitle className="text-2xl">Point of Sale - Scan Items</CardTitle>
              <CardDescription>Scan product QR codes to add to the sale. Or, enter SKU manually.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isScannerActive && (
                <div id={qrReaderElementId} className="w-full aspect-[4/3] md:aspect-video border rounded-md bg-muted overflow-hidden mx-auto max-w-lg">
                  {/* The html5-qrcode library will render its UI here. */}
                </div>
              )}
              
              {isScannerActive && hasCameraPermission === null && (
                <div className="text-center py-2 text-muted-foreground">
                  <ScanLine className="w-10 h-10 mb-1 mx-auto animate-pulse" />
                  <p className="text-sm">Initializing QR Scanner...</p>
                  <p className="text-xs">Waiting for camera permission.</p>
                </div>
              )}
              
              {isScannerActive && hasCameraPermission === false && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>Camera Access Denied or Scanner Error</AlertTitle>
                  <AlertDescription>
                    Could not access the camera or start the QR scanner. Please ensure camera permissions are enabled. You can use manual SKU entry or try toggling the scanner.
                  </AlertDescription>
                </Alert>
              )}

              <div className="text-center">
                <Button size="lg" onClick={toggleScanner} variant={isScannerActive ? "outline" : "default"} className="w-full md:w-auto">
                  {isScannerActive ? <VideoOff className="mr-2 h-5 w-5" /> : <ScanLine className="mr-2 h-5 w-5" />}
                  {isScannerActive ? "Stop Scanner" : "Start Scanner"}
                </Button>
              </div>

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
                    aria-label="Manually enter SKU"
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
      </div>
    </div>
  );
}
