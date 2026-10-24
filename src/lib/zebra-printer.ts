
"use client";

// This script is adapted from Zebra's official Browser Print documentation.
// It sets up a global object to interact with the Zebra Browser Print application.

// --- Types for Zebra Browser Print ---
interface ZebraBrowserPrint {
    getAvailableDevices: (
        callback: (devices: ZebraDevice[]) => void,
        errorCallback: (error: string) => void,
        deviceType?: string
    ) => void;
    getDefaultDevice: (
        deviceType: string,
        callback: (device: ZebraDevice) => void,
        errorCallback: (error: string) => void
    ) => void;
    readFromDevice: (
        callback: (response: string) => void,
        errorCallback: (error: string) => void
    ) => void;
    send: (
        zpl: string,
        callback: (success: boolean, message: string) => void,
        errorCallback: (error: string) => void
    ) => void;
    setPrinter: (device: ZebraDevice) => void;
    device: ZebraDevice | null;
}

interface ZebraDevice {
    name: string;
    deviceType: 'printer' | 'scanner' | 'other';
    uid: string;
    version: string;
    provider: string;
    manufacturer: string;
}

import { renderZpl } from '@/lib/zebra-zpl';
import type { StoredLabelLayout } from '@/lib/label-layout';
import type { LabelValues } from '@/lib/label-live';

// --- ZPL Generation ---

export interface LabelField {
    id: string;
    type: 'text' | 'qr';
    x: number;
    y: number;
    rotation?: 0 | 90 | 180 | 270;
    data: string; // The content or placeholder (e.g., "SKU: {sku}" or "{qr_content}")
    
    // Text-specific properties
    fontFamily?: string; // e.g., '0', 'A', 'D' - defaults to '0'
    fontSize?: number;
    width?: number; // Width of the text block (for wrapping/alignment)
    textAlign?: 'L' | 'C' | 'R' | 'J'; // Text alignment
    
    // QR-specific properties
    qrMagnification?: number; // e.g., 2, 3, 4
}

export interface LabelLayout {
    id: string;
    name: string;
    widthDots: number; // Page width in dots
    heightDots: number; // Page height in dots
    fields: LabelField[];
}

/**
 * Generates ZPL code from a structured layout and product data: one label, one copy. The renderer is
 * lib/zebra-zpl.ts (the same one the iPhone's ERPCore has); `productData`'s keys fill `{placeholders}`.
 * @param layout The LabelLayout object defining the tag.
 * @param productData The product data to fill in placeholders.
 */
export function generateZplFromLayout(layout: LabelLayout, productData: Record<string, any>): string {
    const piece: Record<string, string> = {};
    for (const [k, v] of Object.entries(productData)) if (v !== undefined && v !== null) piece[k] = String(v);
    const stored: StoredLabelLayout = {
        id: layout.id,
        name: layout.name,
        widthDots: layout.widthDots,
        heightDots: layout.heightDots,
        fields: layout.fields.map((f) => ({
            id: f.id, type: f.type, x: f.x, y: f.y, rotation: f.rotation, data: f.data,
            fontFamily: f.fontFamily, fontSize: f.fontSize, width: f.width,
            // Justified text (the old 'J') was never drawn any differently from left.
            align: f.textAlign === 'C' || f.textAlign === 'R' ? f.textAlign : undefined,
            qrMagnification: f.qrMagnification,
        })),
    };
    return renderZpl(stored, [piece as LabelValues]);
}

// Generates a simple ZPL for a single product to verify connectivity or quick print
export function generateDumbbellTagZpl(sku: string): string {
    const layout: LabelLayout = {
        id: 'simple-tag',
        name: 'Simple Tag',
        widthDots: 664, // 83mm
        heightDots: 296, // 37mm
        fields: [
            { id: 'sku', type: 'text', x: 50, y: 150, data: sku, fontSize: 30, rotation: 90 },
            { id: 'qr', type: 'qr', x: 300, y: 50, data: sku, qrMagnification: 4 }
        ]
    };
    return generateZplFromLayout(layout, { sku });
}


// --- Communication with Zebra Browser Print Application ---

let zebraBrowserPrint: ZebraBrowserPrint | null = null;
let selected_device: ZebraDevice | null = null;

export function checkZebraBrowserPrint(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
        return reject("Zebra Browser Print is only available in the browser.");
    }
    
    // Check if the Browser Print application is running
    fetch('http://127.0.0.1:9100/available')
        .then(response => {
            if (!response.ok) {
                throw new Error("Zebra Browser Print application not found or not running.");
            }
            return response.text();
        })
        .then(() => {
            // @ts-ignore - Zebra is attached to the window object by their script
            zebraBrowserPrint = window.Zebra;
            if (!zebraBrowserPrint) {
                throw new Error("Zebra Browser Print script may not be loaded.");
            }
            
            // Get the default device
            zebraBrowserPrint.getDefaultDevice("printer",
                (device) => {
                    selected_device = device;
                    resolve();
                },
                (error) => {
                    console.error("Error getting default printer:", error);
                    reject(`No default printer found. Please configure one in the Zebra Browser Print app. Details: ${error}`);
                }
            );
        })
        .catch(error => {
            console.error("Zebra Browser Print setup error:", error);
            reject("Could not connect to the Zebra Browser Print application. Please ensure it is installed and running on this computer.");
        });
  });
}


/**
 * Sends a ZPL command string to the configured default Zebra printer.
 * @param zpl The ZPL command string to print.
 */
export async function sendZplToPrinter(zpl: string): Promise<void> {
    if (!selected_device) {
        try {
            await checkZebraBrowserPrint();
        } catch (error) {
            throw error; // Propagate the setup error
        }
    }
    
    if (!zebraBrowserPrint || !selected_device) {
        throw new Error("Zebra printer is not properly configured or connected.");
    }

    return new Promise((resolve, reject) => {
        zebraBrowserPrint!.send(zpl, 
            (success, message) => {
                if (success) {
                    console.log("Print command sent successfully:", message);
                    resolve();
                } else {
                    console.error("Print command failed:", message);
                    reject(`Failed to send print job. Message: ${message}`);
                }
            },
            (error) => {
                 console.error("Error sending ZPL to printer:", error);
                 reject(`Error sending print job. Details: ${error}`);
            }
        );
    });
}
