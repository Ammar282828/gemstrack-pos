
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppStore, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, Save, ExternalLink, Info, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

export default function WeprintApiPage() {
  const appReady = useAppReady();
  const { products, settings, loadProducts, updateSettings, isProductsLoading } = useAppStore();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);

  useEffect(() => {
    if (settings.weprintApiSkus) {
      setSelectedSkus(new Set(settings.weprintApiSkus));
    }
  }, [settings.weprintApiSkus]);

  const filteredProducts = useMemo(() => {
    return products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const handleToggleSelect = useCallback((sku: string, checked: boolean) => {
    setSelectedSkus(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(sku);
      } else {
        newSet.delete(sku);
      }
      return newSet;
    });
  }, []);

  const handleSelectAllFiltered = () => {
    const filteredSkus = new Set(filteredProducts.map(p => p.sku));
    setSelectedSkus(prev => new Set([...prev, ...filteredSkus]));
  };

  const handleDeselectAllFiltered = () => {
     const filteredSkus = new Set(filteredProducts.map(p => p.sku));
     setSelectedSkus(prev => {
        const newSet = new Set(prev);
        filteredSkus.forEach(sku => newSet.delete(sku));
        return newSet;
     });
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      await updateSettings({ weprintApiSkus: Array.from(selectedSkus) });
      toast({
        title: "API Product List Updated",
        description: `There are now ${selectedSkus.size} products available to the WEPrint API.`,
      });
    } catch (error) {
      toast({
        title: "Error Saving",
        description: "Could not update the API product list.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  const apiEndpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/products/weprint` : '/api/products/weprint';

  if (!appReady || isProductsLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Products...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">WEPrint API Management</CardTitle>
          <CardDescription>
            Select which products should be accessible via the WEPrint API endpoint. Only selected products will be included in the API response.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>API Endpoint</AlertTitle>
                <AlertDescription className="flex items-center gap-2">
                    Your curated product list is available at: 
                    <Link href={apiEndpoint} target="_blank" className="font-mono text-primary hover:underline flex items-center gap-1">
                        {apiEndpoint} <ExternalLink className="h-3 w-3"/>
                    </Link>
                </AlertDescription>
            </Alert>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSelectAllFiltered} variant="outline" size="sm" disabled={filteredProducts.length === 0}>
              Select All Filtered ({filteredProducts.length})
            </Button>
            <Button onClick={handleDeselectAllFiltered} variant="outline" size="sm" disabled={filteredProducts.length === 0}>
              Deselect All Filtered
            </Button>
          </div>
          <ScrollArea className="h-96 border rounded-md p-2">
            {filteredProducts.length > 0 ? (
              <div className="space-y-2">
                {filteredProducts.map(product => (
                  <div
                    key={product.sku}
                    className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted"
                  >
                    <Checkbox
                      id={`select-${product.sku}`}
                      checked={selectedSkus.has(product.sku)}
                      onCheckedChange={(checked) => handleToggleSelect(product.sku, !!checked)}
                      aria-label={`Select ${product.name}`}
                    />
                    <label
                      htmlFor={`select-${product.sku}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-grow"
                    >
                      {product.name}
                      <span className="ml-2 text-xs text-muted-foreground font-mono">({product.sku})</span>
                    </label>
                     {settings.weprintApiSkus?.includes(product.sku) ? (
                        <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3"/> Published</span>
                     ) : (
                        <span className="text-xs text-amber-600 flex items-center gap-1"><X className="h-3 w-3"/> Not Published</span>
                     )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-10">No products found matching your search.</p>
            )}
          </ScrollArea>
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            <span className="font-bold">{selectedSkus.size}</span> products selected for API.
          </p>
          <Button onClick={handleSaveChanges} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Update API Products
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
