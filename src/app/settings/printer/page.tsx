
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore, Product, PrintHistoryEntry } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, Printer, XCircle, CheckCircle, History, List, Repeat, QrCode } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateDumbbellTagZpl, sendZplToPrinter, checkZebraBrowserPrint } from '@/lib/zebra-printer';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription
} from '@/components/ui/dialog';
import QRCode from 'qrcode.react';

const ProductSearchDialog: React.FC<{ onSelect: (product: Product) => void }> = ({ onSelect }) => {
  const products = useAppStore(state => state.products);
  const [searchTerm, setSearchTerm] = useState('');
  const [open, setOpen] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    return products.filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 50);
  }, [products, searchTerm]);

  const handleSelect = (product: Product) => {
    onSelect(product);
    setOpen(false);
    setSearchTerm('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-left">
          <Search className="mr-2 h-4 w-4" />
          {searchTerm || "Search for a product..."}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select a Product</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>
          <ScrollArea className="h-[40vh] border rounded-md">
            {filteredProducts.length > 0 ? (
              <div className="p-2">
                {filteredProducts.map(product => (
                  <button
                    key={product.sku}
                    onClick={() => handleSelect(product)}
                    className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3"
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.sku}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {searchTerm ? 'No products found.' : 'Start typing to search...'}
              </p>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};


const DumbbellTagPreview: React.FC<{ sku: string }> = ({ sku }) => {
    return (
        <div className="bg-gray-100 p-4 rounded-lg flex items-center justify-center w-[300px] h-[100px] mx-auto my-4 font-sans border-2 border-dashed border-gray-300">
            <div className="flex items-center justify-between w-full h-full">
                {/* Left Side */}
                <div className="flex flex-col items-center justify-center h-full px-2">
                    <p className="text-[10px] font-bold text-black tracking-tighter">{sku}</p>
                    <div className="mt-1">
                        <QRCode value={sku} size={40} level="H" renderAs="svg" />
                    </div>
                </div>

                {/* Center (thin part) */}
                <div className="w-1/4 h-1/4 bg-gray-100"></div>

                {/* Right Side */}
                <div className="flex flex-col items-center justify-center h-full px-2">
                    <p className="text-[10px] font-bold text-black tracking-tighter">{sku}</p>
                     <div className="mt-1">
                        <QRCode value={sku} size={40} level="H" renderAs="svg" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function PrinterPage() {
  const appReady = useAppReady();
  const { loadProducts, addPrintHistory, printHistory } = useAppStore();
  const { toast } = useToast();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);

  useEffect(() => {
    if (appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);

  const checkPrinterStatus = async () => {
    setIsCheckingStatus(true);
    try {
        await checkZebraBrowserPrint();
        setPrinterStatus('connected');
    } catch (error) {
        setPrinterStatus('disconnected');
    } finally {
        setIsCheckingStatus(false);
    }
  };

  useEffect(() => {
    checkPrinterStatus();
  }, []);

  const handlePrint = async (sku: string) => {
    setIsPrinting(true);
    try {
      const zpl = generateDumbbellTagZpl(sku);
      await sendZplToPrinter(zpl);
      toast({
        title: "Print Job Sent",
        description: `Label for ${sku} sent to the Zebra printer.`,
      });
      addPrintHistory(sku);
    } catch (error: any) {
      toast({
        title: "Printer Error",
        description: error.message || "Could not communicate with the Zebra printer.",
        variant: "destructive",
      });
       setPrinterStatus('disconnected');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="container mx-auto py-4 sm:py-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-primary flex items-center"><Printer className="mr-3 h-8 w-8"/>Zebra Printer Hub</h1>
        <p className="text-muted-foreground">Build, preview, and print your jewelry tags.</p>
      </header>

      <Card>
        <CardHeader>
            <CardTitle>Printer Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-center gap-4">
             {isCheckingStatus ? (
                <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Checking connection...</div>
            ) : printerStatus === 'connected' ? (
                <div className="flex items-center text-green-600"><CheckCircle className="mr-2 h-4 w-4"/>Connected to Zebra Browser Print</div>
            ) : (
                <div className="flex items-center text-destructive"><XCircle className="mr-2 h-4 w-4"/>Disconnected. Please ensure Zebra Browser Print is running.</div>
            )}
            <Button variant="outline" size="sm" onClick={checkPrinterStatus} disabled={isCheckingStatus}>
                <Repeat className="mr-2 h-4 w-4"/>Re-check Status
            </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Tag Builder</CardTitle>
            <CardDescription>Select a product to preview and print its tag.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProductSearchDialog onSelect={setSelectedProduct} />
            
            {selectedProduct ? (
                <div className="pt-4 space-y-4 text-center">
                    <p className="font-semibold">{selectedProduct.name}</p>
                    <p className="text-sm text-muted-foreground font-mono">{selectedProduct.sku}</p>
                    <DumbbellTagPreview sku={selectedProduct.sku} />
                </div>
            ) : (
                <div className="text-center text-muted-foreground py-10">
                    <QrCode className="mx-auto h-12 w-12 mb-4" />
                    <p>Select a product to build its tag.</p>
                </div>
            )}

          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              onClick={() => selectedProduct && handlePrint(selectedProduct.sku)}
              disabled={!selectedProduct || isPrinting || printerStatus !== 'connected'}
            >
              {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Printer className="mr-2 h-4 w-4"/>}
              Print Tag
            </Button>
          </CardFooter>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Print History</CardTitle>
                <CardDescription>A log of the most recently printed tags.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[50vh]">
                    {printHistory.length > 0 ? (
                        <div className="space-y-2">
                            {printHistory.map(entry => (
                                <div key={entry.timestamp} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                                    <div>
                                        <p className="font-semibold font-mono">{entry.sku}</p>
                                        <p className="text-xs text-muted-foreground">{format(new Date(entry.timestamp), 'PPpp')}</p>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={() => handlePrint(entry.sku)} disabled={isPrinting || printerStatus !== 'connected'}>
                                        <Repeat className="mr-2 h-3 w-3"/> Reprint
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-muted-foreground py-10">
                            <History className="mx-auto h-12 w-12 mb-4" />
                            <p>No print history yet.</p>
                        </div>
                    )}
                </ScrollArea>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
