
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, FileSpreadsheet, History, Download, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateProductCsv } from '@/lib/csv';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRouter } from 'next/navigation';

const ProductSearch: React.FC<{ onSelect: (product: Product) => void, selectedProduct: Product | null }> = ({ onSelect, selectedProduct }) => {
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-left">
          <Search className="mr-2 h-4 w-4" />
          {selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : "Search for a product..."}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <div className="p-2">
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
        </div>
        <ScrollArea className="h-64">
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
      </PopoverContent>
    </Popover>
  );
};

function PrinterPageComponent() {
  const appReady = useAppReady();
  const { loadProducts, products, settings, addPrintHistory, printHistory } = useAppStore();
  const { toast } = useToast();
  const router = useRouter();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    if (appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);


  const handleDownloadCsv = (product: Product | null) => {
    if (!product) {
        toast({ title: "No Product Selected", description: "Please select a product to export.", variant: "destructive" });
        return;
    }
    
    // Generate CSV for single product
    generateProductCsv([product], settings);
    addPrintHistory(product.sku);
    toast({ title: "CSV Exported", description: `Product details for ${product.sku} exported.` });
  };
  
  const handleExportAll = () => {
      if (products.length === 0) {
          toast({ title: "No Products", description: "There are no products to export.", variant: "destructive" });
          return;
      }
      generateProductCsv(products, settings);
      toast({ title: "Export Complete", description: `Exported details for ${products.length} products.` });
  };

  if (!appReady) {
    return (
        <div className="flex h-screen w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    );
  }

  return (
    <div className="container mx-auto py-4 sm:py-8 space-y-8">
      <header>
         <Button variant="outline" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
        <h1 className="text-3xl font-bold text-primary flex items-center"><FileSpreadsheet className="mr-3 h-8 w-8"/>Label Data Export</h1>
        <p className="text-muted-foreground">Export product data to CSV/Excel for external label design.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
            <Card>
                <CardHeader>
                    <CardTitle>Single Product Export</CardTitle>
                    <CardDescription>Select a product to download its details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <ProductSearch onSelect={setSelectedProduct} selectedProduct={selectedProduct}/>
                     <Button 
                        className="w-full" 
                        onClick={() => handleDownloadCsv(selectedProduct)}
                        disabled={!selectedProduct}
                    >
                        <Download className="mr-2 h-4 w-4"/>
                        Download CSV for Selected
                    </Button>
                </CardContent>
            </Card>
            
            <Card className="mt-8">
                <CardHeader>
                    <CardTitle>Bulk Export</CardTitle>
                    <CardDescription>Download data for all products in your inventory.</CardDescription>
                </CardHeader>
                <CardContent>
                     <Button 
                        variant="secondary"
                        className="w-full" 
                        onClick={handleExportAll}
                        disabled={products.length === 0}
                    >
                        <Download className="mr-2 h-4 w-4"/>
                        Export All Products
                    </Button>
                </CardContent>
            </Card>
        </div>

        <div>
            <Card>
                <CardHeader>
                    <CardTitle>Recent Exports</CardTitle>
                    <CardDescription>History of recently exported items.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[400px]">
                        {printHistory.length > 0 ? (
                            <div className="space-y-2">
                                {printHistory.map(entry => (
                                    <div key={entry.timestamp} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                                        <div>
                                            <p className="font-semibold font-mono">{entry.sku}</p>
                                            <p className="text-xs text-muted-foreground">{format(new Date(entry.timestamp), 'PPpp')}</p>
                                        </div>
                                         <Button variant="ghost" size="sm" onClick={() => handleDownloadCsv(products.find(p => p.sku === entry.sku) || null)}>
                                            <Download className="h-4 w-4"/>
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center text-muted-foreground py-10">
                                <History className="mx-auto h-12 w-12 mb-4" />
                                <p>No export history yet.</p>
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}

export default function PrinterPage() {
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);

    if (!isMounted) return null;

    return <PrinterPageComponent />;
}
