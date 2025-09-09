

"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Settings, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from "@/components/ui/checkbox";
import { Shapes, Search, Tag, Weight, PlusCircle, Eye, Edit3, Trash2, ShoppingCart, Loader2, Download } from 'lucide-react';
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
import { generateProductCsv } from '@/lib/csv';

interface ProductListItemProps {
  product: Product;
  categoryTitle: string;
  onDelete: (sku: string) => Promise<void>;
  isSelected: boolean;
  onToggleSelect: (sku: string, checked: boolean) => void;
}

const ProductListItem: React.FC<ProductListItemProps> = ({ product, categoryTitle, onDelete, isSelected, onToggleSelect }) => {
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
         <div className="flex items-start space-x-3 w-2/3">
            <Checkbox
                id={`select-${product.sku}`}
                checked={isSelected}
                onCheckedChange={(checked) => onToggleSelect(product.sku, !!checked)}
                className="mt-1"
                aria-label={`Select ${product.name}`}
            />
            <Link href={`/products/${product.sku}`} className="flex-grow">
                <CardTitle className="text-lg hover:text-primary transition-colors">{product.name}</CardTitle>
                <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
            </Link>
         </div>
        <div className="relative w-16 h-16 rounded-md overflow-hidden border bg-muted">
          <Image
            src={product.imageUrl || `https://placehold.co/100x100.png?text=${encodeURIComponent(product.name.substring(0,1))}`}
            alt={product.name}
            fill
            style={{ objectFit: "cover" }}
            data-ai-hint="jewelry item"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <Badge variant="secondary" className="mb-2 flex items-center w-fit text-xs">
          <Shapes className="w-3 h-3 mr-1" />
          {categoryTitle}
        </Badge>
        <div className="text-xs text-muted-foreground mt-1">
          Metal: {product.metalType.charAt(0).toUpperCase() + product.metalType.slice(1)}{product.metalType === 'gold' && product.karat ? ` (${product.karat.toUpperCase()})` : ''} - {product.metalWeightG}g
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
                <AlertDialogAction onClick={async () => await onDelete(product.sku)}>Delete</AlertDialogAction>
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
  const [selectedProductSkus, setSelectedProductSkus] = useState<string[]>([]);

  const appReady = useAppReady();
  const allStoreProducts = useAppStore(state => state.products); // Use raw products
  const categories = useAppStore(state => state.categories);
  const settings = useAppStore(state => state.settings);
  const deleteProductAction = useAppStore(state => state.deleteProduct);
  const isProductsLoading = useAppStore(state => state.isProductsLoading);

  const { toast } = useToast();

  const getCategoryTitle = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    return category ? category.title : 'Uncategorized';
  };
  
  const handleDeleteProduct = async (sku: string) => {
    await deleteProductAction(sku);
    setSelectedProductSkus(prev => prev.filter(s => s !== sku)); 
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
  };

  const handleToggleProductSelection = (sku: string, checked: boolean) => {
    setSelectedProductSkus(prevSelectedSkus => {
      if (checked) {
        return [...prevSelectedSkus, sku];
      } else {
        return prevSelectedSkus.filter(s => s !== sku);
      }
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedProductSkus(filteredProducts.map(p => p.sku));
  };

  const handleDeselectAll = () => {
    setSelectedProductSkus([]);
  };

  const handleBulkExportCsv = () => {
    if (selectedProductSkus.length === 0) {
      toast({ title: "No Products Selected", description: "Please select products to export.", variant: "destructive" });
      return;
    }
    const productsToExport = allStoreProducts.filter(p => selectedProductSkus.includes(p.sku));
    generateProductCsv(productsToExport, settings);
    toast({ title: "CSV Exported", description: `${productsToExport.length} products exported to CSV.` });
  };
  
  const filteredProducts = useMemo(() => {
    if (!appReady) return [];
    const filtered = allStoreProducts
      .filter(product =>
        selectedCategory ? product.categoryId === selectedCategory : true
      )
      .filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase())
      );
    return filtered;
  }, [allStoreProducts, selectedCategory, searchTerm, appReady]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading products...</p>
      </div>
    );
  }


  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">Manage Products</h1>
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
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-grow w-full">
              <Input
                type="search"
                placeholder="Search by name or SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button 
                    onClick={handleBulkExportCsv} 
                    disabled={selectedProductSkus.length === 0}
                    className="w-full sm:w-auto"
                >
                <Download className="w-4 h-4 mr-2" /> Export CSV for WEPrint ({selectedProductSkus.length})
                </Button>
            </div>
          </div>

           <div className="flex flex-wrap gap-2 items-center">
            <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAllFiltered}
                disabled={filteredProducts.length === 0}
            >
                Select All ({filteredProducts.length})
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={handleDeselectAll}
                disabled={selectedProductSkus.length === 0}
            >
                Deselect ({selectedProductSkus.length})
            </Button>
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

      {isProductsLoading ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing product list...</p>
         </div>
      ): filteredProducts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <ProductListItem 
                key={product.sku} 
                product={product} 
                categoryTitle={getCategoryTitle(product.categoryId)} 
                onDelete={handleDeleteProduct}
                isSelected={selectedProductSkus.includes(product.sku)}
                onToggleSelect={handleToggleProductSelection}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <Tag className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Products Found</h3>
          <p className="text-muted-foreground">
            {searchTerm || selectedCategory ? "Try adjusting your search or filter." : "Add some products to get started or seed dummy data in Settings."}
          </p>
        </div>
      )}
    </div>
  );
}
