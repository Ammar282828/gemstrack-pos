
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode.react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { useAppStore, selectProductWithCosts, selectCategoryTitleById, Settings, KaratValue, MetalType } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, Printer, QrCode as QrCodeIcon, ArrowLeft, Weight, Shapes, ShoppingCart, Diamond, Zap, Shield } from 'lucide-react';
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


type ProductWithCalculatedCosts = ReturnType<typeof selectProductWithCosts>;

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const DetailItem: React.FC<{ label: string; value: string | number | undefined | boolean; icon?: React.ReactNode, unit?: string, currency?: string }> = ({ label, value, icon, unit, currency }) => (
  <div className="flex justify-between items-center py-2">
    <div className="flex items-center text-muted-foreground">
      {icon && <span className="mr-2">{icon}</span>}
      <span>{label}</span>
    </div>
    <span className="font-medium text-foreground">
      {currency && value !== undefined && typeof value !== 'boolean' && <span className="mr-0.5">{currency}</span>}
      {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : typeof value === 'number' ? value.toLocaleString() : value || '-'} {unit}
    </span>
  </div>
);

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

  // Effect 1: Sync local qrCodeDataUrl state from the store's productData.qrCodeDataUrl
  useEffect(() => {
    if (productData?.qrCodeDataUrl) {
      setQrCodeDataUrl(productData.qrCodeDataUrl);
    } else {
      // If it's removed from store or productData is initially null/undefined, clear local state
      setQrCodeDataUrl(undefined);
    }
  }, [productData?.qrCodeDataUrl]); // Depend specifically on the qrCodeDataUrl string from the store

  // Effect 2: Generate and save QR code to the store IF it's not already there and component is hydrated
  useEffect(() => {
    // Only run if:
    // 1. Store is hydrated
    // 2. We have productData
    // 3. The store does NOT already have a qrCodeDataUrl for this product
    if (isHydrated && productData && !productData.qrCodeDataUrl) {
      const canvas = document.getElementById(`qr-${sku}`) as HTMLCanvasElement;
      if (canvas) {
        // Delay to allow QRCode.react component to render the canvas content
        const timerId = setTimeout(() => {
          try {
            const dataUrl = canvas.toDataURL('image/png');
            // Basic check to ensure canvas isn't blank
            if (dataUrl && dataUrl.length > 100 && dataUrl !== 'data:,') {
              // Update the store. Effect 1 will then sync it to local state.
              setProductQrCodeDataUrlAction(sku, dataUrl);
            } else {
              console.warn(`[GemsTrack] QR Canvas for ${sku} was blank or toDataURL returned minimal data. Generation skipped.`);
            }
          } catch (e) {
            console.error("Error generating QR code data URL for store:", e);
            toast({ title: "QR Code Error", description: "Failed to generate and save QR code image.", variant: "destructive"});
          }
        }, 150); // 150ms delay, adjust if necessary

        return () => clearTimeout(timerId); // Cleanup timeout if component unmounts
      }
    }
  }, [isHydrated, productData, sku, setProductQrCodeDataUrlAction, toast]);


  const handleDeleteProduct = () => {
    deleteProductAction(sku);
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
    router.push('/products');
  };

  const generateTagPDF = (product: NonNullable<ProductWithCalculatedCosts>, qrDataUrl: string, settingsData: Settings) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [20, 50] }); // Unfolded dumbbell tag: 20mm wide, 50mm tall
    const tagWidth = 20;
    const panelHeight = 21; // Height of each end panel (top and bottom)
    const connectorHeight = 8; // Height of the middle connecting strip
    const padding = 1.5; // Padding inside panels

    const drawFinalTagContent = (logoImage?: HTMLImageElement) => {
        // --- Top Panel (Logo & SKU) ---
        let currentYTop = padding;
        const logoMaxHeight = 6;
        const logoMaxWidth = tagWidth - (padding * 2);

        if (logoImage) {
            let logoDisplayWidth = logoImage.width;
            let logoDisplayHeight = logoImage.height;

            if (logoDisplayHeight > logoMaxHeight) {
                logoDisplayWidth = (logoMaxHeight / logoDisplayHeight) * logoDisplayWidth;
                logoDisplayHeight = logoMaxHeight;
            }
            if (logoDisplayWidth > logoMaxWidth) {
                logoDisplayHeight = (logoMaxWidth / logoDisplayWidth) * logoDisplayHeight;
                logoDisplayWidth = logoMaxWidth;
            }
            const logoX = (tagWidth - logoDisplayWidth) / 2;
            doc.addImage(logoImage, 'PNG', logoX, currentYTop, logoDisplayWidth, logoDisplayHeight);
            currentYTop += logoDisplayHeight + 1; // Space after logo
        } else {
            // Fallback to Shop Name if no logo or logo fails to load
            doc.setFontSize(6);
            doc.setFont("helvetica", "bold");
            doc.text(settingsData.shopName.substring(0, 12), tagWidth / 2, currentYTop + 3, { align: 'center', maxWidth: tagWidth - (padding * 2) });
            currentYTop += 4; // Space after shop name
        }

        // SKU below logo/shop name
        doc.setFontSize(5);
        doc.setFont("helvetica", "normal");
        doc.text(product.sku, tagWidth / 2, currentYTop + 1, { align: 'center', maxWidth: tagWidth - (padding * 2) });

        // --- Bottom Panel (QR, Weight, Karat) ---
        let currentYBottom = panelHeight + connectorHeight + padding; // Start Y for bottom panel

        // QR Code
        const qrSize = 12; // Max size for QR on this panel
        const qrX = (tagWidth - qrSize) / 2;
        if (qrDataUrl && qrDataUrl.startsWith("data:image/png")) {
            doc.addImage(qrDataUrl, 'PNG', qrX, currentYBottom, qrSize, qrSize);
        } else {
            doc.rect(qrX, currentYBottom, qrSize, qrSize); // Placeholder
            doc.setFontSize(4);
            doc.text("QR", qrX + qrSize / 2, currentYBottom + qrSize / 2, { align: 'center', baseline: 'middle' });
        }
        currentYBottom += qrSize + 1.5; // Space after QR

        // Weight
        doc.setFontSize(5);
        let weightText = `Wt: ${product.metalWeightG.toFixed(2)}g`;
        doc.text(weightText, padding, currentYBottom, { maxWidth: tagWidth - (padding * 2) - (product.karat ? 5 : 0) });

        // Karat (if gold and available)
        if (product.metalType === 'gold' && product.karat) {
            doc.text(product.karat.toUpperCase(), tagWidth - padding, currentYBottom, { align: 'right' });
        }
        // currentYBottom += 3; // Space for next line if any (not used here)

        doc.autoPrint();
        window.open(doc.output('bloburl'), '_blank');
        toast({ title: "Tag Ready", description: `Product tag PDF generated.` });
    };
    
    if (settingsData.shopLogoUrl) {
        const img = new window.Image();
        img.crossOrigin = "Anonymous"; // Important for loading external images into canvas/jsPDF
        img.onload = () => {
            drawFinalTagContent(img);
        };
        img.onerror = () => {
            console.warn("Failed to load logo for PDF tag. Using shop name as fallback.");
            drawFinalTagContent(); // Proceed without logo
        };
        img.src = settingsData.shopLogoUrl;
    } else {
        drawFinalTagContent(); // Proceed without logo if no URL is set
    }
  };

  const handlePrintTag = () => {
    if (!productData) {
      toast({ title: "Error", description: "Product data not available for printing.", variant: "destructive" });
      return;
    }
    // Rely on the useEffects to have populated the local qrCodeDataUrl state.
    if (!qrCodeDataUrl) {
      toast({ title: "QR Code Not Ready", description: "QR code image is not yet available. Please wait a moment or try refreshing.", variant: "destructive" });
      return;
    }
    generateTagPDF(productData, qrCodeDataUrl, settings);
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

  return (
    <div className="container mx-auto p-4">
      <Button variant="outline" onClick={() => router.back()} className="mb-6">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to List
      </Button>

      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/30">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <Badge variant="secondary" className="mb-2">
                <Shapes className="w-3 h-3 mr-1" /> {categoryTitle}
              </Badge>
              <CardTitle className="text-3xl">{productData.name}</CardTitle>
              <CardDescription>SKU: {productData.sku}</CardDescription>
            </div>
            <div className="flex space-x-2 mt-2 md:mt-0">
               <Button asChild variant="outline" className="whitespace-nowrap">
                <Link href={`/products/${sku}/edit`} passHref legacyBehavior>
                  <a>
                    <Edit3 className="mr-2 h-4 w-4" /> Edit
                  </a>
                </Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete the product.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteProduct}>Delete</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-lg">Product Image</CardTitle></CardHeader>
              <CardContent>
                 <div className="relative w-full aspect-square bg-muted rounded-md overflow-hidden">
                    <Image
                    src={productData.imageUrl || `https://placehold.co/400x400.png?text=${encodeURIComponent(productData.name)}`}
                    alt={productData.name}
                    fill
                    style={{ objectFit: "cover" }}
                    data-ai-hint="jewelry piece"
                    priority={false}
                    />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-medium">Product Tag</CardTitle>
                <QrCodeIcon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center p-4 space-y-3">
                {/* This QRCode component is only for generating the data, it's not displayed directly */}
                {productData && <QRCode id={`qr-${sku}`} value={productData.sku} size={128} level="H" style={{ display: 'none' }} />}
                
                {qrCodeDataUrl ? (
                  <Image src={qrCodeDataUrl} alt={`QR Code for ${productData.sku}`} width={128} height={128} />
                ) : (
                  <div className="w-32 h-32 bg-gray-200 flex items-center justify-center text-sm text-gray-500 rounded-md">Generating QR...</div>
                )}
                <Button variant="outline" size="sm" onClick={handlePrintTag} className="w-full">
                  <Printer className="mr-2 h-4 w-4" /> Print Product Tag
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-xl">Pricing Details</CardTitle></CardHeader>
              <CardContent>
                <div className="bg-primary/10 p-4 rounded-lg mb-4 text-center">
                  <p className="text-sm text-primary font-medium">TOTAL PRICE</p>
                  <p className="text-4xl font-bold text-primary flex items-center justify-center">
                    <span className="mr-1">PKR </span>
                    {productData.totalPrice.toLocaleString()}
                  </p>
                </div>
                 <Button size="lg" className="w-full mb-4" onClick={handleAddToCart}>
                    <ShoppingCart className="mr-2 h-5 w-5" /> Add to Cart
                </Button>
                {productData.metalType === 'gold' && (
                    <DetailItem label="Gold Rate (Store Setting, 24k)" value={settings.goldRatePerGram} unit="/ gram" currency="PKR " />
                )}
                {productData.metalType === 'palladium' && (
                    <DetailItem label="Palladium Rate (Store Setting)" value={settings.palladiumRatePerGram} unit="/ gram" currency="PKR " />
                )}
                {productData.metalType === 'platinum' && (
                    <DetailItem label="Platinum Rate (Store Setting)" value={settings.platinumRatePerGram} unit="/ gram" currency="PKR " />
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-xl">Specifications</CardTitle></CardHeader>
              <CardContent>
                <DetailItem label="Metal Type" value={productData.metalType.charAt(0).toUpperCase() + productData.metalType.slice(1)} icon={<Shield className="w-4 h-4" />} />
                {productData.metalType === 'gold' && productData.karat && (
                    <>
                    <Separator className="my-1" />
                    <DetailItem label="Karat" value={productData.karat.toUpperCase()} icon={<Zap className="w-4 h-4" />} />
                    </>
                )}
                <Separator className="my-1" />
                <DetailItem label="Metal Weight" value={productData.metalWeightG} icon={<Weight className="w-4 h-4" />} unit="grams" />
                <Separator className="my-1" />
                <DetailItem label="Wastage" value={productData.wastagePercentage} unit="%" />
                <Separator className="my-1" />
                <DetailItem label="Contains Diamonds" value={productData.hasDiamonds} icon={<Diamond className="w-4 h-4" />} />
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

