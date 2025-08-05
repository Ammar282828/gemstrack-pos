
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode.react';
import { useAppStore, selectProductWithCosts, selectCategoryTitleById, Settings, KaratValue, MetalType, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, Download, QrCode as QrCodeIcon, ArrowLeft, Weight, Shapes, ShoppingCart, Diamond, Zap, Shield, Gem, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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
import { useIsStoreHydrated } from '@/lib/store';
import { generateProductCsv } from '@/lib/csv';


type ProductWithCalculatedCosts = ReturnType<typeof selectProductWithCosts>;


const DetailItem: React.FC<{ label: string; value?: string | number | boolean; icon?: React.ReactNode, unit?: string, currency?: string }> = ({ label, value, icon, unit, currency }) => {
  const renderValue = () => {
    if (value === undefined || value === null) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      return (
        <>
          {currency && <span className="mr-0.5">{currency}</span>}
          {value.toLocaleString()} {unit}
        </>
      );
    }
    // It's a string, so just render it.
    return `${value} ${unit || ''}`;
  };

  return (
    <div className="flex justify-between items-center py-2">
      <div className="flex items-center text-sm text-muted-foreground">
        {icon && <span className="mr-2">{icon}</span>}
        <span>{label}</span>
      </div>
      <span className="font-medium text-foreground text-sm text-right">
        {renderValue()}
      </span>
    </div>
  );
};


