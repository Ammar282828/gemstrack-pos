
"use client";

import React from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, useAppReady } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, ShoppingCart, Trash2, ExternalLink, QrCode, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const CartSummaryItem: React.FC<{ item: NonNullable<ReturnType<typeof selectCartDetails>[0]>, removeFromCart: (sku: string) => void }> = ({ item, removeFromCart }) => {
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


export default function HomePage() {
  const appReady = useAppReady();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);
  const { removeFromCart: removeFromCartAction } = useAppStore();


  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading POS...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Main Actions */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-lg text-center">
            <CardHeader>
              <CardTitle className="text-2xl md:text-3xl font-bold text-primary mb-2">Taheri Point of Sale</CardTitle>
              <CardDescription className="text-base md:text-lg text-muted-foreground">Begin a new transaction by scanning product QR codes.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Link href="/scan" passHref>
                <Button size="lg" className="h-14 px-8 text-lg md:h-16 md:px-10 md:text-xl">
                  <QrCode className="w-6 h-6 md:w-8 md:h-8 mr-3" />
                  Start New Sale
                </Button>
              </Link>
              <p className="text-muted-foreground mt-6">or</p>
              <Link href="/products" passHref>
                 <Button variant="link" className="mt-2 text-base">Browse Products Manually</Button>
              </Link>
            </CardContent>
            <CardFooter className="flex-col items-center justify-center pt-6 border-t">
                <p className="text-sm text-muted-foreground mb-2">Need to manage inventory?</p>
                 <Link href="/products/add" passHref>
                    <Button variant="outline">
                        <PlusCircle className="w-5 h-5 mr-2" />
                        Add New Product
                    </Button>
                </Link>
            </CardFooter>
          </Card>
        </div>

        {/* Right Column: Cart Summary */}
        <div className="lg:col-span-1 sticky top-8">
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
                      <CartSummaryItem key={item.sku} item={item} removeFromCart={removeFromCartAction} />
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
      </div>
    </div>
  );
}
