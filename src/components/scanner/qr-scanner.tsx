

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

const Viewfinder = () => (
    <>
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
            <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
        </div>
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-red-500/50 animate-scan-line" />
    </>
);


export default function QrScanner({ isActive }: QrScannerProps) {
  const { toast } = useToast();
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const operationLock = useRef(false);
  const lastScanRef = useRef<{ text: string; time: number } | null>(null);

  const [scannerState, setScannerState] = useState<'stopped' | 'starting' | 'scanning' | 'error'>('stopped');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number; step: number } | null>(null);
  const [cameraCapabilities, setCameraCapabilities] = useState<MediaTrackCapabilities | null>(null);

  const onScanSuccess: QrcodeSuccessCallback = useCallback((decodedText) => {
    const now = Date.now();
    const lastScan = lastScanRef.current;
    const DEBOUNCE_MS = 2000;

    // Suppress the same code within the debounce window entirely (no toast, no action)
    if (lastScan && lastScan.text === decodedText && (now - lastScan.time) < DEBOUNCE_MS) {
        return;
    }

    // Always update lastScan immediately so rapid re-reads are suppressed
    lastScanRef.current = { text: decodedText, time: now };

    const state = useAppStore.getState();
    const isAlreadyInCart = state.cart.some(item => item.sku === decodedText.trim());

    if (isAlreadyInCart) {
        toast({
            title: "Already in Cart",
            description: `${decodedText.trim()} is already added.`,
            variant: "default"
        });
    } else {
        const product = state.products.find(p => p.sku === decodedText.trim());
        if (product) {
          state.addToCart(product.sku);
          toast({ title: "Item Added", description: `${product.name} added to cart.` });
          playBeep();
          setScanSuccess(true);
          setTimeout(() => setScanSuccess(false), 300);
        } else {
          toast({ title: "Product Not Found", description: `No product found with SKU: ${decodedText.trim()}`, variant: "destructive" });
        }
    }
  }, [toast]);


  useEffect(() => {
    if (typeof window === 'undefined') {
        return;
    }

    if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(qrReaderElementId, {
            verbose: false,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
    }
    const qrCode = html5QrCodeRef.current;

    const startScanner = async () => {
        if (operationLock.current || qrCode.isScanning) return;
        operationLock.current = true;
        
        setScannerState('starting');
        setErrorMessage(null);

        try {
            await qrCode.start(
                { facingMode: "environment" },
                {
                    fps: 30,
                    qrbox: (viewfinderWidth, viewfinderHeight) => ({
                        width: Math.min(Math.floor(viewfinderWidth * 0.85), 400),
                        height: Math.min(Math.floor(viewfinderHeight * 0.85), 400),
                    }),
                    aspectRatio: 1.0,
                },
                onScanSuccess,
                () => { /* ignore per-frame errors */ }
            );
            
            setScannerState('scanning');
            // Read capabilities directly from the running track — more reliable on iOS
            // than html5-qrcode's wrapper methods.
            try {
                // @ts-ignore
                const track = html5QrCodeRef.current?.getRunningTrack?.() as MediaStreamTrack | undefined;
                const caps = track?.getCapabilities?.() as any;
                if (caps) {
                    setCameraCapabilities(caps);
                    if (caps.zoom) {
                        setHwZoom({
                            min: caps.zoom.min,
                            max: caps.zoom.max,
                            step: caps.zoom.step || 0.1,
                        });
                    }
                }
            } catch (_) {
                // capabilities not supported on this device
            }

        } catch (err: any) {
            setErrorMessage(err.message || "Failed to start scanner.");
            setScannerState('error');
        } finally {
            operationLock.current = false;
        }
    };

    const stopScanner = async () => {
        if (operationLock.current || !qrCode.isScanning) return;
        operationLock.current = true;
        
        try {
            await qrCode.stop();
        } catch (err) {
            if (!String(err).includes("not been started")) {
               console.warn("Scanner stop error:", err);
            }
        } finally {
            setScannerState('stopped');
            setCameraCapabilities(null);
            setHwZoom(null);
            setZoom(1);
            operationLock.current = false;
        }
    };

    if (isActive) {
        startScanner();
    } else {
        stopScanner();
    }

    return () => {
        if (qrCode && qrCode.isScanning) {
            stopScanner();
        }
    };
  }, [isActive, onScanSuccess]);


 useEffect(() => {
    const applyZoom = async () => {
        if (!html5QrCodeRef.current?.isScanning) return;
        // Try hardware zoom directly from the running track — works on iOS 15.4+ and Android Chrome
        try {
            // @ts-ignore
            const track = html5QrCodeRef.current?.getRunningTrack?.() as MediaStreamTrack | undefined;
            if (track) {
                const caps = track.getCapabilities?.() as any;
                if (caps?.zoom) {
                    const clampedZoom = Math.min(Math.max(zoom, caps.zoom.min), caps.zoom.max);
                    await track.applyConstraints({ advanced: [{ zoom: clampedZoom } as any] });
                }
            }
        } catch(e) {
            // hardware zoom not supported — CSS digital zoom handles it below
        }
        // CSS digital zoom — always applied as primary/fallback.
        // Note: overflow:hidden does NOT clip <video> on iOS Safari;
        // clip-path:inset() on the container is used instead.
        const videoEl = document.querySelector(`#${qrReaderElementId} video`) as HTMLVideoElement | null;
        if (videoEl) {
            videoEl.style.transform = `scale(${zoom})`;
            videoEl.style.transformOrigin = 'center center';
            videoEl.style.transition = 'transform 0.1s ease';
        }
    };

    if (scannerState === 'scanning') {
        applyZoom();
    }
  }, [zoom, scannerState]);

  return (
    <div className="space-y-4">
      <div
          id={qrReaderElementId}
          className={cn(
            // clip-path clips <video> on iOS Safari where overflow-hidden does not
            "w-full border-4 border-transparent rounded-md bg-muted overflow-hidden [clip-path:inset(0_round_0.375rem)] mx-auto max-w-lg relative transition-all duration-300 min-h-[250px]",
            " [&>span]:hidden [&>video]:w-full [&>video]:h-full [&>video]:object-cover",
            scanSuccess && "border-green-500 shadow-lg shadow-green-500/50"
          )}
        >
          {scannerState === 'scanning' && <Viewfinder />}
      </div>
      
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
            {errorMessage || 'Could not access the camera. Please ensure permissions are enabled.'}
          </AlertDescription>
        </Alert>
      )}

      {scannerState === 'scanning' && (
        <div className="p-4 border rounded-md space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="zoom-slider" className="flex items-center gap-1">
              <ZoomIn className="h-4 w-4" /> Zoom
            </Label>
            <span className="text-sm font-mono text-muted-foreground">{zoom.toFixed(1)}×</span>
          </div>
          <div className="flex items-center gap-3">
            <ZoomOut className="h-5 w-5 flex-shrink-0" />
            <Slider
              id="zoom-slider"
              min={1}
              max={5}
              step={0.1}
              value={[zoom]}
              onValueChange={(value) => setZoom(value[0])}
              className="flex-1"
            />
            <ZoomIn className="h-5 w-5 flex-shrink-0" />
          </div>
        </div>
      )}

    </div>
  );
}

    