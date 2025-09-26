
"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { QrCode, ShoppingCart, Trash2, ExternalLink, ListPlus, Loader2, X, VideoOff, ScanLine, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ProductForm } from '@/components/product/product-form';

const QrScanner = dynamic(() => import('@/components/scanner/qr-scanner'), {
  ssr: false,
  loading: () => (
    <div className="text-center py-10 text-muted-foreground">
      <Loader2 className="w-10 h-10 mb-2 mx-auto animate-spin" />
      <p className="text-sm">Loading Scanner...</p>
    </div>
  ),
});


const ScannedItemDisplay: React.FC<{ item: NonNullable<ReturnType<typeof selectCartDetails>[0]>, removeFromCart: (sku: string) => void }> = ({ item, removeFromCart }) => {
  return (
    <div className="flex justify-between items-center py-2">
      <div>
        <p className="font-medium text-sm leading-tight">{item.name}</p>
        <p className="text-xs text-muted-foreground">Qty: {item.quantity} &bull; Unit: PKR {item.totalPrice.toLocaleString()}</p>
      </div>
      <div className="flex items-center space-x-2">
        <p className="font-semibold text-sm text-primary">PKR {item.lineItemTotal.toLocaleString()}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10"
          onClick={() => removeFromCart(item.sku)}
          aria-label={`Remove ${item.name} from cart`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};


export default function ScanPOSPage() {
  const { toast } = useToast();
  const [skuInput, setSkuInput] = useState('');
  const appReady = useAppReady();
  const [isScannerActive, setIsScannerActive] = useState(true); // Default to active
  const [isNewProductDialogOpen, setIsNewProductDialogOpen] = useState(false);

  const { addToCart, removeFromCart: removeFromCartAction, products, loadProducts } = useAppStore(state => ({
      addToCart: state.addToCart,
      removeFromCart: state.removeFromCart,
      products: state.products,
      loadProducts: state.loadProducts,
  }));
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);

  useEffect(() => {
    if(appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);


  const handleManualSkuAdd = () => {
    if (!skuInput.trim()) {
      toast({ title: "Input SKU", description: "Please enter a SKU to add.", variant: "destructive" });
      return;
    }
    const product = products.find(p => p.sku === skuInput.trim());

    if (product) {
      addToCart(product.sku);
      toast({ title: "Item Added", description: `${product.name} added to cart.` });
      setSkuInput('');
    } else {
      toast({ title: "Product Not Found", description: `No product found with SKU: ${skuInput.trim()}`, variant: "destructive" });
    }
  };

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading POS Scanner...</p>
      </div>
    );
  }

  const handleNewProductCreated = (newProduct: Product) => {
    setIsNewProductDialogOpen(false);
    addToCart(newProduct.sku);
    toast({ title: "Added to Cart", description: `${newProduct.name} was created and added to your cart.`});
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Dialog open={isNewProductDialogOpen} onOpenChange={setIsNewProductDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Create New Product</DialogTitle>
            <DialogDescription>Add a new item to your inventory. It will be added to the current cart automatically upon creation.</DialogDescription>
          </DialogHeader>
          <ProductForm onProductCreated={handleNewProductCreated} />
        </DialogContent>
      </Dialog>
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

        {/* --- Right Column (Cart Summary) - MOVED TO TOP ON MOBILE --- */}
        <div className="lg:col-span-1 lg:sticky lg:top-8 order-1 lg:order-2">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl flex items-center">
                <ShoppingCart className="w-5 h-5 mr-2 text-primary" />
                Current Sale
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cartItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Scan or add products to start a sale.</p>
              ) : (
                <ScrollArea className="h-[300px] pr-3 mb-4">
                  <div className="space-y-1">
                    {cartItems.map(item => item && (
                      <ScannedItemDisplay key={item.sku} item={item} removeFromCart={removeFromCartAction} />
                    ))}
                  </div>
                </ScrollArea>
              )}
              {cartItems.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="flex justify-between items-center font-semibold text-lg">
                    <span>Subtotal:</span>
                    <span className="text-primary">PKR {cartSubtotal.toLocaleString()}</span>
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter>
              <Button asChild size="lg" className="w-full" disabled={cartItems.length === 0}>
                <Link href="/cart">
                  View Cart & Checkout <ExternalLink className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* --- Left Column (Scanner & Manual Input) --- */}
        <div className="lg:col-span-2 space-y-6 order-2 lg:order-1">
          <Card>
            <CardHeader className="text-center">
              <QrCode className="w-12 h-12 mx-auto text-primary mb-3" />
              <CardTitle className="text-2xl">Point of Sale - Scan Items</CardTitle>
              <CardDescription>Scan product QR codes to add to the sale. Or, enter SKU manually.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <QrScanner isActive={isScannerActive && appReady} />
              
              <div className="text-center flex flex-col sm:flex-row gap-2 justify-center">
                <Button size="lg" onClick={() => setIsScannerActive(prev => !prev)} variant={isScannerActive ? "outline" : "default"} className="flex-grow">
                  {isScannerActive ? <VideoOff className="mr-2 h-5 w-5" /> : <ScanLine className="mr-2 h-5 w-5" />}
                  {isScannerActive ? "Stop Scanner" : "Start Scanner"}
                </Button>
                 <Button size="lg" variant="secondary" onClick={() => setIsNewProductDialogOpen(true)} className="flex-grow">
                    <PlusCircle className="mr-2 h-5 w-5" />
                    Create New Product
                </Button>
              </div>

              <div className="pt-4">
                <Label htmlFor="sku-input" className="text-sm font-medium">Enter SKU Manually to Add</Label>
                <div className="flex items-center space-x-2 mt-1">
                    <Input
                    id="sku-input"
                    type="text"
                    value={skuInput}
                    onChange={(e) => setSkuInput(e.target.value)}
                    placeholder="e.g., RIN-000001"
                    className="text-base"
                    onKeyPress={(e) => { if (e.key === 'Enter') handleManualSkuAdd(); }}
                    aria-label="Manually enter SKU"
                    />
                     {skuInput && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSkuInput('')}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Clear SKU input"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>
                 <Button size="lg" className="w-full mt-3" onClick={handleManualSkuAdd}>
                    <ListPlus className="mr-2 h-5 w-5" /> Add SKU to Sale
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

    