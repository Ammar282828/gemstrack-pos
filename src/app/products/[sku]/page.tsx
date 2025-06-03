
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode.react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { useAppStore, selectProductWithCosts, selectCategoryTitleById, Settings, KaratValue, MetalType, ProductTagFormat, AVAILABLE_TAG_FORMATS, DEFAULT_TAG_FORMAT_ID } from '@/lib/store';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";


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
  const [selectedTagFormatId, setSelectedTagFormatId] = useState<string>(DEFAULT_TAG_FORMAT_ID);

  // Effect 1: Sync local qrCodeDataUrl state from the store's productData.qrCodeDataUrl
  useEffect(() => {
    if (productData?.qrCodeDataUrl) {
      setQrCodeDataUrl(productData.qrCodeDataUrl);
    } else {
      setQrCodeDataUrl(undefined);
    }
  }, [productData?.qrCodeDataUrl]);

  // Effect 2: Generate and save QR code to the store IF it's not already there and component is hydrated
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
              console.warn(`[GemsTrack] QR Canvas for ${sku} was blank or toDataURL returned minimal data. Generation skipped.`);
            }
          } catch (e) {
            console.error("Error generating QR code data URL for store:", e);
            toast({ title: "QR Code Error", description: "Failed to generate and save QR code image.", variant: "destructive"});
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

  const generateTagPDF = (
    product: NonNullable<ProductWithCalculatedCosts>,
    qrDataUrl: string,
    settingsData: Settings,
    format: ProductTagFormat
  ) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [format.widthMillimeters, format.heightMillimeters],
    });
    // jsPDF might create a default page, remove it before adding our custom sized one.
    if (doc.getNumberOfPages() > 0) {
        doc.deletePage(1);
    }
    doc.addPage([format.widthMillimeters, format.heightMillimeters], 'portrait');


    const drawActualContent = (logoImage?: HTMLImageElement) => {
      if (format.layoutType === 'dumbbell') {
        const panelHeight = (format.heightMillimeters - 8) / 2; // Assuming 8mm connector
        const connectorHeight = 8;
        const padding = 1.5;
        const contentWidth = format.widthMillimeters - (padding * 2);

        // --- Top Panel (Logo & SKU) ---
        let currentYTop = padding;
        const logoMaxHeight = Math.min(6, panelHeight * 0.45);
        
        if (logoImage && settingsData.shopLogoUrl) {
          let logoDisplayWidth = logoImage.width;
          let logoDisplayHeight = logoImage.height;
          if (logoDisplayHeight > logoMaxHeight) {
            logoDisplayWidth = (logoMaxHeight / logoDisplayHeight) * logoDisplayWidth;
            logoDisplayHeight = logoMaxHeight;
          }
          if (logoDisplayWidth > contentWidth) {
            logoDisplayHeight = (contentWidth / logoDisplayWidth) * logoDisplayHeight;
            logoDisplayWidth = contentWidth;
          }
          const logoX = (format.widthMillimeters - logoDisplayWidth) / 2;
          doc.addImage(logoImage, 'PNG', logoX, currentYTop, logoDisplayWidth, logoDisplayHeight);
          currentYTop += logoDisplayHeight + 0.5;
        } else {
          doc.setFontSize(Math.min(6, panelHeight * 0.2));
          doc.setFont("helvetica", "bold");
          const shopNameLines = doc.splitTextToSize(settingsData.shopName, contentWidth);
          doc.text(shopNameLines, format.widthMillimeters / 2, currentYTop + (shopNameLines.length > 1 ? 1.5 : 2.5) , { align: 'center', maxWidth: contentWidth });
          currentYTop += (shopNameLines.length * (doc.getFontSize() / 2.5)) + 1;
        }

        doc.setFontSize(Math.min(5, panelHeight * 0.18));
        doc.setFont("helvetica", "normal");
        const skuText = `SKU: ${product.sku}`;
        const skuLines = doc.splitTextToSize(skuText, contentWidth);
         // Try to fit SKU at the bottom of the top panel
        const skuYPos = padding + panelHeight - (skuLines.length * (doc.getFontSize() / 2.8)) - padding/2;
        if (skuYPos > currentYTop) { // Ensure SKU doesn't overlap with logo/shop name
             doc.text(skuLines, format.widthMillimeters / 2, skuYPos, { align: 'center', maxWidth: contentWidth });
        } else { // Fallback if too much text for logo/shop name
            doc.text(skuLines, format.widthMillimeters / 2, currentYTop + 1, { align: 'center', maxWidth: contentWidth });
        }

        // --- Bottom Panel (QR, Weight, Karat) ---
        let currentYBottom = panelHeight + connectorHeight + padding;
        const qrMaxHeight = panelHeight * 0.7;
        const qrMaxWidth = contentWidth * 0.8;
        const qrIdealSize = Math.min(qrMaxHeight, qrMaxWidth, 12);
        const qrX = (format.widthMillimeters - qrIdealSize) / 2;
        
        if (qrDataUrl && qrDataUrl.startsWith("data:image/png")) {
          doc.addImage(qrDataUrl, 'PNG', qrX, currentYBottom, qrIdealSize, qrIdealSize);
        } else {
          doc.rect(qrX, currentYBottom, qrIdealSize, qrIdealSize);
          doc.setFontSize(4);
          doc.text("QR", qrX + qrIdealSize / 2, currentYBottom + qrIdealSize / 2, { align: 'center', baseline: 'middle' });
        }
        currentYBottom += qrIdealSize + 1;

        doc.setFontSize(Math.min(5, panelHeight * 0.18));
        const weightText = `Wt: ${product.metalWeightG.toFixed(2)}g`;
        const karatText = (product.metalType === 'gold' && product.karat) ? product.karat.toUpperCase() : "";
        
        const textYPos = currentYBottom + (doc.getFontSize() / 2.5);
        if (textYPos < format.heightMillimeters - padding) { // Check if text fits
            doc.text(weightText, padding, textYPos, {maxWidth: contentWidth * (karatText ? 0.6 : 0.9)});
            if (karatText) {
                doc.text(karatText, format.widthMillimeters - padding, textYPos, { align: 'right', maxWidth: contentWidth * 0.35 });
            }
        }


      } else if (format.layoutType === 'rectangle') {
        const padding = 1;
        const contentWidth = format.widthMillimeters - (padding * 2);
        const contentHeight = format.heightMillimeters - (padding * 2);
        let currentY = padding;

        const qrIdealSize = Math.min(contentWidth * 0.45, contentHeight * 0.7, 12);
        let qrActualSize = 0;
        if (qrDataUrl && qrDataUrl.startsWith("data:image/png")) {
            qrActualSize = qrIdealSize;
        }
        
        doc.setFontSize(Math.min(5.5, contentHeight * 0.15, contentWidth * 0.18)); // Dynamic font size

        const skuText = `SKU: ${product.sku}`;
        const weightTextLine = `Wt: ${product.metalWeightG.toFixed(2)}g` + ((product.metalType === 'gold' && product.karat) ? ` ${product.karat.toUpperCase()}` : "");
        
        // Attempt Logo or Shop Name at top
        const shopNameFontSize = Math.min(4.5, contentHeight * 0.12);
        let shopNameYOffset = 0;

        if (logoImage && settingsData.shopLogoUrl && contentHeight > 8) {
            const logoMaxH = Math.min(shopNameFontSize * 1.5, contentHeight * 0.2);
            const logoMaxW = contentWidth * 0.7;
            // Scale logo
            // ... (scaling logic as in dumbbell)
            let logoDisplayWidth = logoImage.width;
            let logoDisplayHeight = logoImage.height;
            if (logoDisplayHeight > logoMaxH) { /* scale */ logoDisplayWidth = (logoMaxH / logoDisplayHeight) * logoDisplayWidth; logoDisplayHeight = logoMaxH; }
            if (logoDisplayWidth > logoMaxW) { /* scale */ logoDisplayHeight = (logoMaxW / logoDisplayWidth) * logoDisplayHeight; logoDisplayWidth = logoMaxW; }

            doc.addImage(logoImage, 'PNG', (format.widthMillimeters - logoDisplayWidth)/2 , currentY, logoDisplayWidth, logoDisplayHeight);
            currentY += logoDisplayHeight + 0.5;
            shopNameYOffset = currentY;
        } else if (contentHeight > 6) {
            doc.setFontSize(shopNameFontSize);
            doc.setFont("helvetica", "bold");
            const shopNameLines = doc.splitTextToSize(settingsData.shopName, contentWidth);
            doc.text(shopNameLines[0], format.widthMillimeters/2, currentY + (shopNameFontSize/2.5), {align: 'center', maxWidth: contentWidth});
            currentY += (shopNameFontSize/2.5) + 0.5;
            shopNameYOffset = currentY;
            doc.setFontSize(Math.min(5.5, contentHeight * 0.15, contentWidth * 0.18)); // Reset for main content
            doc.setFont("helvetica", "normal");
        }


        // Layout: QR left, text right OR QR top, text bottom
        if (qrActualSize > 0 && contentWidth > qrActualSize + (doc.getTextWidth(skuText.substring(0,5))) && contentHeight > qrActualSize * 0.8) { // Side by side attempt
            const qrYPos = shopNameYOffset + (contentHeight - shopNameYOffset - qrActualSize) / 2 ; // Center QR vertically in remaining space
            doc.addImage(qrDataUrl, 'PNG', padding, Math.max(qrYPos, shopNameYOffset), qrActualSize, qrActualSize);
            
            let textX = padding + qrActualSize + padding / 2;
            let textBlockWidth = format.widthMillimeters - textX - padding;
            let textY = shopNameYOffset + (doc.getFontSize() / 2.5);

            const skuLinesRect = doc.splitTextToSize(skuText, textBlockWidth);
            doc.text(skuLinesRect, textX, textY, {maxWidth: textBlockWidth});
            textY += (skuLinesRect.length * (doc.getFontSize()/2.5)) + 0.5;

            const weightLinesRect = doc.splitTextToSize(weightTextLine, textBlockWidth);
            if (textY + (weightLinesRect.length * (doc.getFontSize()/2.5)) <= format.heightMillimeters - padding) {
                 doc.text(weightLinesRect, textX, textY, {maxWidth: textBlockWidth});
            }

        } else { // Stacked layout
            if (qrActualSize > 0 && (currentY + qrActualSize + (doc.getFontSize()/2.5 * 2) < format.heightMillimeters - padding )) {
                doc.addImage(qrDataUrl, 'PNG', (format.widthMillimeters - qrActualSize)/2, currentY, qrActualSize, qrActualSize);
                currentY += qrActualSize + 0.5;
            }
            currentY += (doc.getFontSize()/3); // Small gap
            const skuLinesRectSt = doc.splitTextToSize(skuText, contentWidth);
            doc.text(skuLinesRectSt, format.widthMillimeters/2, currentY, {align: 'center', maxWidth: contentWidth});
            currentY += (skuLinesRectSt.length * (doc.getFontSize()/2.5)) + 0.5;

            const weightLinesRectSt = doc.splitTextToSize(weightTextLine, contentWidth);
             if (currentY + (weightLinesRectSt.length * (doc.getFontSize()/2.5)) <= format.heightMillimeters - padding) {
                doc.text(weightLinesRectSt, format.widthMillimeters/2, currentY, {align: 'center', maxWidth: contentWidth});
            }
        }
      } else {
        doc.text(`Unsupported layout: ${format.layoutType}`, 5, 10);
      }

      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
      toast({ title: "Tag Ready", description: `Product tag PDF generated using format: ${format.name}` });
    };

    // Determine if logo needs to be loaded
    const needsLogo = settingsData.shopLogoUrl && (
        format.layoutType === 'dumbbell' ||
        (format.layoutType === 'rectangle' && format.heightMillimeters > 8) // Only load for reasonably sized rect tags
    );

    if (needsLogo) {
        const img = new window.Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => { drawActualContent(img); };
        img.onerror = () => { console.warn("Failed to load logo for PDF tag."); drawActualContent(); };
        img.src = settingsData.shopLogoUrl;
    } else {
        drawActualContent();
    }
  };


  const handlePrintTag = () => {
    if (!productData) {
      toast({ title: "Error", description: "Product data not available for printing.", variant: "destructive" });
      return;
    }
    if (!qrCodeDataUrl) {
      toast({ title: "QR Code Not Ready", description: "QR code image is not yet available. Please wait a moment or try refreshing.", variant: "destructive" });
      return;
    }
    const selectedFormat = AVAILABLE_TAG_FORMATS.find(f => f.id === selectedTagFormatId) || AVAILABLE_TAG_FORMATS[0];
    generateTagPDF(productData, qrCodeDataUrl, settings, selectedFormat);
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
                {productData && <QRCode id={`qr-${sku}`} value={productData.sku} size={128} level="H" style={{ display: 'none' }} />}
                
                {qrCodeDataUrl ? (
                  <Image src={qrCodeDataUrl} alt={`QR Code for ${productData.sku}`} width={128} height={128} />
                ) : (
                  <div className="w-32 h-32 bg-gray-200 flex items-center justify-center text-sm text-gray-500 rounded-md">Generating QR...</div>
                )}
                <div className="w-full space-y-2">
                  <Label htmlFor="tag-format-select">Tag Format</Label>
                  <Select value={selectedTagFormatId} onValueChange={setSelectedTagFormatId}>
                    <SelectTrigger id="tag-format-select">
                      <SelectValue placeholder="Select tag format" />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_TAG_FORMATS.map(format => (
                        <SelectItem key={format.id} value={format.id}>
                          {format.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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


    