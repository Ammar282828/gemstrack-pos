
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Settings, Product, calculateProductPrice } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shapes, Search, Tag, PlusCircle, Edit3, Trash2, ShoppingCart, Loader2, Download, CopyPlus, LayoutGrid, List } from 'lucide-react';
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

type ViewMode = 'grid' | 'list';

interface ProductCardProps {
  product: Product;
  categoryTitle: string;
  settings: Settings;
  onDelete: (sku: string) => Promise<void>;
  isSelected: boolean;
  onToggleSelect: (sku: string, checked: boolean) => void;
}

const METAL_COLORS: Record<string, string> = {
  gold: 'bg-amber-100 text-amber-800 border-amber-300',
  silver: 'bg-slate-100 text-slate-700 border-slate-300',
  platinum: 'bg-blue-100 text-blue-800 border-blue-300',
  palladium: 'bg-purple-100 text-purple-800 border-purple-300',
};

function getMetalLabel(product: Product): string {
  const metal = product.metalType.charAt(0).toUpperCase() + product.metalType.slice(1);
  if (product.metalType === 'gold' && product.karat) return `${metal} ${product.karat.toUpperCase()}`;
  return metal;
}

const DeleteButton: React.FC<{ product: Product; onDelete: (sku: string) => Promise<void> }> = ({ product, onDelete }) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10">
        <Trash2 className="w-4 h-4" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete &quot;{product.name}&quot;?</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete this product. This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={async () => await onDelete(product.sku)}>Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const ProductCard: React.FC<ProductCardProps> = ({ product, categoryTitle, settings, onDelete, isSelected, onToggleSelect }) => {
  const { addToCart } = useAppStore();
  const { toast } = useToast();

  const price = useMemo(() => calculateProductPrice(product, settings), [product, settings]);

  const handleAddToCart = () => {
    addToCart(product.sku);
    toast({ title: 'Added to Cart', description: `${product.name} added.` });
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-200 flex flex-col">
      <div className="flex items-start gap-3 p-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggleSelect(product.sku, !!checked)}
          className="mt-1 shrink-0"
          aria-label={`Select ${product.name}`}
        />
        <Link href={`/products/${product.sku}`} className="relative shrink-0 w-20 h-20 rounded-md overflow-hidden border bg-muted block">
          <Image
            src={product.imageUrl || `https://placehold.co/160x160.png?text=${encodeURIComponent(product.name.substring(0, 1))}`}
            alt={product.name}
            fill
            style={{ objectFit: 'cover' }}
            data-ai-hint="jewelry item"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <Link href={`/products/${product.sku}`}>
            <h3 className="font-semibold text-sm leading-tight hover:text-primary transition-colors line-clamp-2">{product.name}</h3>
          </Link>
          <p className="text-xs text-muted-foreground mt-0.5">SKU: {product.sku}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${METAL_COLORS[product.metalType] || 'bg-muted text-muted-foreground'}`}>
              {getMetalLabel(product)} · {product.metalWeightG}g
            </span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">{categoryTitle}</Badge>
          </div>
        </div>
      </div>

      <div className="px-3 pb-2">
        <p className="text-xl font-bold text-primary">
          {price > 0 ? `PKR ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : <span className="text-sm text-muted-foreground">Price N/A</span>}
        </p>
      </div>

      <div className="px-3 pb-3 mt-auto flex items-center gap-2">
        <Button size="sm" onClick={handleAddToCart} className="flex-1 h-8">
          <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Add to Cart
        </Button>
        <Button asChild size="icon" variant="outline" className="h-8 w-8 shrink-0">
          <Link href={`/products/${product.sku}/edit`}><Edit3 className="w-4 h-4" /></Link>
        </Button>
        <DeleteButton product={product} onDelete={onDelete} />
      </div>
    </Card>
  );
};

const ProductRow: React.FC<ProductCardProps> = ({ product, categoryTitle, settings, onDelete, isSelected, onToggleSelect }) => {
  const { addToCart } = useAppStore();
  const { toast } = useToast();
  const price = useMemo(() => calculateProductPrice(product, settings), [product, settings]);

  return (
    <TableRow className={isSelected ? 'bg-primary/5' : ''}>
      <TableCell className="w-8">
        <Checkbox checked={isSelected} onCheckedChange={(c) => onToggleSelect(product.sku, !!c)} aria-label={`Select ${product.name}`} />
      </TableCell>
      <TableCell>
        <div className="relative w-10 h-10 rounded overflow-hidden border bg-muted shrink-0">
          <Image
            src={product.imageUrl || `https://placehold.co/80x80.png?text=${encodeURIComponent(product.name.substring(0, 1))}`}
            alt={product.name} fill style={{ objectFit: 'cover' }} data-ai-hint="jewelry item"
          />
        </div>
      </TableCell>
      <TableCell>
        <Link href={`/products/${product.sku}`} className="font-medium hover:text-primary transition-colors">{product.name}</Link>
        <p className="text-xs text-muted-foreground">{product.sku}</p>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">{categoryTitle}</Badge>
      </TableCell>
      <TableCell>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${METAL_COLORS[product.metalType] || ''}`}>
          {getMetalLabel(product)}
        </span>
        <p className="text-xs text-muted-foreground mt-0.5">{product.metalWeightG}g</p>
      </TableCell>
      <TableCell className="font-semibold text-primary">
        {price > 0 ? `PKR ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button size="sm" className="h-7 text-xs" onClick={() => { addToCart(product.sku); toast({ title: 'Added', description: product.name }); }}>
            <ShoppingCart className="w-3 h-3 mr-1" /> Cart
          </Button>
          <Button asChild size="icon" variant="outline" className="h-7 w-7">
            <Link href={`/products/${product.sku}/edit`}><Edit3 className="w-3.5 h-3.5" /></Link>
          </Button>
          <DeleteButton product={product} onDelete={onDelete} />
        </div>
      </TableCell>
    </TableRow>
  );
};

