
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, selectAllProductsWithCosts, Category, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shapes, Search, Tag, Weight, IndianRupee, PlusCircle, Eye } from 'lucide-react';
import { useIsStoreHydrated } from '@/lib/store';

type ProductWithCosts = ReturnType<typeof selectAllProductsWithCosts>[0];

const ProductCard: React.FC<{ product: ProductWithCosts, categoryTitle: string }> = ({ product, categoryTitle }) => {
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
          Metal: {product.metalWeightG}g
        </div>
        {product.stoneWeightCt > 0 && (
          <div className="flex items-center text-sm mb-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-muted-foreground"><path d="M6 3.27A21.64 21.64 0 0 1 12 3a21.64 21.64 0 0 1 6 0.27V5.5a21.64 21.64 0 0 0-6 15.23A21.64 21.64 0 0 0 6 5.5V3.27Z"></path><path d="M12 15.5V21"></path><path d="M12 3v3.05"></path><path d="M17.83 4.53c2.22 0 3.17 1.34 3.17 2.69 0 .84-.47 1.41-1.12 1.88L18 9.93"></path><path d="M6.17 4.53c-2.22 0-3.17 1.34-3.17 2.69 0 .84.47 1.41 1.12 1.88L6 9.93"></path></svg>
             Stone: {product.stoneWeightCt}ct
          </div>
        )}
      </CardContent>
      <CardFooter className="p-4 bg-muted/30 flex justify-between items-center">
        <div className="text-xl font-bold text-primary flex items-center">
          <IndianRupee className="w-5 h-5 mr-1" />
          {product.totalPrice.toLocaleString()}
        </div>
        <Link href={`/products/${product.sku}`}>
          <Button size="sm" variant="outline">
            <Eye className="w-4 h-4 mr-2" />
            View
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
};

export default function HomePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  const isHydrated = useIsStoreHydrated();
  const products = useAppStore(selectAllProductsWithCosts);
  const categories = useAppStore(state => state.categories);

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
        <h1 className="text-4xl font-bold text-primary mb-2">Welcome to GemsTrack POS</h1>
        <p className="text-lg text-muted-foreground">Manage your jewellery inventory with ease.</p>
      </header>

      <div className="mb-6 p-6 bg-card rounded-lg shadow">
        <div className="flex flex-col md:flex-row gap-4 items-center">
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
            <Button size="lg">
              <PlusCircle className="w-5 h-5 mr-2" />
              Add New Product
            </Button>
          </Link>
        </div>
        
        <div className="mt-6 flex flex-wrap gap-2 items-center">
          <Button
            variant={selectedCategory === null ? 'default' : 'outline'}
            onClick={() => setSelectedCategory(null)}
            className="flex items-center"
          >
            <Shapes className="w-4 h-4 mr-2" /> All Categories
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={selectedCategory === category.id ? 'default' : 'outline'}
              onClick={() => setSelectedCategory(category.id)}
            >
              {category.title}
            </Button>
          ))}
        </div>
      </div>

      {filteredProducts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredProducts.map((product) => (
            <ProductCard 
              key={product.sku} 
              product={product} 
              categoryTitle={categoryMap.get(product.categoryId) || 'Uncategorized'} 
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Tag className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Products Found</h3>
          <p className="text-muted-foreground">
            {searchTerm || selectedCategory ? "Try adjusting your search or filter." : "Add some products to get started!"}
          </p>
        </div>
      )}
    </div>
  );
}
