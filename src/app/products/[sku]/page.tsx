
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode.react';
import jsPDF from 'jspdf';
import 'jspdf-autotable'; 
import { useAppStore, selectProductWithCosts, selectCategoryTitleById, Product, calculateProductCosts, Customer, Settings } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, Printer, QrCode as QrCodeIcon, ArrowLeft, IndianRupee, Weight, Shapes, User } from 'lucide-react';
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


type ProductWithCosts = Product & ReturnType<typeof calculateProductCosts>;

// Extend jsPDF with autoTable typings
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const DetailItem: React.FC<{ label: string; value: string | number | undefined; icon?: React.ReactNode, unit?: string }> = ({ label, value, icon, unit }) => (
  <div className="flex justify-between items-center py-2">
    <div className="flex items-center text-muted-foreground">
      {icon && <span className="mr-2">{icon}</span>}
      <span>{label}</span>
    </div>
    <span className="font-medium text-foreground">
      {typeof value === 'number' ? value.toLocaleString() : value || '-'} {unit}
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
  const customer = useAppStore(state => productData?.assignedCustomerId ? state.customers.find(c => c.id === productData.assignedCustomerId) : undefined);
  const deleteProductAction = useAppStore(state => state.deleteProduct);
  const setProductQrCodeDataUrl = useAppStore(state => state.setProductQrCode);


  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | undefined>(productData?.qrCodeDataUrl);


  useEffect(() => {
    if (productData && !productData.qrCodeDataUrl) {
      const canvas = document.getElementById(`qr-${sku}`) as HTMLCanvasElement;
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        setQrCodeDataUrl(dataUrl);
        setProductQrCodeDataUrl(sku, dataUrl);
      }
    } else if (productData?.qrCodeDataUrl) {
      setQrCodeDataUrl(productData.qrCodeDataUrl);
    }
  }, [productData, sku, setProductQrCodeDataUrl]);

  const handleDeleteProduct = () => {
    deleteProductAction(sku);
    toast({ title: "Product Deleted", description: `Product with SKU ${sku} has been deleted.` });
    router.push('/products');
  };
  
  const handlePrintTag = () => {
    if (!productData || !qrCodeDataUrl) {
      toast({ title: "Error", description: "Product data or QR code not available for printing.", variant: "destructive" });
      return;
    }

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [70, 30] // Example tag size: 70mm x 30mm
    });

    // Simple Tag Layout
    doc.setFontSize(8);
    doc.text(productData.name, 3, 5);
    doc.setFontSize(6);
    doc.text(`SKU: ${productData.sku}`, 3, 9);
    doc.text(`Metal: ${productData.metalWeightG}g`, 3, 13);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`₹${productData.totalPrice.toLocaleString()}`, 3, 20);
    
    // Add QR Code
    // Ensure qrCodeDataUrl is a PNG data URL
    if (qrCodeDataUrl.startsWith("data:image/png")) {
         doc.addImage(qrCodeDataUrl, 'PNG', 45, 3, 24, 24); // Adjust position and size as needed
    } else {
        console.warn("QR code is not in PNG format, skipping image on PDF.");
        doc.text("[QR Placeholder]", 45, 15);
    }


    doc.rect(1, 1, 68, 28); // Border for the tag

    // Open print dialog
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    
    toast({ title: "Tag Ready", description: "Jewellery tag PDF generated." });
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
              <Button asChild variant="outline">
                <Link href={`/products/${sku}/edit`}>
                  <Edit3 className="mr-2 h-4 w-4" /> Edit
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
                    layout="fill"
                    objectFit="cover"
                    data-ai-hint="jewelry piece"
                    />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-medium">QR Code</CardTitle>
                <QrCodeIcon className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center p-4">
                {/* Hidden canvas for QR code data URL generation */}
                <QRCode id={`qr-${sku}`} value={productData.sku} size={128} level="H" style={{ display: 'none' }} />
                {/* Visible QR Code using img tag with data URL */}
                {qrCodeDataUrl ? (
                  <Image src={qrCodeDataUrl} alt={`QR Code for ${productData.sku}`} width={128} height={128} />
                ) : (
                  <div className="w-32 h-32 bg-gray-200 flex items-center justify-center text-sm text-gray-500">Generating QR...</div>
                )}
                <Button variant="outline" size="sm" onClick={handlePrintTag} className="mt-4">
                  <Printer className="mr-2 h-4 w-4" /> Print Tag
                </Button>
              </CardContent>
            </Card>
            
            {customer && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Assigned Customer</CardTitle></CardHeader>
                <CardContent>
                  <DetailItem label="Name" value={customer.name} icon={<User className="w-4 h-4" />} />
                  {customer.phone && <DetailItem label="Phone" value={customer.phone} />}
                  {customer.email && <DetailItem label="Email" value={customer.email} />}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-xl">Pricing Details</CardTitle></CardHeader>
              <CardContent>
                <div className="bg-primary/10 p-4 rounded-lg mb-4 text-center">
                  <p className="text-sm text-primary font-medium">TOTAL PRICE</p>
                  <p className="text-4xl font-bold text-primary flex items-center justify-center">
                    <IndianRupee className="h-7 w-7 mr-1" />
                    {productData.totalPrice.toLocaleString()}
                  </p>
                </div>
                <DetailItem label="Gold Rate" value={settings.goldRatePerGram} unit="/ gram" />
                <Separator className="my-1" />
                <DetailItem label="Metal Cost" value={productData.metalCost} />
                <DetailItem label="Wastage Cost" value={productData.wastageCost} />
                <DetailItem label="Making Cost" value={productData.makingCost} />
                <DetailItem label="Stone Cost" value={productData.stoneCost} />
                <DetailItem label="Misc. Charges" value={productData.miscCharges} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-xl">Specifications</CardTitle></CardHeader>
              <CardContent>
                <DetailItem label="Metal Weight" value={productData.metalWeightG} icon={<Weight className="w-4 h-4" />} unit="grams" />
                <Separator className="my-1" />
                <DetailItem label="Stone Weight" value={productData.stoneWeightCt} icon={<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.27A21.64 21.64 0 0 1 12 3a21.64 21.64 0 0 1 6 0.27V5.5a21.64 21.64 0 0 0-6 15.23A21.64 21.64 0 0 0 6 5.5V3.27Z"></path><path d="M12 15.5V21"></path><path d="M12 3v3.05"></path><path d="M17.83 4.53c2.22 0 3.17 1.34 3.17 2.69 0 .84-.47 1.41-1.12 1.88L18 9.93"></path><path d="M6.17 4.53c-2.22 0-3.17 1.34-3.17 2.69 0 .84-.47 1.41 1.12 1.88L6 9.93"></path></svg>} unit="carats" />
                <Separator className="my-1" />
                <DetailItem label="Wastage" value={productData.wastagePercentage} unit="%" />
                <Separator className="my-1" />
                <DetailItem label="Making Rate" value={productData.makingRatePerG} unit="/ gram" />
                <Separator className="my-1" />
                <DetailItem label="Stone Rate" value={productData.stoneRatePerCt} unit="/ carat" />
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
