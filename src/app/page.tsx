
"use client";

import React from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, ShoppingCart, Trash2, ExternalLink, QrCode, Loader2, Gem, Users, Briefcase, ClipboardList, TrendingUp, BookUser, Settings as SettingsIcon } from 'lucide-react';
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

interface QuickLinkCardProps {
    href: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    className?: string;
}

const QuickLinkCard: React.FC<QuickLinkCardProps> = ({ href, icon, title, description, className }) => (
    <Link href={href} passHref>
        <Card className={`h-full flex flex-col hover:shadow-primary/10 hover:shadow-lg transition-shadow duration-300 ${className}`}>
            <CardHeader className="flex-row items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg text-primary">{icon}</div>
                <div>
                    <CardTitle className="text-lg">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </div>
            </CardHeader>
        </Card>
    </Link>
);


export default function HomePage() {
  const appReady = useAppReady();
  const { cartItems, cartSubtotal, removeFromCartAction, loadProducts } = useAppStore(state => ({
    cartItems: selectCartDetails(state),
    cartSubtotal: selectCartSubtotal(state),
    removeFromCartAction: state.removeFromCart,
    loadProducts: state.loadProducts,
  }));

  React.useEffect(() => {
    if (appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);


  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading POS...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 px-4 space-y-8">
       <header className="mb-4">
            <h1 className="text-3xl font-bold text-primary">Dashboard</h1>
            <p className="text-muted-foreground">Welcome back! Here's a quick overview and access to your tasks.</p>
        </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Main Actions & Links */}
        <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <Link href="/scan" passHref>
                    <Card className="shadow-lg text-center hover:bg-primary/5 transition-colors h-full">
                        <CardHeader>
                        <CardTitle className="text-2xl font-bold text-primary mb-2">Start New Sale</CardTitle>
                        <CardDescription className="text-base text-muted-foreground">Scan products to begin a new transaction.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center justify-center py-8">
                           <QrCode className="w-16 h-16 text-primary" />
                        </CardContent>
                    </Card>
                 </Link>
                  <Link href="/orders/add" passHref>
                     <Card className="shadow-lg text-center hover:bg-primary/5 transition-colors h-full">
                        <CardHeader>
                        <CardTitle className="text-2xl font-bold text-primary mb-2">Create Custom Order</CardTitle>
                        <CardDescription className="text-base text-muted-foreground">Build a new custom order for a client.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center justify-center py-8">
                            <PlusCircle className="w-16 h-16 text-primary" />
                        </CardContent>
                    </Card>
                  </Link>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle>Quick Access</CardTitle>
                    <CardDescription>Jump directly to key management areas.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <QuickLinkCard href="/products" icon={<Gem className="h-6 w-6"/>} title="Products" description="Manage inventory" />
                    <QuickLinkCard href="/orders" icon={<ClipboardList className="h-6 w-6"/>} title="Orders" description="View custom orders" />
                    <QuickLinkCard href="/customers" icon={<Users className="h-6 w-6"/>} title="Customers" description="Client database" />
                    <QuickLinkCard href="/karigars" icon={<Briefcase className="h-6 w-6"/>} title="Karigars" description="Artisan accounts" />
                    <QuickLinkCard href="/analytics" icon={<TrendingUp className="h-6 w-6"/>} title="Analytics" description="Sales & trends" />
                    <QuickLinkCard href="/hisaab" icon={<BookUser className="h-6 w-6"/>} title="Hisaab" description="Ledger accounts" />
                    <QuickLinkCard href="/settings" icon={<SettingsIcon className="h-6 w-6"/>} title="Settings" description="System configuration" />
                </CardContent>
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

