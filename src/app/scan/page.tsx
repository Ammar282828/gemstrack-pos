"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { QrCode, Search, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsStoreHydrated } from '@/lib/store';

export default function ScanPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [skuInput, setSkuInput] = useState('');
  const products = useAppStore(state => state.products);
  const isHydrated = useIsStoreHydrated();


  const handleScan = () => {
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
          <CardTitle className="text-2xl">Scan Product QR/Barcode</CardTitle>
          <CardDescription>Enter the SKU manually to look up a product. (Actual camera scanning TBD)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="sku-input" className="text-sm font-medium">Enter SKU</Label>
            <div className="flex items-center space-x-2 mt-1">
                <Input
                id="sku-input"
                type="text"
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                placeholder="e.g., RING-001"
                className="text-lg"
                onKeyPress={(e) => { if (e.key === 'Enter') handleScan(); }}
                />
                 {skuInput && (
                    <Button variant="ghost" size="icon" onClick={() => setSkuInput('')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </Button>
                )}
            </div>
          </div>
          <Button size="lg" className="w-full" onClick={handleScan}>
            <Search className="mr-2 h-5 w-5" /> Find Product
          </Button>
        </CardContent>
      </Card>
      
      <div className="mt-8 text-center text-sm text-muted-foreground max-w-md">
        <p><strong>Note:</strong> This page simulates QR/Barcode scanning by manual SKU input. For actual scanning capabilities, integration with device camera and QR decoding libraries would be required, which is a more advanced PWA feature.</p>
      </div>
    </div>
  );
}
