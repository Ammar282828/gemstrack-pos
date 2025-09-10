
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Html5Qrcode,
  QrcodeSuccessCallback,
  QrcodeErrorCallback,
} from 'html5-qrcode';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ScanLine, VideoOff, ZoomIn, ZoomOut } from 'lucide-react';
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

export default function QrScanner() {
  const { toast } = useToast();
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cameraCapabilities, setCameraCapabilities] = useState<any>(null);

  const onScanSuccess: QrcodeSuccessCallback = useCallback((decodedText) => {
    const state = useAppStore.getState();
    const isAlreadyInCart = state.cart.some(item => item.sku === decodedText.trim());

    if (isAlreadyInCart) {
      return; 
    }
    
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
  }, [toast]);

  const onScanFailure: QrcodeErrorCallback = () => {
    // Intentionally empty
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(qrReaderElementId, false);
    }
    const qrCode = html5QrCodeRef.current;

    const startScanner = async () => {
      try {
        if (qrCode && !qrCode.isScanning) {
            await qrCode.start(
              { facingMode: "environment" },
              { fps: 15, qrbox: { width: 250, height: 250 } },
              onScanSuccess,
              onScanFailure
            );
            setIsScanning(true);
            setHasCameraPermission(true);

            const cameras = await Html5Qrcode.getCameras();
            if (cameras && cameras.length) {
                const backCamera = cameras.find(c => c.label.toLowerCase().includes('back')) || cameras[0];
                const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: backCamera.id } } });
                const track = stream.getVideoTracks()[0];
                const capabilities = track.getCapabilities();
                if ('zoom' in capabilities) {
                  setCameraCapabilities(capabilities);
                  setZoom((capabilities as any).zoom.min);
                }
                track.stop();
            }
        }
      } catch (err) {
        setHasCameraPermission(false);
        setIsScanning(false);
        console.error("Failed to start QR scanner:", err);
      }
    };

    const stopScanner = async () => {
      if (qrCode && qrCode.isScanning) {
        try {
          await qrCode.stop();
          setIsScanning(false);
        } catch (err) {
          console.error("Error stopping scanner:", err);
        }
      }
    };
    
    if (isScannerActive) {
      startScanner();
    } else {
      stopScanner();
    }

    return () => {
      stopScanner();
    };
  }, [isScannerActive, onScanSuccess]);

 useEffect(() => {
    if (!isScanning || !cameraCapabilities || !html5QrCodeRef.current) return;
    
    const applyZoom = async () => {
        try {
            const capabilities = html5QrCodeRef.current.getRunningTrackCapabilities?.();
            const currentTrack = html5QrCodeRef.current.getRunningTrack?.();

            if (currentTrack && (capabilities as any)?.zoom) {
                await currentTrack.applyConstraints({
                    advanced: [{ zoom: zoom } as any]
                });
            }
        } catch(e) {
            console.warn("Could not apply zoom", e);
        }
    };
    applyZoom();
  }, [zoom, isScanning, cameraCapabilities]);

  const toggleScanner = () => {
    setIsScannerActive(prev => !prev);
  };

  return (
    <div className="space-y-4">
      {isScannerActive && (
        <div
          id={qrReaderElementId}
          className={cn(
            "w-full border-4 border-transparent rounded-md bg-muted overflow-hidden mx-auto max-w-lg relative transition-all duration-300",
            "&>span]:hidden [&>video]:w-full [&>video]:h-full [&>video]:object-cover",
            scanSuccess && "border-green-500 shadow-lg shadow-green-500/50"
          )}
        ></div>
      )}
      
      {isScannerActive && hasCameraPermission === null && !isScanning && (
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

      {isScannerActive && isScanning && cameraCapabilities && (
        <div className="p-4 border rounded-md">
          <Label htmlFor="zoom-slider">Zoom</Label>
          <div className="flex items-center gap-2">
            <ZoomOut className="h-5 w-5" />
            <Slider
              id="zoom-slider"
              min={cameraCapabilities.zoom.min}
              max={cameraCapabilities.zoom.max}
              step={cameraCapabilities.zoom.step}
              value={[zoom]}
              onValueChange={(value) => setZoom(value[0])}
            />
            <ZoomIn className="h-5 w-5" />
          </div>
        </div>
      )}

      <div className="text-center">
        <Button size="lg" onClick={toggleScanner} variant={isScannerActive ? "outline" : "default"} className="w-full md:w-auto">
          {isScannerActive ? <VideoOff className="mr-2 h-5 w-5" /> : <ScanLine className="mr-2 h-5 w-5" />}
          {isScannerActive ? "Stop Scanner" : "Start Scanner"}
        </Button>
      </div>
    </div>
  );
}
