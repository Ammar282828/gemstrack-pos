
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
 * Generates ZPL code from a structured layout and product data.
 * @param layout The LabelLayout object defining the tag.
 * @param productData The product data to fill in placeholders.
 */
export function generateZplFromLayout(layout: LabelLayout, productData: Record<string, any>): string {
    const replacePlaceholders = (template: string): string => {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return productData[key] !== undefined ? String(productData[key]) : match;
        });
    };

    const getOrientationChar = (rotation: number | undefined): string => {
        switch (rotation) {
            case 90: return 'R';
            case 180: return 'I';
            case 270: return 'B';
            default: return 'N';
        }
    };

    let zplFields = '';
    for (const field of layout.fields) {
        const resolvedData = replacePlaceholders(field.data);
        const orientation = getOrientationChar(field.rotation);

        if (field.type === 'text') {
            const fontFamily = field.fontFamily || '0';
            const fontSize = field.fontSize || 20;
            const alignment = field.textAlign || 'L';
            
            // If width is provided, use ^FB (Field Block) for alignment and wrapping
            // ^FBwidth,max_lines,hanging_indent,justification
            const fieldBlock = field.width ? `^FB${field.width},1,0,${alignment}` : '';
            
            // ^Afo,h,w -> f=font, o=orientation
            zplFields += `^FO${field.x},${field.y}^A${fontFamily}${orientation},${fontSize},${fontSize}${fieldBlock}^FD${resolvedData}^FS\n`;
        } else if (field.type === 'qr') {
            const magnification = field.qrMagnification || 2;
            // Using BQ command for QR code: ^BQo,2,m -> o=orientation
            zplFields += `^FO${field.x},${field.y}^BQ${orientation},2,${magnification}^FDQA,${resolvedData}^FS\n`;
        }
    }

    // ^MMT: Tear off mode (usually default, but good to ensure)
    // ^PW: Print width
    // ^LL: Label length
    // ^LS: Label shift (optional)
    // ^CI28: UTF-8 encoding support (essential for special chars)
    const zpl = `
^XA
^CI28
^PW${layout.widthDots}
^LL${layout.heightDots}
^LS0
${zplFields}
^PQ1,0,1,Y
^XZ
`;
    return zpl;
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
