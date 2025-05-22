
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Html5QrcodeScannerState
} from 'html5-qrcode';

const qrReaderElementId = "qr-reader-container";

export default function ScanPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [skuInput, setSkuInput] = useState('');
  const isHydrated = useIsStoreHydrated();

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const html5QrcodeScannerRef = useRef<Html5QrcodeScanner | null>(null);

  const onScanFailure: QrcodeErrorCallback = useCallback((error) => {
    // console.warn(`[GemsTrack] QR Scan Error: ${error}`); // Can be noisy
  }, []);

  const onScanSuccess: QrcodeSuccessCallback = useCallback(async (decodedText, decodedResult) => {
    setSkuInput(decodedText); // Update input for user feedback
    const currentProducts = useAppStore.getState().products;
    const productExists = currentProducts.some(p => p.sku === decodedText.trim());

    const scannerInstance = html5QrcodeScannerRef.current; // Capture instance at call time

    if (productExists) {
      toast({ title: "QR Code Scanned!", description: `SKU: ${decodedText}. Navigating...` });
      if (scannerInstance && typeof scannerInstance.clear === 'function') {
        try {
          // Check state before clearing
          if (scannerInstance.getState &&
              (scannerInstance.getState() === Html5QrcodeScannerState.SCANNING ||
               scannerInstance.getState() === Html5QrcodeScannerState.PAUSED)) {
            await scannerInstance.clear();
          }
        } catch (error) {
          console.error("[GemsTrack] Error clearing scanner onScanSuccess (before navigation):", error);
        } finally {
          // Nullify the ref if the instance we attempted to clear is still the current one.
          if (html5QrcodeScannerRef.current === scannerInstance) {
            html5QrcodeScannerRef.current = null;
          }
        }
      }
      router.push(`/products/${decodedText.trim()}`);
    } else {
      toast({ title: "Product Not Found", description: `No product found with scanned SKU: ${decodedText.trim()}`, variant: "destructive" });
      // Scanner will continue if product not found, user can try again or enter manually
    }
  }, [router, toast]); // Stable dependencies

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

    // If a scanner instance already exists and is in an active state, do nothing.
    if (html5QrcodeScannerRef.current &&
        html5QrcodeScannerRef.current.getState &&
        (html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.SCANNING ||
         html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.PAUSED)) {
      return;
    }

    // Clear any previous instance before creating a new one, especially if dependencies caused a re-run.
    if (html5QrcodeScannerRef.current && typeof html5QrcodeScannerRef.current.clear === 'function') {
        try {
            if (html5QrcodeScannerRef.current.getState &&
                (html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.SCANNING ||
                 html5QrcodeScannerRef.current.getState() === Html5QrcodeScannerState.PAUSED)) {
                html5QrcodeScannerRef.current.clear().catch(e => console.error("Error clearing old scanner in useEffect (before new render):", e));
            }
        } catch (e) {
            console.error("Error during pre-emptive clear in useEffect:", e);
        }
        html5QrcodeScannerRef.current = null; // Nullify after attempt
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
      /* verbose= */ false
    );

    try {
      scanner.render(onScanSuccess, onScanFailure);
      html5QrcodeScannerRef.current = scanner;
      setHasCameraPermission(true);
    } catch (error) {
      console.error("[GemsTrack] Error calling scanner.render(): ", error);
      toast({
          title: "Scanner Initialization Failed",
          description: "Could not start the QR scanner. Please check camera permissions and ensure your browser supports WebRTC.",
          variant: "destructive"
      });
      setHasCameraPermission(false);
      if (scanner && typeof scanner.clear === 'function') { // Try to clear the newly created scanner instance if render failed
           try { scanner.clear().catch(e => console.error("Error clearing scanner after render fail:", e)); }
           catch(e) { console.error("Synchronous error clearing scanner after render fail:", e); }
      }
      html5QrcodeScannerRef.current = null; // Ensure ref is null on failure
    }

    return () => {
      const scannerInstance = html5QrcodeScannerRef.current; // Capture ref at cleanup time
      if (scannerInstance && typeof scannerInstance.clear === 'function') {
        try {
          if (scannerInstance.getState &&
              (scannerInstance.getState() === Html5QrcodeScannerState.SCANNING ||
               scannerInstance.getState() === Html5QrcodeScannerState.PAUSED)) {
            scannerInstance.clear().catch(err => {
              console.error("[GemsTrack] Error clearing scanner on component unmount (state check):", err);
            });
          }
        } catch (e) {
            console.error("[GemsTrack] Synchronous error during unmount clear:", e);
        }
      }
      html5QrcodeScannerRef.current = null; // Always nullify ref on unmount
    };
  }, [isHydrated, onScanSuccess, onScanFailure, toast]); // Dependencies are stable


  const handleManualSkuSearch = () => {
    if (!skuInput.trim()) {
      toast({ title: "Input SKU", description: "Please enter a SKU to search.", variant: "destructive" });
      return;
    }
    const currentProducts = useAppStore.getState().products;
    const productExists = currentProducts.some(p => p.sku === skuInput.trim());
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
          {/* Target for Html5QrcodeScanner. Content inside this div will be managed by the library. */}
          <div id={qrReaderElementId} className="w-full aspect-video border rounded-md bg-muted overflow-hidden">
            {/* Display initial status only if scanner hasn't started and permission not yet determined */}
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
          </div>
          <Button size="lg" className="w-full" onClick={handleManualSkuSearch}>
            <Search className="mr-2 h-5 w-5" /> Find Product by SKU
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
