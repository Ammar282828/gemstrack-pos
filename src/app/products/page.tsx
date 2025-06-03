
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { useAppStore, selectAllProductsWithCosts, selectCategoryTitleById, Product, useAppReady, Settings, ProductTagFormat, AVAILABLE_TAG_FORMATS, DEFAULT_TAG_FORMAT_ID } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Renamed to avoid conflict
import { Shapes, Search, Tag, Weight, PlusCircle, Eye, Edit3, Trash2, ShoppingCart, Loader2, Printer } from 'lucide-react';
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
import { drawTagContentOnDoc } from './[sku]/page'; // Import the refactored drawing function

type ProductWithCosts = ReturnType<typeof selectAllProductsWithCosts>[0];

interface ProductListItemProps {
  product: ProductWithCosts;
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
        <div className="flex items-center text-sm">
          <span className="font-semibold text-primary">
            <span className="mr-0.5">PKR </span>{product.totalPrice.toLocaleString()}
          </span>
        </div>
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
  const [bulkPrintTagFormatId, setBulkPrintTagFormatId] = useState<string>(DEFAULT_TAG_FORMAT_ID);


  const appReady = useAppReady();
  const allStoreProducts = useAppStore(selectAllProductsWithCosts);
  const categories = useAppStore(state => state.categories);
  const settings = useAppStore(state => state.settings);
  const deleteProductAction = useAppStore(state => state.deleteProduct);
  const isProductsLoading = useAppStore(state => state.isProductsLoading);
  const setProductQrCodeAction = useAppStore(state => state.setProductQrCode);

  const { toast } = useToast();