export default function ProductsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProductSkus, setSelectedProductSkus] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const appReady = useAppReady();
  const { allStoreProducts, categories, settings, deleteProductAction, isProductsLoading, loadProducts } = useAppStore(state => ({
    allStoreProducts: state.products,
    categories: state.categories,
    settings: state.settings,
    deleteProductAction: state.deleteProduct,
    isProductsLoading: state.isProductsLoading,
    loadProducts: state.loadProducts,
  }));
  const { toast } = useToast();
  
  useEffect(() => {
    if (appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);


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
    return allStoreProducts
      .filter(product => selectedCategory ? product.categoryId === selectedCategory : true)
      .filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [allStoreProducts, selectedCategory, searchTerm, appReady]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allStoreProducts.forEach(p => {
      counts[p.categoryId] = (counts[p.categoryId] || 0) + 1;
    });
    return counts;
  }, [allStoreProducts]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading products...</p>
      </div>
    );
  }


  return (
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4">
      <header className="mb-4 md:mb-6 flex flex-col md:flex-row justify-between items-start gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-primary flex items-center"><Shapes className="w-6 h-6 md:w-8 md:h-8 mr-2 md:mr-3"/>Products</h1>
          <p className="text-muted-foreground text-sm">{allStoreProducts.length} items in inventory</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/products/bulk-add" passHref>
            <Button variant="secondary">
              <CopyPlus className="w-4 h-4 mr-2" /> Bulk Add
            </Button>
          </Link>
          <Link href="/products/add" passHref>
            <Button>
              <PlusCircle className="w-4 h-4 mr-2" /> Add Product
            </Button>
          </Link>
        </div>
      </header>

      {/* Search + filter toolbar */}
      <Card className="mb-5">
        <CardContent className="p-4 space-y-3">
          {/* Row 1: Search + view toggle + export */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type="search"
                placeholder="Search by name or SKU…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex gap-1 border rounded-md p-0.5">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('grid')}
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('list')}
                title="List view"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleBulkExportCsv}
              disabled={selectedProductSkus.length === 0}
              title="Export selected to CSV for WEPrint"
            >
              <Download className="w-4 h-4 mr-2" /> Export ({selectedProductSkus.length})
            </Button>
          </div>

          {/* Row 2: Select all + category filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="outline" size="sm" onClick={handleSelectAllFiltered} disabled={filteredProducts.length === 0}>
              Select All ({filteredProducts.length})
            </Button>
            {selectedProductSkus.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                Deselect ({selectedProductSkus.length})
              </Button>
            )}
            <span className="text-muted-foreground text-xs">|</span>
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              All ({allStoreProducts.length})
            </Button>
            {categories.map((category) => (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category.id)}
              >
                {category.title}
                {categoryCounts[category.id] ? <span className="ml-1.5 text-xs opacity-70">{categoryCounts[category.id]}</span> : null}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isProductsLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Refreshing products…</p>
        </div>
      ) : filteredProducts.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                categoryTitle={getCategoryTitle(product.categoryId)}
                settings={settings}
                onDelete={handleDeleteProduct}
                isSelected={selectedProductSkus.includes(product.sku)}
                onToggleSelect={handleToggleProductSelection}
              />
            ))}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Name / SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Metal</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <ProductRow
                    key={product.sku}
                    product={product}
                    categoryTitle={getCategoryTitle(product.categoryId)}
                    settings={settings}
                    onDelete={handleDeleteProduct}
                    isSelected={selectedProductSkus.includes(product.sku)}
                    onToggleSelect={handleToggleProductSelection}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      ) : (
        <div className="text-center py-16 bg-card rounded-lg shadow">
          <Tag className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Products Found</h3>
          <p className="text-muted-foreground">
            {searchTerm || selectedCategory ? 'Try adjusting your search or filter.' : 'Add some products to get started.'}
          </p>
        </div>
      )}
    </div>
  );
}
