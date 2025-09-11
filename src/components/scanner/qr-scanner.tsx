
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode, QrcodeSuccessCallback } from 'html5-qrcode';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const qrReaderElementId = "qr-reader-container";

let audioContext: AudioContext | null = null;
const playBeep = () => {
    if (typeof window !== 'undefined') {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch (e) {
                console.error("Could not create audio context", e);
                return;
            }
        }
        if (!audioContext) return;
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    }
};

interface QrScannerProps {
  isActive: boolean;
}

export default function QrScanner({ isActive }: QrScannerProps) {
  const { toast } = useToast();
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ text: string; time: number } | null>(null);
  
  const [scannerState, setScannerState] = useState<'stopped' | 'starting' | 'scanning' | 'error'>('stopped');
  const [scanSuccess, setScanSuccess] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cameraCapabilities, setCameraCapabilities] = useState<MediaTrackCapabilities | null>(null);

  const onScanSuccess: QrcodeSuccessCallback = useCallback((decodedText) => {
    const now = Date.now();
    const lastScan = lastScanRef.current;
    
    // Debounce logic: if the same code was scanned less than 2 seconds ago, ignore it.
    if (lastScan && lastScan.text === decodedText && (now - lastScan.time) < 2000) {
        return;
    }
    
    const state = useAppStore.getState();
    const isAlreadyInCart = state.cart.some(item => item.sku === decodedText.trim());

    if (isAlreadyInCart) {
        // Only toast for the first time it sees the duplicate
        if (!lastScan || lastScan.text !== decodedText) { 
             toast({
                title: "Item Already in Cart",
                description: `Product with SKU ${decodedText.trim()} is already in your cart.`,
                variant: "default"
            });
        }
    } else {
        const product = state.products.find(p => p.sku === decodedText.trim());
        if (product) {
          state.addToCart(product.sku);
          toast({ title: "Item Added", description: `${product.name} added to cart.` });
          playBeep();
          setScanSuccess(true);
          setTimeout(() => setScanSuccess(false), 300);
        } else {
          toast({ title: "Product Not Found", description: `No product found with scanned SKU: ${decodedText.trim()}`, variant: "destructive" });
        }
    }
    lastScanRef.current = { text: decodedText, time: now };
  }, [toast]);


  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(qrReaderElementId, false);
    }
    const qrCode = html5QrCodeRef.current;

    const startScanner = () => {
        if (qrCode && !qrCode.isScanning && scannerState !== 'starting' && scannerState !== 'scanning') {
            setScannerState('starting');
            qrCode.start(
                { facingMode: "environment" },
                { fps: 15, qrbox: { width: 250, height: 250 } },
                onScanSuccess,
                (errorMessage) => {} // onScanFailure - intentionally empty
            ).then(() => {
                setScannerState('scanning');
                try {
                    const capabilities = qrCode.getRunningTrackCapabilities?.();
                    if (capabilities) {
                        setCameraCapabilities(capabilities);
                        // @ts-ignore
                        if (capabilities.zoom) setZoom(capabilities.zoom.min);
                    }
                } catch(e) {
                    console.warn("Could not get camera capabilities:", e);
                }
            }).catch((err) => {
                console.error("Failed to start QR scanner:", err);
                setScannerState('error');
            });
        }
    };

    const stopScanner = () => {
        if (qrCode && qrCode.isScanning) {
            qrCode.stop().then(() => {
                setScannerState('stopped');
                setCameraCapabilities(null);
            }).catch((err) => {
                console.error("Error stopping scanner:", err);
                setScannerState('stopped'); // Force stop state
            });
        } else {
            setScannerState('stopped');
        }
    };
    
    if (isActive) {
      startScanner();
    } else {
      stopScanner();
    }

    return () => {
      // Ensure scanner is stopped on component unmount
      if (qrCode && qrCode.isScanning) {
        qrCode.stop().catch(err => {});
      }
    };
  }, [isActive, onScanSuccess]);

 useEffect(() => {
    const applyZoom = async () => {
        if (!html5QrCodeRef.current?.isScanning) return;
        try {
            const currentTrack = html5QrCodeRef.current.getRunningTrack?.();
            if (currentTrack && cameraCapabilities && (cameraCapabilities as any).zoom) {
                await currentTrack.applyConstraints({
                    // @ts-ignore
                    advanced: [{ zoom: zoom }]
                });
            }
        } catch(e) {
            console.warn("Could not apply zoom", e);
        }
    };

    if (scannerState === 'scanning' && cameraCapabilities) {
        applyZoom();
    }
  }, [zoom, scannerState, cameraCapabilities]);

  return (
    <div className="space-y-4">
      <div
          id={qrReaderElementId}
          className={cn(
            "w-full border-4 border-transparent rounded-md bg-muted overflow-hidden mx-auto max-w-lg relative transition-all duration-300 min-h-[250px]",
            " [&>span]:hidden [&>video]:w-full [&>video]:h-full [&>video]:object-cover",
            scanSuccess && "border-green-500 shadow-lg shadow-green-500/50"
          )}
        ></div>
      
      {scannerState === 'starting' && (
        <div className="text-center py-2 text-muted-foreground">
          <Loader2 className="w-8 h-8 mb-1 mx-auto animate-spin text-primary" />
          <p className="text-sm">Initializing QR Scanner...</p>
          <p className="text-xs">Waiting for camera permission.</p>
        </div>
      )}
      
      {scannerState === 'error' && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Camera Access Denied or Scanner Error</AlertTitle>
          <AlertDescription>
            Could not access the camera or start the QR scanner. Please ensure camera permissions are enabled. You can use manual SKU entry or try toggling the scanner.
          </AlertDescription>
        </Alert>
      )}

      {scannerState === 'scanning' && (cameraCapabilities as any)?.zoom && (
        <div className="p-4 border rounded-md">
          <Label htmlFor="zoom-slider">Zoom</Label>
          <div className="flex items-center gap-2">
            <ZoomOut className="h-5 w-5" />
            <Slider
              id="zoom-slider"
              min={(cameraCapabilities as any).zoom.min}
              max={(cameraCapabilities as any).zoom.max}
              step={(cameraCapabilities as any).zoom.step}
              value={[zoom]}
              onValueChange={(value) => setZoom(value[0])}
            />
            <ZoomIn className="h-5 w-5" />
          </div>
        </div>
      )}

    </div>
  );
}