export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const sku = params.sku as string;

  const isHydrated = useIsStoreHydrated();
  const productData = useAppStore(state => selectProductWithCosts(sku, state));
  const categoryTitle = useAppStore(state => productData ? selectCategoryTitleById(productData.categoryId, state) : '');
  const settings = useAppStore(state => state.settings);
  const deleteProductAction = useAppStore(state => state.deleteProduct);
  const setProductQrCodeDataUrlAction = useAppStore(state => state.setProductQrCode);
  const { addToCart } = useAppStore();

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (productData?.qrCodeDataUrl) {
      setQrCodeDataUrl(productData.qrCodeDataUrl);
    } else {
      setQrCodeDataUrl(undefined);
    }
  }, [productData?.qrCodeDataUrl]);

  useEffect(() => {
    if (isHydrated && productData && !productData.qrCodeDataUrl) {
      const canvas = document.getElementById(`qr-${sku}`) as HTMLCanvasElement;
      if (canvas) {
        const timerId = setTimeout(() => {
          try {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 100 && dataUrl !== 'data:,') { 
              setProductQrCodeDataUrlAction(sku, dataUrl); 
            } else {
              console.warn(`[GemsTrack] QR Canvas for ${sku} was blank or toDataURL returned minimal data. Generation skipped for store update.`);
            }
          } catch (e) {
            console.error("Error generating QR code data URL for store update:", e);
          }
        }, 150); 
        return () => clearTimeout(timerId);
      }
    }
  }, [isHydrated, productData, sku, setProductQrCodeDataUrlAction, toast]);


  const handleDeleteProduct = async () => {
    await deleteProductAction(sku);
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
    router.push('/products');
  };

  const handleExportCsv = () => {
    if (!productData) {
      toast({ title: "Error", description: "Product data not available for export.", variant: "destructive" });
      return;
    }
    generateProductCsv([productData], settings);
    toast({ title: "CSV Exported", description: `CSV file for ${productData.name} is ready.` });
  };
  
  const handleAddToCart = () => {
    if (!productData) return;
    addToCart(productData.sku);
    toast({
      title: "Added to Cart",
      description: `${productData.name} has been added to your cart.`,
    });
  };

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading product details...</p></div>;
  }

  if (!productData) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Product not found</h2>
        <Link href="/products" passHref>
          <Button variant="link" className="mt-4">Go back to products</Button>
        </Link>
      </div>
    );
  }

  const goldRate21k = settings.goldRatePerGram * (21/24);

  return (
    <div className="container mx-auto p-4">
      <Button variant="outline" onClick={() => router.back()} className="mb-6">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to List
      </Button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
        
        <div className="md:col-span-2 space-y-6 order-2 md:order-1">
          <Card>
            <CardHeader>
              <Badge variant="secondary" className="mb-2 w-fit">
                <Shapes className="w-3 h-3 mr-1" /> {categoryTitle}
              </Badge>
              <CardTitle className="text-2xl md:text-3xl">{productData.name}</CardTitle>
              <CardDescription>SKU: {productData.sku}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-primary/10 p-4 rounded-lg mb-4 text-center">
                <p className="text-sm text-primary font-medium">TOTAL PRICE</p>
                <p className="text-3xl md:text-4xl font-bold text-primary flex items-center justify-center">
                  <span className="mr-1">PKR </span>
                  {productData.totalPrice.toLocaleString()}
                </p>
              </div>
              <Button size="lg" className="w-full mb-4" onClick={handleAddToCart}>
                  <ShoppingCart className="mr-2 h-5 w-5" /> Add to Cart
              </Button>
              {productData.isCustomPrice ? (
                 <div className="py-2">
                    <p className="text-sm text-muted-foreground flex items-center mb-1"><Info className="w-4 h-4 mr-2" /> Description</p>
                    <p className="text-sm whitespace-pre-wrap font-medium bg-muted/50 p-2 rounded-md">{productData.description || 'N/A'}</p>
                 </div>
              ) : (
                <>
                  {productData.metalType === 'gold' && (
                      <DetailItem label="Gold Rate (Store Setting, 21k)" value={goldRate21k} unit="/ gram" currency="PKR " />
                  )}
                  {productData.metalType === 'palladium' && (
                      <DetailItem label="Palladium Rate (Store Setting)" value={settings.palladiumRatePerGram} unit="/ gram" currency="PKR " />
                  )}
                  {productData.metalType === 'platinum' && (
                      <DetailItem label="Platinum Rate (Store Setting)" value={settings.platinumRatePerGram} unit="/ gram" currency="PKR " />
                  )}
                   {productData.metalType === 'silver' && (
                      <DetailItem label="Silver Rate (Store Setting)" value={settings.silverRatePerGram} unit="/ gram" currency="PKR " />
                  )}
                  <Separator className="my-1" />
                  <DetailItem label="Metal Cost" value={productData.metalCost} currency="PKR " />
                  <Separator className="my-1" />
                  <DetailItem label="Wastage Cost" value={productData.wastageCost} currency="PKR " />
                  <Separator className="my-1" />
                  <DetailItem label="Making Charges" value={productData.makingCharges} currency="PKR " />
                  {productData.hasDiamonds && (
                    <>
                      <Separator className="my-1" />
                      <DetailItem label="Diamond Charges" value={productData.diamondCharges} currency="PKR " icon={<Diamond className="w-4 h-4" />}/>
                    </>
                  )}
                   <Separator className="my-1" />
                  <DetailItem label={productData.hasDiamonds ? "Other Stone Charges" : "Stone Charges"} value={productData.stoneCharges} currency="PKR " />
                   <Separator className="my-1" />
                  <DetailItem label="Misc. Charges" value={productData.miscCharges} currency="PKR " />
                </>
              )}
            </CardContent>
          </Card>
          
         {!productData.isCustomPrice && (
            <Card>
              <CardHeader><CardTitle className="text-xl">Specifications & Details</CardTitle></CardHeader>
              <CardContent>
                <DetailItem label="Primary Metal" value={productData.metalType.charAt(0).toUpperCase() + productData.metalType.slice(1)} icon={<Shield className="w-4 h-4" />} />
                {productData.metalType === 'gold' && productData.karat && (
                    <>
                    <Separator className="my-1" />
                    <DetailItem label="Primary Metal Karat" value={productData.karat.toUpperCase()} icon={<Zap className="w-4 h-4" />} />
                    </>
                )}
                <Separator className="my-1" />
                <DetailItem label="Primary Metal Weight" value={productData.metalWeightG} icon={<Weight className="w-4 h-4" />} unit="grams" />
                
                {productData.secondaryMetalType && productData.secondaryMetalWeightG && (
                  <>
                      <Separator className="my-2 border-dashed" />
                      <DetailItem label="Secondary Metal" value={productData.secondaryMetalType.charAt(0).toUpperCase() + productData.secondaryMetalType.slice(1)} icon={<Shield className="w-4 h-4" />} />
                       {productData.secondaryMetalType === 'gold' && productData.secondaryMetalKarat && (
                          <>
                          <Separator className="my-1" />
                          <DetailItem label="Secondary Metal Karat" value={productData.secondaryMetalKarat.toUpperCase()} icon={<Zap className="w-4 h-4" />} />
                          </>
                      )}
                      <Separator className="my-1" />
                      <DetailItem label="Secondary Metal Weight" value={productData.secondaryMetalWeightG} icon={<Weight className="w-4 h-4" />} unit="grams" />
                  </>
                )}
                
                <Separator className="my-1" />
                <DetailItem label="Wastage" value={productData.wastagePercentage} unit="%" />
                <Separator className="my-1" />
                <DetailItem label="Contains Diamonds" value={productData.hasDiamonds} icon={<Diamond className="w-4 h-4" />} />
                 {(productData.stoneDetails || productData.diamondDetails) && <Separator className="my-1" />}
                {productData.stoneDetails && (
                   <div className="py-2">
                      <p className="text-sm text-muted-foreground flex items-center mb-1"><Gem className="w-4 h-4 mr-2" /> Secondary Metal &amp; Stone Details</p>
                      <p className="text-sm whitespace-pre-wrap font-medium bg-muted/50 p-2 rounded-md">{productData.stoneDetails}</p>
                   </div>
                )}
                 {productData.diamondDetails && (
                   <div className="py-2">
                      <p className="text-sm text-muted-foreground flex items-center mb-1"><Diamond className="w-4 h-4 mr-2" /> Diamond Details</p>
                      <p className="text-sm whitespace-pre-wrap font-medium bg-muted/50 p-2 rounded-md">{productData.diamondDetails}</p>
                   </div>
                )}
              </CardContent>
            </Card>
         )}
        </div>

        <div className="md:col-span-1 space-y-6 order-1 md:order-2">
           <div className="flex md:flex-col gap-2">
             <Button asChild variant="outline" className="w-full">
                <Link href={`/products/${sku}/edit`} passHref legacyBehavior>
                  <a><Edit3 className="mr-2 h-4 w-4" /> Edit</a>
                </Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete the product.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteProduct}>Delete</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-lg">Product Image</CardTitle></CardHeader>
              <CardContent>
                 <div className="relative w-full aspect-square bg-muted rounded-md overflow-hidden">
                    <Image
                    src={productData.imageUrl || `https://placehold.co/400x400.png?text=${encodeURIComponent(productData.name)}`}
                    alt={productData.name}
                    fill
                    style={{ objectFit: "cover" }}
                    data-ai-hint="jewelry item"
                    priority={false}
                    />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-medium">Export & QR Code</CardTitle>
                <QrCodeIcon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center p-4 space-y-3">
                <QRCode id={`qr-${sku}`} value={productData.sku} size={128} level="H" style={{ display: 'none' }} />
                
                {qrCodeDataUrl ? (
                  <Image src={qrCodeDataUrl} alt={`QR Code for ${productData.sku}`} width={128} height={128} />
                ) : (
                  <div className="w-32 h-32 bg-gray-200 flex items-center justify-center text-sm text-gray-500 rounded-md">Generating QR...</div>
                )}
                <Button variant="outline" size="sm" onClick={handleExportCsv} className="w-full">
                  <Download className="mr-2 h-4 w-4" /> Export CSV for this Item
                </Button>
                 <p className="text-xs text-muted-foreground text-center">Use this to import into a label printing app like WEPrint.</p>
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}



