
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode.react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { useAppStore, selectProductWithCosts, selectCategoryTitleById, Product, Settings, KaratValue, MetalType } from '@/lib/store';
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


  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | undefined>(productData?.qrCodeDataUrl);


  useEffect(() => {
    if (productData && !productData.qrCodeDataUrl) {
      const canvas = document.getElementById(`qr-${sku}`) as HTMLCanvasElement;
      if (canvas) {
        try {
            const dataUrl = canvas.toDataURL('image/png');
            setQrCodeDataUrl(dataUrl);
            setProductQrCodeDataUrlAction(sku, dataUrl);
        } catch (e) {
            console.error("Error generating QR code data URL:", e);
            toast({ title: "QR Code Error", description: "Could not generate QR code image for the tag.", variant: "destructive"});
        }
      }
    } else if (productData?.qrCodeDataUrl) {
      setQrCodeDataUrl(productData.qrCodeDataUrl);
    }
  }, [productData, sku, setProductQrCodeDataUrlAction, toast]);

  const handleDeleteProduct = () => {
    deleteProductAction(sku);
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
    router.push('/products');
  };

  const generateTagPDF = (product: NonNullable<ProductWithCalculatedCosts>, qrUrl: string, settingsData: Settings) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [20, 50] }); // Unfolded dimensions
    const tagWidth = 20;
    const tagHeight = 50;
    const panelHeight = 21; // Approx height for each panel
    const connectorHeight = tagHeight - (2 * panelHeight); // Approx 8mm
    const padding = 1.5;

    // --- Top Panel (Logo & SKU) ---
    let currentYTop = padding;

    // Shop Logo or Name
    if (settingsData.shopLogoUrl) {
      try {
        const img = new window.Image();
        img.crossOrigin = "Anonymous"; // Attempt to handle CORS if logo is external
        img.onload = () => {
          const logoMaxHeight = 6;
          const logoMaxWidth = tagWidth - (padding * 2);
          let logoDisplayWidth = img.width;
          let logoDisplayHeight = img.height;

          if (logoDisplayHeight > logoMaxHeight) {
            logoDisplayWidth = (logoMaxHeight / logoDisplayHeight) * logoDisplayWidth;
            logoDisplayHeight = logoMaxHeight;
          }
          if (logoDisplayWidth > logoMaxWidth) {
            logoDisplayHeight = (logoMaxWidth / logoDisplayWidth) * logoDisplayHeight;
            logoDisplayWidth = logoMaxWidth;
          }
          const logoX = (tagWidth - logoDisplayWidth) / 2;
          doc.addImage(settingsData.shopLogoUrl!, 'PNG', logoX, currentYTop, logoDisplayWidth, logoDisplayHeight);
          currentYTop += logoDisplayHeight + 1; // Move Y down after logo
          drawSkuAndContinue();
        };
        img.onerror = () => {
          console.warn("Failed to load logo for PDF tag. Using shop name.");
          doc.setFontSize(5);
          doc.setFont("helvetica", "bold");
          doc.text(settingsData.shopName.substring(0,12), tagWidth / 2, currentYTop + 2, { align: 'center', maxWidth: tagWidth - (padding * 2) });
          currentYTop += 4;
          drawSkuAndContinue();
        };
        img.src = settingsData.shopLogoUrl; 
      } catch (e) {
        console.error("Error processing logo for PDF:", e);
        doc.setFontSize(5);
        doc.setFont("helvetica", "bold");
        doc.text(settingsData.shopName.substring(0,12), tagWidth / 2, currentYTop + 2, { align: 'center', maxWidth: tagWidth - (padding * 2) });
        currentYTop += 4;
        drawSkuAndContinue();
      }
    } else {
      doc.setFontSize(5);
      doc.setFont("helvetica", "bold");
      doc.text(settingsData.shopName.substring(0,12), tagWidth / 2, currentYTop + 2, { align: 'center', maxWidth: tagWidth - (padding * 2) });
      currentYTop += 4;
      drawSkuAndContinue();
    }

    function drawSkuAndContinue() {
        // SKU
        doc.setFontSize(6);
        doc.setFont("helvetica", "normal");
        doc.text(product.sku, tagWidth / 2, currentYTop + 3, { align: 'center', maxWidth: tagWidth - (padding * 2) });
        
        // --- Bottom Panel (QR, Weight, Karat) ---
        let currentYBottom = panelHeight + connectorHeight + padding;
        const qrSize = 12; 
        const qrX = (tagWidth - qrSize) / 2;
        if (qrUrl && qrUrl.startsWith("data:image/png")) {
            doc.addImage(qrUrl, 'PNG', qrX, currentYBottom, qrSize, qrSize);
        } else {
            doc.rect(qrX, currentYBottom, qrSize, qrSize); // Placeholder
        }
        currentYBottom += qrSize + 2; // Space after QR

        // Weight
        doc.setFontSize(5);
        doc.text(`Wt: ${product.metalWeightG.toFixed(2)}g`, padding, currentYBottom, {maxWidth: tagWidth - (padding * 2)});
        currentYBottom += 3;

        // Karat (if gold and available)
        if (product.metalType === 'gold' && product.karat) {
            doc.text(product.karat.toUpperCase(), padding, currentYBottom, {maxWidth: tagWidth - (padding * 2)});
        }
        
        // Finalize and print (if logo was async and this is the final step)
        if (!(settingsData.shopLogoUrl && !(img && img.complete && img.naturalHeight !== 0))) { // if logo is not async or already loaded
            doc.autoPrint();
            window.open(doc.output('bloburl'), '_blank');
            toast({ title: "Tag Ready", description: `Product tag PDF generated.` });
        }
    }
     // If logo is async, printing happens in img.onload or img.onerror
    if (!(settingsData.shopLogoUrl)) {
         drawSkuAndContinue(); // proceed if no logo
    }
  };


  const handlePrintTag = () => {
    if (!productData) {
      toast({ title: "Error", description: "Product data not available for printing.", variant: "destructive" });
      return;
    }
    if (!qrCodeDataUrl) {
         toast({ title: "Error", description: "QR code image not ready. Please wait a moment and try again.", variant: "destructive" });
         const canvas = document.getElementById(`qr-${sku}`) as HTMLCanvasElement;
         if (canvas) {
           try {
             const dataUrl = canvas.toDataURL('image/png');
             setQrCodeDataUrl(dataUrl);
             setProductQrCodeDataUrlAction(sku, dataUrl);
             toast({ title: "QR Generated", description: "QR code image was just generated. Please try printing the tag again."});
           } catch (e) {
             console.error("Error generating QR code data URL on demand:", e);
           }
         }
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
                <QRCode id={`qr-${sku}`} value={productData.sku} size={128} level="H" style={{ display: 'none' }} />
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
