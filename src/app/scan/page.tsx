
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QrCode, Search, X, VideoOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsStoreHydrated } from '@/lib/store';
import { 
  Html5QrcodeScanner, 
  Html5QrcodeScanType, 
  Html5QrcodeSupportedFormats,
  QrcodeErrorCallback,
  QrcodeSuccessCallback,
  Html5QrcodeScannerState // Import scanner state
} from 'html5-qrcode';

const qrReaderElementId = "qr-reader-container";

export default function ScanPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [skuInput, setSkuInput] = useState('');
  const products = useAppStore(state => state.products);
  const isHydrated = useIsStoreHydrated();

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const html5QrcodeScannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const onScanSuccess: QrcodeSuccessCallback = (decodedText, decodedResult) => {
      // Stop the scanner when a QR code is found.
      if (html5QrcodeScannerRef.current && typeof html5QrcodeScannerRef.current.clear === 'function') {
         // Check state before clearing if possible
        if (html5QrcodeScannerRef.current.getState && 
            (html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.SCANNING ||
             html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.PAUSED)
            ) {
          html5QrcodeScannerRef.current.clear().catch(err => console.error("Error clearing scanner on success:", err));
        } else if (!html5QrcodeScannerRef.current.getState) {
          // Fallback if getState is not available
           html5QrcodeScannerRef.current.clear().catch(err => console.error("Error clearing scanner on success (no state check):", err));
        }
      }
      // It's good practice to nullify the ref after clearing if you intend for it to be re-initialized later,
      // but since we navigate away, the component unmount will handle it.
      
      setSkuInput(decodedText);
      const productExists = products.some(p => p.sku === decodedText.trim());
      if (productExists) {
        toast({ title: "QR Code Scanned!", description: `SKU: ${decodedText}. Navigating...` });
        router.push(`/products/${decodedText.trim()}`);
      } else {
        toast({ title: "Product Not Found", description: `No product found with scanned SKU: ${decodedText.trim()}`, variant: "destructive" });
        // Consider re-enabling scanner or providing UI to scan again if product not found.
        // For now, it stops.
      }
    };

    const onScanFailure: QrcodeErrorCallback = (error) => {
      // console.warn(`QR Scan Error: ${error}`); // Can be noisy
    };

    if (document.getElementById(qrReaderElementId) && !html5QrcodeScannerRef.current) {
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
        /* verbose= */ false
      );

      try {
        scanner.render(onScanSuccess, onScanFailure);
        html5QrcodeScannerRef.current = scanner; // Store the instance
        setHasCameraPermission(true); // Optimistically set true if render() doesn't throw
      } catch (error) {
        console.error("Error calling scanner.render(): ", error);
        toast({
            title: "Scanner Initialization Failed",
            description: "Could not start the QR scanner. Please check camera permissions and ensure your browser supports WebRTC.",
            variant: "destructive"
        });
        setHasCameraPermission(false);
        if (html5QrcodeScannerRef.current && typeof html5QrcodeScannerRef.current.clear === 'function') {
             html5QrcodeScannerRef.current.clear().catch(e => console.error("Error clearing scanner during init failure:", e));
             html5QrcodeScannerRef.current = null;
        }
      }
    }

    return () => {
      if (html5QrcodeScannerRef.current && typeof html5QrcodeScannerRef.current.clear === 'function') {
        const scannerInstance = html5QrcodeScannerRef.current;
         // Check if the scanner is in a state that can be cleared
        if (scannerInstance.getState && 
            (scannerInstance.getState() === Html5QrcodeScannerState.SCANNING ||
             scannerInstance.getState() === Html5QrcodeScannerState.PAUSED)
            ) {
          scannerInstance.clear().catch(err => {
            console.error("Error clearing scanner on component unmount:", err);
          });
        } else if (!scannerInstance.getState) {
           // Fallback if getState is not available (e.g. if init was incomplete)
           scannerInstance.clear().catch(err => {
            console.error("Error clearing scanner (no state check) on component unmount:", err);
          });
        }
        html5QrcodeScannerRef.current = null;
      }
    };
  }, [isHydrated, products, router, toast]);

  const handleManualSkuSearch = () => {
    if (!skuInput.trim()) {
      toast({ title: "Input SKU", description: "Please enter a SKU to search.", variant: "destructive" });
      return;
    }
    const productExists = products.some(p => p.sku === skuInput.trim());
    if (productExists) {
      router.push(`/products/${skuInput.trim()}`);
    } else {
      toast({ title: "Product Not Found", description: `No product found with SKU: ${skuInput.trim()}`, variant: "destructive" });
    }
  };
  
  if (!isHydrated) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Loading scanner...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 flex flex-col items-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <QrCode className="w-16 h-16 mx-auto text-primary mb-4" />
          <CardTitle className="text-2xl">Scan Product QR Code</CardTitle>
          <CardDescription>Point your camera at a QR code. Or, enter the SKU manually below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div id={qrReaderElementId} className="w-full aspect-video border rounded-md bg-muted overflow-hidden">
            {/* html5-qrcode-scanner will render here */}
            {hasCameraPermission === null && (
                 <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <VideoOff className="w-12 h-12 mb-2" />
                    <p>Initializing QR Scanner...</p>
                    <p className="text-xs">Camera permission may be requested.</p>
                </div>
            )}
          </div>

          {hasCameraPermission === false && (
            <Alert variant="destructive">
              <AlertTitle>Camera Access Denied or Scanner Error</AlertTitle>
              <AlertDescription>
                Could not access the camera or start the QR scanner. Please ensure camera permissions are enabled in your browser settings and try again. You can still use manual SKU entry.
              </AlertDescription>
            </Alert>
          )}
          
          <div className="pt-4">
            <Label htmlFor="sku-input" className="text-sm font-medium">Enter SKU Manually</Label>
            <div className="flex items-center space-x-2 mt-1">
                <Input
                id="sku-input"
                type="text"
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                placeholder="e.g., RIN-000001"
                className="text-lg"
                onKeyPress={(e) => { if (e.key === 'Enter') handleManualSkuSearch(); }}
                />
                 {skuInput && (
                    <Button variant="ghost" size="icon" onClick={() => setSkuInput('')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </Button>
                )}
            </div>
          </div>
          <Button size="lg" className="w-full" onClick={handleManualSkuSearch}>
            <Search className="mr-2 h-5 w-5" /> Find Product by SKU
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
