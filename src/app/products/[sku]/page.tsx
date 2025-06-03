"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode.react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { useAppStore, selectProductWithCosts, selectCategoryTitleById, Settings, KaratValue, MetalType, ProductTagFormat, AVAILABLE_TAG_FORMATS, DEFAULT_TAG_FORMAT_ID, Product } from '@/lib/store';
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

// Reusable function to draw content of a single tag onto a jsPDF document at specified coordinates
export async function drawTagContentOnDoc(
  doc: jsPDF,
  product: NonNullable<ProductWithCalculatedCosts> | Product,
  qrDataUrl: string | undefined,
  settingsData: Settings,
  format: ProductTagFormat,
  startX: number,
  startY: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const drawActualContent = (logoImage?: HTMLImageElement) => {
      try {
        doc.setTextColor(0,0,0); // Ensure text color is black for actual content

        if (format.layoutType === 'dumbbell') {
          const panelWidth = format.widthMillimeters;
          const connectorStripVisualHeightOnCanvas = 8; // Height of the middle (connector) section on the PDF
          const panelHeight = (format.heightMillimeters - connectorStripVisualHeightOnCanvas) / 2;
          const padding = 1.5; 
          const contentWidth = panelWidth - (padding * 2);

          // --- Top Panel Drawing ---
          let currentYTop = startY + padding;
          const topPanelStartY = startY;
          const topPanelEndY = startY + panelHeight;

          // Logo or Shop Name on Top Panel
          const logoMaxHeight = Math.min(6, panelHeight * 0.4); // Max 40% of panel height for logo
          if (logoImage && settingsData.shopLogoUrl && panelHeight > logoMaxHeight + 3) { // Ensure enough space
            let logoDisplayWidth = logoImage.width;
            let logoDisplayHeight = logoImage.height;
            // Resize logo to fit
            if (logoDisplayHeight > logoMaxHeight) {
              logoDisplayWidth = (logoMaxHeight / logoDisplayHeight) * logoDisplayWidth;
              logoDisplayHeight = logoMaxHeight;
            }
            if (logoDisplayWidth > contentWidth) {
              logoDisplayHeight = (contentWidth / logoDisplayWidth) * logoDisplayHeight;
              logoDisplayWidth = contentWidth;
            }
            const logoX = startX + (panelWidth - logoDisplayWidth) / 2;
            doc.addImage(logoImage, 'PNG', logoX, currentYTop, logoDisplayWidth, logoDisplayHeight);
            currentYTop += logoDisplayHeight + 0.5; // Space after logo
          } else if (panelHeight > 5) { // Fallback to shop name if no logo or not enough space
            doc.setFontSize(Math.max(3, Math.min(5, panelHeight * 0.18)));
            doc.setFont("helvetica", "bold");
            const shopNameLines = doc.splitTextToSize(settingsData.shopName, contentWidth);
            const shopNameTextHeight = shopNameLines.length * (doc.getFontSize() / 2.5);
            const shopNameY = currentYTop + (shopNameLines.length > 1 ? (doc.getFontSize() * 0.2) : (doc.getFontSize() * 0.4));
            if (shopNameY + shopNameTextHeight < topPanelEndY - padding) {
                doc.text(shopNameLines, startX + panelWidth / 2, shopNameY , { align: 'center', maxWidth: contentWidth, baseline: 'top' });
                currentYTop += shopNameTextHeight + 1;
            }
          }
          
          // SKU on Top Panel (at the bottom of the top panel)
          doc.setFontSize(Math.max(3, Math.min(5, panelHeight * 0.16)));
          doc.setFont("helvetica", "normal");
          const skuText = `SKU: ${product.sku}`;
          const skuLines = doc.splitTextToSize(skuText, contentWidth);
          const skuTextHeight = skuLines.length * (doc.getFontSize() / 2.8);
          const skuYPos = topPanelEndY - skuTextHeight - padding / 2;

          if (skuYPos > currentYTop) { // Check if SKU fits below logo/shop name
               doc.text(skuLines, startX + panelWidth / 2, skuYPos, { align: 'center', maxWidth: contentWidth, baseline: 'alphabetic' });
          } else if (panelHeight > skuTextHeight + padding) { // Try to fit SKU if panel is high enough, even if it overlaps a bit
               doc.text(skuLines, startX + panelWidth / 2, topPanelEndY - padding /2 , { align: 'center', maxWidth: contentWidth, baseline: 'bottom' });
          }


          // --- Bottom Panel Drawing ---
          const bottomPanelStartY = startY + panelHeight + connectorStripVisualHeightOnCanvas;
          const bottomPanelEndY = startY + format.heightMillimeters;
          let currentYBottom = bottomPanelStartY + padding;

          // QR Code on Bottom Panel (centered, occupying significant portion)
          const qrMaxHeight = panelHeight * 0.65;
          const qrMaxWidth = contentWidth * 0.7;
          const qrIdealSize = Math.min(qrMaxHeight, qrMaxWidth, panelWidth * 0.7, 15); 
          const qrX = startX + (panelWidth - qrIdealSize) / 2;
          
          if (qrDataUrl && qrDataUrl.startsWith("data:image/png") && panelHeight > qrIdealSize + 3) {
            doc.addImage(qrDataUrl, 'PNG', qrX, currentYBottom, qrIdealSize, qrIdealSize);
            currentYBottom += qrIdealSize + 0.5; // Space after QR
          } else if (panelHeight > 5) { // Placeholder if no QR or not enough space
            const phSize = Math.min(qrIdealSize, panelHeight * 0.4, 8);
            doc.rect(startX + (panelWidth - phSize)/2, currentYBottom, phSize, phSize);
            doc.setFontSize(Math.max(2, phSize / 3));
            doc.text("QR?", startX + panelWidth/2 , currentYBottom + phSize/2, { align: 'center', baseline: 'middle' });
            currentYBottom += phSize + 0.5;
          }

          // Weight and Karat on Bottom Panel (at the bottom of the bottom panel)
          doc.setFontSize(Math.max(3, Math.min(5, panelHeight * 0.16)));
          const weightText = `Wt: ${product.metalWeightG.toFixed(2)}g`;
          const karatText = (product.metalType === 'gold' && product.karat) ? product.karat.toUpperCase() : "";
          
          const detailsLine = `${weightText}${karatText ? ` ${karatText}` : ''}`;
          const detailLines = doc.splitTextToSize(detailsLine, contentWidth);
          const detailTextHeight = detailLines.length * (doc.getFontSize() / 2.8);
          const detailYPos = bottomPanelEndY - detailTextHeight - padding / 2;


          if (detailYPos > currentYBottom) {
             doc.text(detailLines, startX + panelWidth / 2, detailYPos, { align: 'center', maxWidth: contentWidth, baseline: 'alphabetic' });
          } else if (panelHeight > detailTextHeight + padding) {
             doc.text(detailLines, startX + panelWidth / 2, bottomPanelEndY - padding/2, { align: 'center', maxWidth: contentWidth, baseline: 'bottom' });
          }

        } else if (format.layoutType === 'rectangle') {
          const padding = 1;
          const contentWidth = format.widthMillimeters - (padding * 2);
          const contentHeight = format.heightMillimeters - (padding * 2);
          let currentY = startY + padding;

          const qrIdealSize = Math.min(contentWidth * 0.45, contentHeight * 0.6, 12); // Slightly smaller QR for more text space
          let qrActualSize = 0;
          if (qrDataUrl && qrDataUrl.startsWith("data:image/png")) {
              qrActualSize = qrIdealSize;
          }
          
          const baseFontSize = Math.max(2.5, Math.min(5, contentHeight * 0.13, contentWidth * 0.15));
          doc.setFontSize(baseFontSize);

          const skuText = `SKU: ${product.sku}`;
          const weightTextLine = `Wt: ${product.metalWeightG.toFixed(2)}g` + ((product.metalType === 'gold' && product.karat) ? ` ${product.karat.toUpperCase()}` : "");
          
          const shopNameFontSize = Math.max(2.5, Math.min(4, contentHeight * 0.11));
          let shopNameYOffset = currentY;

          // Try to fit logo OR shop name
          if (logoImage && settingsData.shopLogoUrl && contentHeight > 7) { // If tag is reasonably tall
              const logoMaxH = Math.min(shopNameFontSize * 1.2, contentHeight * 0.18);
              const logoMaxW = contentWidth * 0.6;
              let logoDisplayWidth = logoImage.width;
              let logoDisplayHeight = logoImage.height;
              if (logoDisplayHeight > logoMaxH) { logoDisplayWidth = (logoMaxH / logoDisplayHeight) * logoDisplayWidth; logoDisplayHeight = logoMaxH; }
              if (logoDisplayWidth > logoMaxW) { logoDisplayHeight = (logoMaxW / logoDisplayWidth) * logoDisplayWidth; logoDisplayWidth = logoMaxW; }

              doc.addImage(logoImage, 'PNG', startX + (format.widthMillimeters - logoDisplayWidth)/2 , currentY, logoDisplayWidth, logoDisplayHeight);
              currentY += logoDisplayHeight + 0.5; // Small gap
              shopNameYOffset = currentY;
          } else if (contentHeight > 5) { // Else, if enough space for shop name
              doc.setFontSize(shopNameFontSize);
              doc.setFont("helvetica", "bold");
              const shopNameLines = doc.splitTextToSize(settingsData.shopName, contentWidth);
              doc.text(shopNameLines[0], startX + format.widthMillimeters/2, currentY + (shopNameFontSize/2.8), {align: 'center', maxWidth: contentWidth, baseline:'top'});
              currentY += (shopNameFontSize/2.5) + 0.5;
              shopNameYOffset = currentY;
              doc.setFontSize(baseFontSize); // Reset font size
              doc.setFont("helvetica", "normal");
          }

          // Attempt to place QR and text side-by-side if wide enough
          if (qrActualSize > 0 && contentWidth > qrActualSize + (doc.getTextWidth(skuText.substring(0,6))) * (baseFontSize/3) && contentHeight > qrActualSize * 0.7) {
              const textBlockStartY = shopNameYOffset;
              const qrYPos = textBlockStartY + ( (startY + format.heightMillimeters - padding) - textBlockStartY - qrActualSize) / 2 ; // Vertically center QR in remaining space
              
              doc.addImage(qrDataUrl!, 'PNG', startX + padding, Math.max(qrYPos, textBlockStartY), qrActualSize, qrActualSize);
              
              let textX = startX + padding + qrActualSize + padding / 2;
              let textBlockWidth = format.widthMillimeters - (textX - startX) - padding;
              let textY = textBlockStartY + (baseFontSize / 2.8); // Start text near top of available block

              const skuLinesRect = doc.splitTextToSize(skuText, textBlockWidth);
              if (textY + (skuLinesRect.length * (baseFontSize/2.5)) < startY + format.heightMillimeters - padding * 2) {
                doc.text(skuLinesRect, textX, textY, {maxWidth: textBlockWidth, baseline: 'top'});
                textY += (skuLinesRect.length * (baseFontSize/2.5)) + 0.5; // Small gap
              }

              const weightLinesRect = doc.splitTextToSize(weightTextLine, textBlockWidth);
              if (textY + (weightLinesRect.length * (baseFontSize/2.5)) <= startY + format.heightMillimeters - padding) {
                   doc.text(weightLinesRect, textX, textY, {maxWidth: textBlockWidth, baseline: 'top'});
              }
          } else { // Stack QR and text
              if (qrActualSize > 0 && (currentY + qrActualSize + (baseFontSize/2.5 * 1.5) < startY + format.heightMillimeters - padding )) {
                  doc.addImage(qrDataUrl!, 'PNG', startX + (format.widthMillimeters - qrActualSize)/2, currentY, qrActualSize, qrActualSize);
                  currentY += qrActualSize + 0.5;
              } else if (qrActualSize === 0 && contentHeight > 5) { 
                  const phSize = Math.min(contentWidth * 0.4, contentHeight*0.3, 6);
                  doc.rect(startX + (format.widthMillimeters - phSize)/2, currentY, phSize, phSize );
                  doc.setFontSize(Math.max(2, phSize / 2.5));
                  doc.text("QR?", startX + format.widthMillimeters/2, currentY + phSize/2, {align:'center', baseline:'middle'});
                  currentY += phSize + 0.5;
                  doc.setFontSize(baseFontSize); // Reset font size
              }
              
              currentY += (baseFontSize/3.5); // Small gap before text
              const skuLinesRectSt = doc.splitTextToSize(skuText, contentWidth);
              if (currentY + (skuLinesRectSt.length * (baseFontSize/2.5)) < startY + format.heightMillimeters - padding * 2) {
                doc.text(skuLinesRectSt, startX + format.widthMillimeters/2, currentY, {align: 'center', maxWidth: contentWidth, baseline: 'top'});
                currentY += (skuLinesRectSt.length * (baseFontSize/2.5)) + 0.5;
              }

              const weightLinesRectSt = doc.splitTextToSize(weightTextLine, contentWidth);
               if (currentY + (weightLinesRectSt.length * (baseFontSize/2.5)) <= startY + format.heightMillimeters - padding) {
                  doc.text(weightLinesRectSt, startX + format.widthMillimeters/2, currentY, {align: 'center', maxWidth: contentWidth, baseline: 'top'});
              }
          }
        } else {
          doc.text(`Unsupported layout: ${format.layoutType}`, startX + 5, startY + 10);
        }
        resolve(); 
      } catch (e) {
        console.error("Error during PDF drawing:", e);
        reject(e); 
      }
    };

    const needsLogo = settingsData.shopLogoUrl && (
        (format.layoutType === 'dumbbell' && format.heightMillimeters > 15) || // Dumbbell panels need some height
        (format.layoutType === 'rectangle' && format.heightMillimeters > 7) // Rectangles need some height
    );

    if (needsLogo && settingsData.shopLogoUrl) {
        const img = new window.Image();
        img.crossOrigin = "Anonymous"; // Important for tainted canvas in some environments
        img.onload = () => {
            drawActualContent(img);
        };
        img.onerror = (e) => {
            console.warn("Failed to load logo for PDF tag content. Drawing without logo. Error:", e);
            drawActualContent(); 
        };
        img.src = settingsData.shopLogoUrl;
    } else {
        drawActualContent(); 
    }
  });
}


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
            if (dataUrl && dataUrl.length > 100 && dataUrl !== 'data:,') { // Basic check for valid data URL
              setProductQrCodeDataUrlAction(sku, dataUrl); // This updates state and Firestore
            } else {
              console.warn(`[GemsTrack] QR Canvas for ${sku} was blank or toDataURL returned minimal data. Generation skipped for store update.`);
            }
          } catch (e) {
            console.error("Error generating QR code data URL for store update:", e);
            // Optionally toast, but might be too noisy if it happens often
            // toast({ title: "QR Code Error", description: "Failed to generate and save QR code image for store.", variant: "destructive"});
          }
        }, 150); // Delay to ensure canvas is rendered
        return () => clearTimeout(timerId);
      }
    }
  }, [isHydrated, productData, sku, setProductQrCodeDataUrlAction, toast]);


  const handleDeleteProduct = async () => {
    await deleteProductAction(sku);
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
    router.push('/products');
  };

  const generateSingleTagPDF = async (
    product: NonNullable<ProductWithCalculatedCosts>,
    qrDataUrlFromState: string | undefined,
    settingsData: Settings,
    format: ProductTagFormat
  ) => {
    
    let finalQrDataUrl = qrDataUrlFromState;
    if (!finalQrDataUrl && format.layoutType !== 'rectangle') { // Rectangles might attempt to draw without QR if very small
        // Attempt to generate QR on-the-fly if missing for critical formats
        const canvas = document.getElementById(`qr-${sku}`) as HTMLCanvasElement;
        if (canvas) {
          try {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 100 && dataUrl !== 'data:,') {
              await setProductQrCodeDataUrlAction(sku, dataUrl); // Save it to store/Firestore
              finalQrDataUrl = dataUrl; // Use it immediately
            }
          } catch(e) {
             console.warn(`[GemsTrack generateSingleTagPDF] On-the-fly QR generation failed for ${sku}:`, e);
          }
        }
        if (!finalQrDataUrl) { // If still no QR after trying
            toast({ title: "QR Code Not Ready", description: "QR code image is not yet available for this tag. Please wait or refresh.", variant: "destructive" });
            return;
        }
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [format.widthMillimeters, format.heightMillimeters],
    });
    if (doc.getNumberOfPages() > 0) { // Ensure we start with a fresh PDF if re-generating
        doc.deletePage(1);
    }
    doc.addPage([format.widthMillimeters, format.heightMillimeters], 'portrait');

    try {
      await drawTagContentOnDoc(doc, product, finalQrDataUrl, settingsData, format, 0, 0);
      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
      toast({ title: "Tag Ready", description: `Product tag PDF generated using format: ${format.name}` });
    } catch (error) {
      console.error("Error generating single tag PDF:", error);
      toast({ title: "PDF Generation Error", description: "Could not draw tag content.", variant: "destructive" });
    }
  };


  const handlePrintTag = async () => {
    if (!productData) {
      toast({ title: "Error", description: "Product data not available for printing.", variant: "destructive" });
      return;
    }
    
    const selectedFormat = AVAILABLE_TAG_FORMATS.find(f => f.id === selectedTagFormatId) || AVAILABLE_TAG_FORMATS[0];
    
    // qrCodeDataUrl is reactive state, should be up-to-date from useEffect
    await generateSingleTagPDF(productData, qrCodeDataUrl, settings, selectedFormat);
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
                    priority={false} // Can be false if not critical for LCP
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
                {/* Hidden QRCode component to generate data URL */}
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
                <Button variant="outline" size="sm" onClick={handlePrintTag} className="w-full" disabled={!qrCodeDataUrl && selectedTagFormatId !== 'rectangle-25x15' && selectedTagFormatId !== 'rectangle-30x20' /* Allow printing small rects without QR for now */}>
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