  const getCategoryTitle = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    return category ? category.title : 'Uncategorized';
  };
  
  const handleDeleteProduct = async (sku: string) => {
    await deleteProductAction(sku);
    setSelectedProductSkus(prev => prev.filter(s => s !== sku)); // Remove from selection if deleted
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


  const generateAndStoreQrCode = async (productSku: string): Promise<string | undefined> => {
    try {
      const tempCanvas = document.createElement('canvas');
      await QRCode.toCanvas(tempCanvas, productSku, { errorCorrectionLevel: 'H', width: 256 });
      const dataUrl = tempCanvas.toDataURL('image/png');
      if (dataUrl && dataUrl.length > 100 && dataUrl !== 'data:,') {
        await setProductQrCodeAction(productSku, dataUrl); // This updates Firestore and local store
        return dataUrl;
      }
      return undefined;
    } catch (e) {
      console.error(`Error generating QR code for ${productSku}:`, e);
      return undefined;
    }
  };


  const handleBulkPrintTags = async () => {
    if (selectedProductSkus.length === 0) {
      toast({ title: "No Products Selected", description: "Please select products to print tags for.", variant: "destructive" });
      return;
    }

    toast({ title: "Bulk Print Started", description: `Preparing to print ${selectedProductSkus.length} tags. Please wait...` });

    const selectedFormat = AVAILABLE_TAG_FORMATS.find(f => f.id === bulkPrintTagFormatId) || AVAILABLE_TAG_FORMATS[0];
    if (selectedFormat.layoutType !== 'dumbbell') {
        toast({ title: "Unsupported Format", description: "Bulk printing is currently optimized for dumbbell tags on A4 sheets.", variant: "destructive"});
        return;
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Define sheet layout for A4 with 7 dumbbell tags per column
    const tagsPerRow = 1; // For the provided sheet
    const tagsPerCol = 7;
    const marginTop = 10; // mm
    const marginLeft = (pageWidth - selectedFormat.widthMillimeters * tagsPerRow) / 2; // Center the column
    const tagSlotHeight = (pageHeight - 2 * marginTop) / tagsPerCol; // Effective height for each tag slot

    let currentTagIndex = 0;
    let pageNumber = 1;
    
    for (const sku of selectedProductSkus) {
      const product = allStoreProducts.find(p => p.sku === sku);
      if (!product) {
        toast({ title: "Product Not Found", description: `SKU ${sku} not found, skipping.`, variant: "destructive"});
        continue;
      }

      let qrDataUrl = product.qrCodeDataUrl;
      if (!qrDataUrl) {
        toast({ description: `Generating QR for ${sku}...`, duration: 1500 });
        qrDataUrl = await generateAndStoreQrCode(sku);
        if (!qrDataUrl) {
          toast({ title: "QR Generation Failed", description: `Could not generate QR for ${sku}, skipping.`, variant: "destructive"});
          continue;
        }
      }

      if (currentTagIndex > 0 && currentTagIndex % (tagsPerRow * tagsPerCol) === 0) {
        doc.addPage();
        pageNumber++;
      }

      const tagIndexOnPage = currentTagIndex % (tagsPerRow * tagsPerCol);
      const rowIndex = Math.floor(tagIndexOnPage / tagsPerRow);
      // const colIndex = tagIndexOnPage % tagsPerRow; // Not used for single column

      const x = marginLeft; // + colIndex * selectedFormat.widthMillimeters; (if multiple columns)
      const y = marginTop + rowIndex * tagSlotHeight;
      
      // Center the 50mm dumbbell tag content within the ~39.57mm slot height
      // This means our 50mm is logical height, actual printed content needs to be compact
      // For dumbbell, the content is at the ends. The startY should be where the top of the 50mm logical tag starts.
      const drawY = y + (tagSlotHeight - selectedFormat.heightMillimeters) / 2;


      drawTagContentOnDoc(doc, product, qrDataUrl, settings, selectedFormat, x, Math.max(y, drawY)); // Ensure not drawing above y

      currentTagIndex++;
    }

    if (currentTagIndex > 0) {
        doc.autoPrint();
        window.open(doc.output('bloburl'), '_blank');
        toast({ title: "Bulk Tags Ready", description: `${currentTagIndex} tags generated on ${pageNumber} page(s).` });
    } else {
        toast({ title: "No Tags Printed", description: "Could not generate any tags. Check QR codes or product data.", variant: "destructive" });
    }
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

  if (!appReady && isProductsLoading) {
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
          <h1 className="text-3xl font-bold text-primary">Manage Products</h1>
          <p className="text-muted-foreground">View, add, edit, or delete your jewellery items. Select products for bulk tag printing.</p>
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
          <div className="flex flex-col md:flex-row gap-4 items-center">
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
            <div className="w-full md:w-auto">
                <ShadSelect value={bulkPrintTagFormatId} onValueChange={setBulkPrintTagFormatId}>
                    <SelectTrigger className="w-full md:w-[250px]">
                        <SelectValue placeholder="Select Tag Format for Bulk Print" />
                    </SelectTrigger>
                    <SelectContent>
                        {AVAILABLE_TAG_FORMATS.filter(f => f.layoutType === 'dumbbell').map(format => ( // Only show dumbbell for now
                        <SelectItem key={format.id} value={format.id}>
                            {format.name}
                        </SelectItem>
                        ))}
                    </SelectContent>
                </ShadSelect>
            </div>
            <Button 
                onClick={handleBulkPrintTags} 
                disabled={selectedProductSkus.length === 0}
                className="w-full md:w-auto"
            >
              <Printer className="w-4 h-4 mr-2" /> Print Tags for Selected ({selectedProductSkus.length})
            </Button>
          </div>

           <div className="flex flex-wrap gap-2 items-center">
            <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAllFiltered}
                disabled={filteredProducts.length === 0}
            >
                Select All Filtered ({filteredProducts.length})
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={handleDeselectAll}
                disabled={selectedProductSkus.length === 0}
            >
                Deselect All ({selectedProductSkus.length})
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

      {isProductsLoading && appReady ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing product list...</p>
         </div>
      ): filteredProducts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
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
            { appReady ? 
              (searchTerm || selectedCategory ? "Try adjusting your search or filter, or ensure products exist in the database." : "Add some products to get started or seed dummy data in Settings.") :
              "Still loading application data. Please wait..."
            }
          </p>
          {!appReady && <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin mt-4" />}
        </div>
      )}
    </div>
  );
}

