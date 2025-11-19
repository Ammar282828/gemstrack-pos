
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

/**
 * Generates the ZPL code for a standard dumbbell jewelry tag.
 * @param sku The product SKU to encode in the QR code and text.
 */
export function generateDumbbellTagZpl(sku: string): string {
    // This ZPL is a basic template. You may need to adjust the coordinates
    // (^FOx,y) and font sizes (^A0N,height,width) to match your specific
    // label size and layout precisely.
    // This template assumes a small dumbbell label (e.g., ~2.25" x 0.5").
    // The coordinates are in dots (assuming a 203 dpi printer).

    const zpl = `
^XA
~TA000
~JSN
^LT0
^MNW
^MTD
^PON
^PMN
^LH0,0
^JMA
^PR6,6
~SD20
^JUS
^LRN
^CI27
^PA0,1,1,0
^XZ
^XA
^MMT
^PW406
^LL203
^LS0
^FO48,40^A0N,20,20^FD${sku}^FS
^FO48,70^BQN,2,3^FDQA,${sku}^FS
^PQ1,0,1,Y
^XZ
`;
    return zpl;
}


// --- Communication with Zebra Browser Print Application ---

let zebraBrowserPrint: ZebraBrowserPrint | null = null;
let selected_device: ZebraDevice | null = null;

function setupZebraBrowserPrint(): Promise<void> {
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
            await setupZebraBrowserPrint();
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
