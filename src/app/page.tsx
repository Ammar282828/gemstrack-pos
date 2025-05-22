
"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, selectAllProductsWithCosts, selectCartDetails, selectCartSubtotal, Category, Product as ProductType } from '@/lib/store'; // Renamed Product to ProductType to avoid conflict
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shapes, Search, Tag, Weight, PlusCircle, Eye, ShoppingCart, Trash2, ExternalLink } from 'lucide-react'; // Added Trash2, ExternalLink
import { useIsStoreHydrated } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

type ProductWithCosts = ReturnType<typeof selectAllProductsWithCosts>[0];

const ProductCard: React.FC<{ product: ProductWithCosts, categoryTitle: string }> = ({ product, categoryTitle }) => {
  const { addToCart } = useAppStore();
  const { toast } = useToast();

  const handleAddToCart = () => {
    addToCart(product.sku);
    toast({
      title: "Added to Cart",
      description: `${product.name} has been added to your cart.`,
    });
  };

  return (
    <Card className="overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
      <CardHeader className="p-0">
        <Link href={`/products/${product.sku}`}>
          <div className="relative w-full h-48 bg-muted">
            <Image
              src={product.imageUrl || `https://placehold.co/600x400.png?text=${encodeURIComponent(product.name)}`}
              alt={product.name}
              layout="fill"
              objectFit="cover"
              data-ai-hint="jewelry product"
            />
          </div>
        </Link>
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <Link href={`/products/${product.sku}`}>
          <CardTitle className="text-lg mb-1 hover:text-primary transition-colors">{product.name}</CardTitle>
        </Link>
        <div className="text-sm text-muted-foreground mb-2">SKU: {product.sku}</div>
        <Badge variant="secondary" className="mb-2 flex items-center w-fit">
          <Shapes className="w-3 h-3 mr-1" />
          {categoryTitle}
        </Badge>
        <div className="flex items-center text-sm mb-1">
          <Weight className="w-4 h-4 mr-2 text-muted-foreground" />
          Metal: {product.metalWeightG}g ({product.karat.toUpperCase()})
        </div>
      </CardContent>
      <CardFooter className="p-4 bg-muted/30 flex flex-col items-stretch gap-2">
        <div className="text-xl font-bold text-primary flex items-center justify-center">
          <span className="mr-1">PKR</span>
          {product.totalPrice.toLocaleString()}
        </div>
        <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" asChild>
                <Link href={`/products/${product.sku}`}>
                    <Eye className="w-4 h-4 mr-2" />
                    View
                </Link>
            </Button>
            <Button size="sm" variant="default" className="flex-1" onClick={handleAddToCart}>
                <ShoppingCart className="w-4 h-4 mr-2" />
                Add to Cart
            </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

const CartSummaryItem: React.FC<{ item: NonNullable<ReturnType<typeof selectCartDetails>[0]>, removeFromCart: (sku: string) => void }> = ({ item, removeFromCart }) => {
  return (
    <div className="flex justify-between items-center py-2">
      <div>
        <p className="font-medium text-sm leading-tight">{item.name}</p>
        <p className="text-xs text-muted-foreground">Qty: {item.quantity} &bull; Unit: PKR {item.totalPrice.toLocaleString()}</p>
      </div>
      <div className="flex items-center space-x-2">
        <p className="font-semibold text-sm text-primary">PKR {item.lineItemTotal.toLocaleString()}</p>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => removeFromCart(item.sku)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};


export default function HomePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const isHydrated = useIsStoreHydrated();
  const products = useAppStore(selectAllProductsWithCosts);
  const categories = useAppStore(state => state.categories);
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);
  const { removeFromCart: removeFromCartAction } = useAppStore(); // Renamed to avoid conflict in CartSummaryItem if passed directly


  const categoryMap = useMemo(() => {
    if (!isHydrated) return new Map<string, string>();
    return categories.reduce((acc, category) => {
      acc.set(category.id, category.title);
      return acc;
    }, new Map<string, string>());
  }, [categories, isHydrated]);

  const filteredProducts = useMemo(() => {
    if (!isHydrated) return [];
    return products
      .filter(product =>
        selectedCategory ? product.categoryId === selectedCategory : true
      )
      .filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [products, selectedCategory, searchTerm, isHydrated]);

  if (!isHydrated) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Loading products...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-primary mb-2">Welcome to Taheri POS</h1>
        <p className="text-lg text-muted-foreground">Select products to start a new sale.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Filters and Product Grid */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex flex-col md:flex-row gap-4 items-center mb-4">
                <div className="relative flex-grow w-full md:w-auto">
                  <Input
                    type="search"
                    placeholder="Search by name or SKU..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 text-base"
                  />
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                </div>
                <Link href="/products/add" passHref>
                  <Button size="lg" className="w-full md:w-auto">
                    <PlusCircle className="w-5 h-5 mr-2" />
                    Add New Product
                  </Button>
                </Link>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  variant={selectedCategory === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                  className="flex items-center"
                >
                  <Shapes className="w-4 h-4 mr-2" /> All Categories
                </Button>
                {categories.map((category) => (
                  <Button
                    key={category.id}
                    variant={selectedCategory === category.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    {category.title}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.sku}
                  product={product}
                  categoryTitle={categoryMap.get(product.categoryId) || 'Uncategorized'}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-lg shadow">
              <Tag className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Products Found</h3>
              <p className="text-muted-foreground">
                {searchTerm || selectedCategory ? "Try adjusting your search or filter." : "Add some products to get started!"}
              </p>
            </div>
          )}
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
                <p className="text-muted-foreground text-center py-4">Your cart is empty. Add products to start a sale.</p>
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
