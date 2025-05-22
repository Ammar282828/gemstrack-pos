
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

type TagFormat = "detailed-landscape" | "compact-landscape" | "classic-vertical" | "price-focus-horizontal" | "dumbbell-vertical";


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

  const generateTagPDF = (product: NonNullable<ProductWithCalculatedCosts>, qrUrl: string, settingsData: Settings, format: TagFormat) => {
    let doc: jsPDF;
    let tagWidth: number, tagHeight: number;

    // --- Define dimensions and orientation for each format ---
    if (format === "detailed-landscape") {
        tagWidth = 70; tagHeight = 35;
        doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [tagWidth, tagHeight] });
    } else if (format === "compact-landscape") {
        tagWidth = 50; tagHeight = 25;
        doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [tagWidth, tagHeight] });
    } else if (format === "classic-vertical") {
        tagWidth = 25; tagHeight = 50;
        doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [tagWidth, tagHeight] });
    } else if (format === "price-focus-horizontal") {
        tagWidth = 60; tagHeight = 20;
        doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [tagWidth, tagHeight] });
    } else if (format === "dumbbell-vertical") {
        tagWidth = 20; tagHeight = 50; // Unfolded dimensions
        doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [tagWidth, tagHeight] });
    } else {
        toast({ title: "Error", description: "Unknown tag format.", variant: "destructive" });
        return;
    }

    const addQrCode = (x: number, y: number, size: number) => {
        if (qrUrl && qrUrl.startsWith("data:image/png")) {
            doc.addImage(qrUrl, 'PNG', x, y, size, size);
        } else {
            console.warn(`QR code is not in PNG format or missing for ${format} tag.`);
            doc.rect(x, y, size, size);
            doc.setFontSize(Math.min(size / 2, 4)); // Adjust text size for small QRs
            doc.text("[QR]", x + size / 2, y + size / 2, { align: 'center', baseline: 'middle' });
        }
    };
    
    const productName = product.name;
    const productSku = product.sku;
    const productPrice = `PKR ${product.totalPrice.toLocaleString()}`;
    let metalInfo = `${product.metalType.charAt(0).toUpperCase() + product.metalType.slice(1)}: ${product.metalWeightG.toFixed(2)}g`;
    if (product.metalType === 'gold' && product.karat) {
        metalInfo += ` (${product.karat.toUpperCase()})`;
    }
    const shopName = settingsData.shopName || "Your Shop";

    // --- Layout logic for each format ---
    if (format === "detailed-landscape") {
      const logoSectionWidth = 25;
      const detailsSectionX = logoSectionWidth + 2;
      const padding = 2;

      // Logo Side
      if (settingsData.shopLogoUrl) {
        try {
          const logoImg = new window.Image();
          logoImg.crossOrigin = "Anonymous";
          logoImg.onload = () => {
            const aspectRatio = logoImg.width / logoImg.height;
            let imgWidth = logoSectionWidth - (padding * 2);
            let imgHeight = imgWidth / aspectRatio;
            if (imgHeight > tagHeight - (padding * 2)) {
              imgHeight = tagHeight - (padding * 2);
              imgWidth = imgHeight * aspectRatio;
            }
            const imgX = padding + (logoSectionWidth - (padding * 2) - imgWidth) / 2;
            const imgY = padding + (tagHeight - (padding * 2) - imgHeight) / 2;
            doc.addImage(settingsData.shopLogoUrl!, 'PNG', imgX, imgY, imgWidth, imgHeight);
          };
          logoImg.onerror = () => {
            doc.setFontSize(6); doc.text(shopName.substring(0,12), logoSectionWidth/2, tagHeight/2, {align: "center"});
          }
          logoImg.src = settingsData.shopLogoUrl;
        } catch (e) {
            doc.setFontSize(6); doc.text(shopName.substring(0,12), logoSectionWidth/2, tagHeight/2, {align: "center"});
        }
      } else {
        doc.setFontSize(8); doc.text(shopName.substring(0,10), logoSectionWidth/2, tagHeight/2, {align: "center"});
      }
      doc.line(logoSectionWidth, padding, logoSectionWidth, tagHeight - padding); // Vertical separator

      // Details Side
      let currentY = padding + 2;
      if(settingsData.shopName) {
        doc.setFontSize(5); doc.text(settingsData.shopName, detailsSectionX, currentY);
        currentY +=3;
      }
      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(productName.substring(0, 28), detailsSectionX, currentY, {maxWidth: tagWidth - detailsSectionX - padding - 12}); // Leave space for QR
      currentY += (doc.getTextDimensions(productName.substring(0, 28), {maxWidth: tagWidth - detailsSectionX - padding - 12}).h) + 1;


      doc.setFontSize(6); doc.setFont("helvetica", "normal");
      doc.text(`SKU: ${productSku}`, detailsSectionX, currentY); currentY += 3;
      doc.text(metalInfo, detailsSectionX, currentY); currentY += 3;
      if (product.hasDiamonds) { doc.text(`Diamonds: Yes`, detailsSectionX, currentY); currentY += 3; }

      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text(productPrice, detailsSectionX, currentY + 1);

      addQrCode(tagWidth - padding - 15, tagHeight - padding - 15, 15);
      doc.rect(padding / 2, padding / 2, tagWidth - padding, tagHeight - padding);

    } else if (format === "compact-landscape") {
      const padding = 1.5;
      let currentY = padding + 2.5;
      const detailsWidth = tagWidth * 0.6;

      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(productName.substring(0, 20), padding, currentY, {maxWidth: detailsWidth - (padding * 2)}); currentY += 3.5;

      doc.setFontSize(5); doc.setFont("helvetica", "normal");
      doc.text(`SKU: ${productSku}`, padding, currentY); currentY += 2.5;
      doc.text(metalInfo, padding, currentY); currentY += 2.5;
      if (product.hasDiamonds) { doc.text(`Diamonds: Yes`, padding, currentY); currentY += 2.5; }

      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(productPrice, padding, currentY + 1);

      addQrCode(tagWidth - padding - 16, (tagHeight - 16) / 2, 16);
      doc.rect(padding / 2, padding / 2, tagWidth - padding, tagHeight - padding);

    } else if (format === "classic-vertical") {
        const padding = 2;
        let currentY = padding + 2;

        doc.setFontSize(6); doc.setFont("helvetica", "bold");
        doc.text(shopName.substring(0,15), tagWidth/2, currentY, {align: 'center'}); currentY += 3.5;

        doc.setFontSize(7); doc.setFont("helvetica", "bold");
        doc.text(productName.substring(0, 25), padding, currentY, {maxWidth: tagWidth - (padding*2)}); 
        currentY += (doc.getTextDimensions(productName.substring(0, 25), {maxWidth: tagWidth - (padding*2)}).h) + 1.5;


        doc.setFontSize(5); doc.setFont("helvetica", "normal");
        doc.text(`SKU: ${productSku}`, padding, currentY); currentY += 2.5;
        doc.text(metalInfo, padding, currentY); currentY += 2.5;
        if (product.hasDiamonds) { doc.text(`Diamonds: Yes`, padding, currentY); currentY += 2.5; }

        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text(productPrice, padding, currentY + 1); currentY += 4.5;
        
        const qrSize = Math.min(tagWidth - (padding * 2), 18);
        addQrCode((tagWidth - qrSize) / 2, currentY, qrSize);
        doc.rect(padding / 2, padding / 2, tagWidth - padding, tagHeight - padding);

    } else if (format === "price-focus-horizontal") {
        const padding = 1.5;
        let currentY = padding + 2;

        doc.setFontSize(5); doc.setFont("helvetica", "normal");
        doc.text(productName.substring(0, 30), padding, currentY, {maxWidth: tagWidth - (padding * 2)}); currentY += 2;
        
        doc.setFontSize(10); doc.setFont("helvetica", "bold");
        doc.text(productPrice, tagWidth / 2, currentY + 5, { align: 'center' }); currentY += 7;

        doc.setFontSize(5); doc.setFont("helvetica", "normal");
        doc.text(`SKU: ${productSku}`, padding, currentY + 1);
        
        const qrSize = Math.min(tagHeight - (padding * 2) - 2, 12); // Smaller QR
        addQrCode(tagWidth - padding - qrSize, currentY + 1 - qrSize, qrSize);
        doc.rect(padding / 2, padding / 2, tagWidth - padding, tagHeight - padding);
    } else if (format === "dumbbell-vertical") {
        const padding = 1;
        const rectHeight = (tagHeight - 10) / 2; // Height of top/bottom rectangles, leaving 10mm for connector

        // Top Rectangle (Folded Front/Top)
        let currentYTop = padding + 2;
        doc.setFontSize(5); doc.setFont("helvetica", "normal");
        doc.text(shopName.substring(0, 12), tagWidth/2, currentYTop, {align: 'center', maxWidth: tagWidth - (padding*2) });
        currentYTop += (doc.getTextDimensions(shopName.substring(0,12)).h) + 1;

        doc.setFontSize(7); doc.setFont("helvetica", "bold");
        doc.text(productPrice, tagWidth/2, currentYTop + 3, {align: 'center', maxWidth: tagWidth - (padding*2)});

        // Bottom Rectangle (Folded Back/Bottom)
        let currentYBottom = rectHeight + 10 + padding + 1.5; // Start after top rect and connector
        
        doc.setFontSize(5); doc.setFont("helvetica", "bold");
        doc.text(productName.substring(0,20), padding, currentYBottom, {maxWidth: tagWidth - (padding*2)});
        currentYBottom += (doc.getTextDimensions(productName.substring(0,20)).h) + 0.5;

        doc.setFontSize(4.5); doc.setFont("helvetica", "normal");
        doc.text(`SKU: ${productSku}`, padding, currentYBottom, {maxWidth: tagWidth - (padding*2)}); currentYBottom += 2;
        doc.text(metalInfo.substring(0,25), padding, currentYBottom, {maxWidth: tagWidth - (padding*2)}); currentYBottom += 2;
        if (product.hasDiamonds) { doc.text(`Diamonds: Yes`, padding, currentYBottom); currentYBottom += 2;}
        
        const qrSize = Math.min(tagWidth - (padding*2) -2, 10);
        addQrCode((tagWidth - qrSize)/2, currentYBottom + 0.5, qrSize);
        
        // Optional: draw faint lines for the rectangles if desired for visual aid
        // doc.setDrawColor(200, 200, 200); // Light gray
        // doc.rect(padding/2, padding/2, tagWidth - padding, rectHeight); // Top rectangle
        // doc.rect(padding/2, rectHeight + 10 + padding/2, tagWidth - padding, rectHeight); // Bottom rectangle
        // doc.rect(padding/2, padding/2, tagWidth-padding, tagHeight-padding); // Full outline
    }


    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    toast({ title: "Tag Ready", description: `Jewellery tag (${format.replace('-', ' ')}) PDF generated.` });
  };


  const handlePrintTag = (format: TagFormat) => {
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
    generateTagPDF(productData, qrCodeDataUrl, settings, format);
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
                <CardTitle className="text-lg font-medium">QR Code & Tag Printing</CardTitle>
                <QrCodeIcon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center p-4 space-y-3">
                <QRCode id={`qr-${sku}`} value={productData.sku} size={128} level="H" style={{ display: 'none' }} />
                {qrCodeDataUrl ? (
                  <Image src={qrCodeDataUrl} alt={`QR Code for ${productData.sku}`} width={128} height={128} />
                ) : (
                  <div className="w-32 h-32 bg-gray-200 flex items-center justify-center text-sm text-gray-500 rounded-md">Generating QR...</div>
                )}
                <Button variant="outline" size="sm" onClick={() => handlePrintTag("detailed-landscape")} className="w-full">
                  <Printer className="mr-2 h-4 w-4" /> Print Detailed Landscape Tag
                </Button>
                <Button variant="outline" size="sm" onClick={() => handlePrintTag("compact-landscape")} className="w-full">
                  <Printer className="mr-2 h-4 w-4" /> Print Compact Landscape Tag
                </Button>
                 <Button variant="outline" size="sm" onClick={() => handlePrintTag("classic-vertical")} className="w-full">
                  <Printer className="mr-2 h-4 w-4" /> Print Classic Vertical Tag
                </Button>
                 <Button variant="outline" size="sm" onClick={() => handlePrintTag("price-focus-horizontal")} className="w-full">
                  <Printer className="mr-2 h-4 w-4" /> Print Price Focus Tag
                </Button>
                <Button variant="outline" size="sm" onClick={() => handlePrintTag("dumbbell-vertical")} className="w-full">
                  <Printer className="mr-2 h-4 w-4" /> Print Dumbbell Vertical Tag
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

