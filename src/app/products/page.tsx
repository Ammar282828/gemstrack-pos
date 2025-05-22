
"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, selectAllProductsWithCosts, selectCategoryTitleById, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shapes, Search, Tag, Weight, PlusCircle, Eye, Edit3, Trash2, ShoppingCart } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { useIsStoreHydrated } from '@/lib/store';

type ProductWithCosts = ReturnType<typeof selectAllProductsWithCosts>[0];

const ProductListItem: React.FC<{ product: ProductWithCosts, categoryTitle: string, onDelete: (sku: string) => void }> = ({ product, categoryTitle, onDelete }) => {
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
    <Card className="overflow-hidden shadow-md hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="flex flex-row items-start justify-between p-4 space-y-0">
         <Link href={`/products/${product.sku}`} className="w-2/3">
          <CardTitle className="text-lg hover:text-primary transition-colors">{product.name}</CardTitle>
          <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
        </Link>
        <div className="relative w-16 h-16 rounded-md overflow-hidden border bg-muted">
          <Image
            src={product.imageUrl || `https://placehold.co/100x100.png?text=${encodeURIComponent(product.name.substring(0,1))}`}
            alt={product.name}
            layout="fill"
            objectFit="cover"
            data-ai-hint="jewelry item"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <Badge variant="secondary" className="mb-2 flex items-center w-fit text-xs">
          <Shapes className="w-3 h-3 mr-1" />
          {categoryTitle}
        </Badge>
        <div className="flex items-center text-sm">
          <span className="font-semibold text-primary">
            <span className="mr-0.5">PKR</span>{product.totalPrice.toLocaleString()}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Metal: {product.metalWeightG}g {/* Stone weight display removed */}
        </div>
      </CardContent>
      <CardFooter className="p-4 border-t flex flex-col items-stretch gap-2">
         <Button size="sm" variant="default" onClick={handleAddToCart} className="w-full">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add to Cart
        </Button>
        <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" className="flex-1">
            <Link href={`/products/${product.sku}/edit`}>
                <Edit3 className="w-4 h-4 mr-1" /> Edit
            </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="flex-1">
            <Link href={`/products/${product.sku}`}>
                <Eye className="w-4 h-4 mr-1" /> View
            </Link>
            </Button>
            <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="flex-1"><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the product "{product.name}".
                </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(product.sku)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
        </div>
      </CardFooter>
    </Card>
  );
};

export default function ProductsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const isHydrated = useIsStoreHydrated();
  const products = useAppStore(selectAllProductsWithCosts);
  const categories = useAppStore(state => state.categories);
  const getCategoryTitle = (categoryId: string) => {
    if (!isHydrated) return 'Loading...'; // Or handle appropriately
    const category = categories.find(c => c.id === categoryId);
    return category ? category.title : 'Uncategorized';
  };
  const deleteProductAction = useAppStore(state => state.deleteProduct);
  const { toast } = useToast();

  const handleDeleteProduct = (sku: string) => {
    deleteProductAction(sku);
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
  };

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
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">Manage Products</h1>
          <p className="text-muted-foreground">View, add, edit, or delete your jewellery items.</p>
        </div>
        <Link href="/products/add" passHref>
          <Button size="lg">
            <PlusCircle className="w-5 h-5 mr-2" />
            Add New Product
          </Button>
        </Link>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center mb-4">
            <div className="relative flex-grow w-full md:w-auto">
              <Input
                type="search"
                placeholder="Search by name or SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <ProductListItem key={product.sku} product={product} categoryTitle={getCategoryTitle(product.categoryId)} onDelete={handleDeleteProduct} />
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
  );
}
