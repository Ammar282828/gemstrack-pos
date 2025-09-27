

"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, KaratValue, calculateProductCosts, Order, OrderItem, Customer, MetalType, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Loader2, DollarSign, Weight, Zap, Diamond, Gem as GemIcon, FileText, Printer, PencilRuler, PlusCircle, Trash2, Camera, Link as LinkIcon, Hand, List, Upload, X, User, Phone, MessageSquare, Percent, Save, Ban, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import Image from 'next/image';
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
import 'react-phone-number-input/style.css'
import { Label } from '@/components/ui/label';

// Extend jsPDF interface for the autoTable plugin
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
     lastAutoTable: {
      finalY?: number;
    };
  }
}

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum', 'silver'];

// Schema for a single custom order item
const orderItemSchema = z.object({
  description: z.string().min(3, "Description is required"),
  karat: z.enum(karatValues).optional(),
  estimatedWeightG: z.coerce.number().min(0.1, "Weight must be a positive number"),
  wastagePercentage: z.coerce.number().min(0, "Wastage must be non-negative").default(0),
  makingCharges: z.coerce.number().min(0).default(0),
  diamondCharges: z.coerce.number().min(0).default(0),
  stoneCharges: z.coerce.number().min(0).default(0),
  sampleImageDataUri: z.string().optional(),
  referenceSku: z.string().optional(),
  sampleGiven: z.boolean().default(false),
  hasDiamonds: z.boolean().default(false),
  hasStones: z.boolean().default(false),
  stoneWeightG: z.coerce.number().min(0).default(0),
  stoneDetails: z.string().optional(),
  diamondDetails: z.string().optional(),
  metalType: z.enum(metalTypeValues).default('gold'),
  isCompleted: z.boolean().default(false),
});

// Schema for the main form which contains multiple items
const orderFormSchema = z.object({
    items: z.array(orderItemSchema).min(1, "You must add at least one item to the estimate."),
    goldRate18k: z.coerce.number().min(0),
    goldRate21k: z.coerce.number().min(0),
    goldRate22k: z.coerce.number().min(0),
    goldRate24k: z.coerce.number().min(0),
    advancePayment: z.coerce.number().min(0).default(0),
    advanceInExchangeDescription: z.string().optional(),
    advanceInExchangeValue: z.coerce.number().min(0).default(0),
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    customerContact: z.string().optional(),
}).refine(data => {
    const has18k = data.items.some(item => item.karat === '18k');
    const has21k = data.items.some(item => item.karat === '21k');
    const has22k = data.items.some(item => item.karat === '22k');
    const has24k = data.items.some(item => item.karat === '24k');
    if (has18k && data.goldRate18k <= 0) return false;
    if (has21k && data.goldRate21k <= 0) return false;
    if (has22k && data.goldRate22k <= 0) return false;
    if (has24k && data.goldRate24k <= 0) return false;
    return true;
}, {
    message: "A positive gold rate is required for each gold karat present in the order.",
    path: ["goldRate21k"], // Arbitrarily attach to one field
});


type OrderItemData = z.infer<typeof orderItemSchema>;
type OrderFormData = z.infer<typeof orderFormSchema>;

type EnrichedOrderFormData = OrderFormData & {
    id: string; // The generated order ID
    subtotal: number;
    grandTotal: number;
    items: (OrderItemData & { metalCost: number; totalEstimate: number; wastageCost: number; })[];
};

const WALK_IN_CUSTOMER_VALUE = "__WALK_IN__";

const ImageCapture: React.FC<{
  itemIndex: number;
  onImageSelect: (dataUri: string) => void;
  onImageRemove: () => void;
  currentImage?: string;
}> = ({ itemIndex, onImageSelect, onImageRemove, currentImage }) => {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ title: "Image too large", description: "Please select an image smaller than 5MB.", variant: "destructive" });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        onImageSelect(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error) {
      console.error("Error accessing camera:", error);
      toast({ title: "Camera Error", description: "Could not access the camera. Please check permissions.", variant: "destructive" });
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };
  
  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const dataUri = canvas.toDataURL('image/jpeg');
        onImageSelect(dataUri);
        setIsCameraOpen(false);
      }
    }
  };

  useEffect(() => {
    if (isCameraOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraOpen]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Upload Image
        </Button>
        <Input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
        
        <Dialog open={isCameraOpen} onOpenChange={setIsCameraOpen}>
            <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm"><Camera className="mr-2 h-4 w-4"/> Take Photo</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Take a Photo</DialogTitle>
                </DialogHeader>
                <video ref={videoRef} autoPlay playsInline className="w-full rounded-md border bg-muted"></video>
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <DialogFooter>
                    <Button onClick={handleCapture} disabled={!stream}>Capture</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </div>

      {currentImage && (
        <div className="relative w-32 h-32 mt-2 p-1 border rounded-md">
          <Image src={currentImage} alt={`Sample for item ${itemIndex + 1}`} fill className="object-contain" />
          <Button type="button" size="icon" variant="destructive" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={onImageRemove}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};


const ProductSearchDialog: React.FC<{ onAddProduct: (product: Product) => void }> = ({ onAddProduct }) => {
    const products = useAppStore(state => state.products);
    const [searchTerm, setSearchTerm] = useState('');
    const [open, setOpen] = useState(false);

    const filteredProducts = useMemo(() => {
        if (!searchTerm) return [];
        return products.filter(p => 
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
            p.sku.toLowerCase().includes(searchTerm.toLowerCase())
        ).slice(0, 50); // Limit results for performance
    }, [products, searchTerm]);

    const handleSelectProduct = (product: Product) => {
        onAddProduct(product);
        setSearchTerm('');
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button type="button" variant="secondary">
                    <PlusCircle className="mr-2 h-4 w-4"/> Add from Inventory
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Add Product from Inventory</DialogTitle>
                    <DialogDescription>
                        Search for an existing product to add it as a template for a new custom order item.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or SKU..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <ScrollArea className="h-[40vh] border rounded-md">
                        {filteredProducts.length > 0 ? (
                            <div className="p-2">
                                {filteredProducts.map(product => (
                                    <button
                                        key={product.sku}
                                        onClick={() => handleSelectProduct(product)}
                                        className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3"
                                    >
                                        <Image src={product.imageUrl || `https://placehold.co/40x40.png`} alt={product.name} width={40} height={40} className="rounded-md object-cover border" data-ai-hint="product jewelry" />
                                        <div>
                                            <p className="font-medium">{product.name}</p>
                                            <p className="text-xs text-muted-foreground">{product.sku}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="p-4 text-center text-sm text-muted-foreground">
                                {searchTerm ? 'No products found.' : 'Start typing to search...'}
                            </p>
                        )}
                    </ScrollArea>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


interface OrderFormProps {
    order?: Order;
}

export const OrderForm: React.FC<OrderFormProps> = ({ order }) => {
  const { toast } = useToast();
  const router = useRouter();
  const { settings, customers, isSettingsLoading, isCustomersLoading, loadSettings, loadCustomers, addOrder, updateOrder, products: allProducts } = useAppStore();
  const isEditMode = !!order;

  useEffect(() => {
    loadSettings();
    loadCustomers();
  }, [loadSettings, loadCustomers]);

  const form = useForm<OrderFormData>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      items: [],
      goldRate18k: 0, goldRate21k: 0, goldRate22k: 0, goldRate24k: 0,
      advancePayment: 0,
      advanceInExchangeDescription: '',
      advanceInExchangeValue: 0,
      customerId: WALK_IN_CUSTOMER_VALUE,
      customerName: '',
      customerContact: '',
    },
  });
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  useEffect(() => {
    const rates = order?.ratesApplied || settings;
    if (order) {
      form.reset({
        items: order.items.map(item => ({
            ...item,
            sampleImageDataUri: item.sampleImageDataUri || '',
            referenceSku: item.referenceSku || '',
            stoneDetails: item.stoneDetails || '',
            diamondDetails: item.diamondDetails || '',
        })),
        goldRate18k: rates.goldRatePerGram18k || 0,
        goldRate21k: rates.goldRatePerGram21k || 0,
        goldRate22k: rates.goldRatePerGram22k || 0,
        goldRate24k: rates.goldRatePerGram24k || 0,
        advancePayment: order.advancePayment || 0,
        advanceInExchangeDescription: order.advanceInExchangeDescription || '',
        advanceInExchangeValue: order.advanceInExchangeValue || 0,
        customerId: order.customerId || WALK_IN_CUSTOMER_VALUE,
        customerName: order.customerName || '',
        customerContact: order.customerContact || '',
      });
    } else if (!isEditMode && settings.goldRatePerGram21k > 0) {
      form.reset({
        ...form.getValues(),
        goldRate18k: settings.goldRatePerGram18k,
        goldRate21k: settings.goldRatePerGram21k,
        goldRate22k: settings.goldRatePerGram22k,
        goldRate24k: settings.goldRatePerGram24k,
      });
    }
  }, [order, settings, form, isEditMode]);


  const formValues = form.watch();
  const selectedCustomerId = form.watch('customerId');

  useEffect(() => {
    if (selectedCustomerId && selectedCustomerId !== WALK_IN_CUSTOMER_VALUE) {
        const customer = customers.find(c => c.id === selectedCustomerId);
        if (customer) {
            form.setValue('customerName', customer.name);
            form.setValue('customerContact', customer.phone || '');
        }
    }
  }, [selectedCustomerId, customers, form]);

  const liveEstimate = useMemo(() => {
    let subtotal = 0;
    const ratesForCalc = { 
        goldRatePerGram18k: formValues.goldRate18k || 0,
        goldRatePerGram21k: formValues.goldRate21k || 0,
        goldRatePerGram22k: formValues.goldRate22k || 0,
        goldRatePerGram24k: formValues.goldRate24k || 0,
        palladiumRatePerGram: settings.palladiumRatePerGram,
        platinumRatePerGram: settings.platinumRatePerGram,
        silverRatePerGram: settings.silverRatePerGram,
    };

    (formValues.items || []).forEach(item => {
        const { estimatedWeightG, karat, makingCharges, diamondCharges, stoneCharges, hasDiamonds, wastagePercentage, metalType, stoneWeightG, hasStones } = item;
        if (!estimatedWeightG || estimatedWeightG <= 0) return;

        const productForCalc = {
          categoryId: '', // Custom orders don't have a category, but the function needs it.
          metalType, karat, metalWeightG: estimatedWeightG,
          wastagePercentage: wastagePercentage, makingCharges, hasDiamonds,
          diamondCharges, stoneCharges, miscCharges: 0,
          stoneWeightG: stoneWeightG, 
          hasStones: hasStones,
        };
        
        const costs = calculateProductCosts(productForCalc, ratesForCalc);
        subtotal += costs.totalPrice;
    });

    const totalAdvance = (formValues.advancePayment || 0) + (formValues.advanceInExchangeValue || 0);
    const grandTotal = subtotal - totalAdvance;
    
    return { subtotal, grandTotal };
  }, [formValues, settings]);


  const onSubmit = async (data: OrderFormData) => {
    const { subtotal, grandTotal } = liveEstimate;
    const ratesForOrder: Partial<Settings> = {
        goldRatePerGram18k: data.goldRate18k || 0,
        goldRatePerGram21k: data.goldRate21k || 0,
        goldRatePerGram22k: data.goldRate22k || 0,
        goldRatePerGram24k: data.goldRate24k || 0,
        palladiumRatePerGram: settings.palladiumRatePerGram,
        platinumRatePerGram: settings.platinumRatePerGram,
        silverRatePerGram: settings.silverRatePerGram,
    };

    const enrichedItems: OrderItem[] = data.items.map((item) => {
        const { estimatedWeightG, karat, makingCharges, diamondCharges, stoneCharges, hasDiamonds, wastagePercentage, isCompleted, metalType, hasStones, stoneWeightG } = item;
        const productForCalc = {
          categoryId: '', // Custom orders don't have a category
          metalType, karat, metalWeightG: estimatedWeightG,
          wastagePercentage, makingCharges, hasDiamonds,
          diamondCharges, stoneCharges, miscCharges: 0, 
          hasStones, stoneWeightG
        };
        const costs = calculateProductCosts(productForCalc, ratesForOrder);
        return { ...item, isCompleted: isCompleted, metalType: item.metalType, metalCost: costs.metalCost, wastageCost: costs.wastageCost, totalEstimate: costs.totalPrice };
    });

    if (isEditMode && order) {
        const isWalkIn = data.customerId === WALK_IN_CUSTOMER_VALUE;
        const finalCustomerId = isWalkIn ? undefined : data.customerId;

        let finalCustomerName = data.customerName;
        if (!isWalkIn && finalCustomerId) {
            const customer = customers.find(c => c.id === finalCustomerId);
            if (customer) {
                finalCustomerName = customer.name;
            }
        }
        
        const updatedOrderData: Partial<Order> = {
            ...data,
            customerId: finalCustomerId,
            customerName: finalCustomerName || 'Walk-in Customer', // Ensure name is not undefined
            items: enrichedItems,
            ratesApplied: ratesForOrder,
            subtotal,
            grandTotal,
        };
        await updateOrder(order.id, updatedOrderData);
        toast({ title: "Order Updated", description: "The custom order has been successfully updated." });
        router.push(`/orders/${order.id}`);
    } else {
        const finalCustomerId = data.customerId === WALK_IN_CUSTOMER_VALUE ? undefined : data.customerId;
        let finalCustomerName = data.customerName;
        if (finalCustomerId) {
          const customer = customers.find(c => c.id === finalCustomerId);
          if (customer) {
            finalCustomerName = customer.name;
          }
        }

        const orderToSave: Omit<Order, 'id' | 'createdAt' | 'status'> = {
            items: enrichedItems,
            ratesApplied: ratesForOrder,
            advancePayment: data.advancePayment,
            advanceInExchangeDescription: data.advanceInExchangeDescription,
            advanceInExchangeValue: data.advanceInExchangeValue,
            subtotal,
            grandTotal,
            customerId: finalCustomerId,
            customerName: finalCustomerName,
            customerContact: data.customerContact,
        };

        const newOrder = await addOrder(orderToSave);

        if (newOrder) {
            toast({ title: `Order ${newOrder.id} Created`, description: "Custom order has been saved." });
            router.push(`/orders/${newOrder.id}`);
        } else {
            toast({ title: "Error", description: "Failed to save the custom order.", variant: "destructive" });
        }
    }
  };
  
  if (isSettingsLoading || isCustomersLoading) {
    return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Form...</p>
      </div>
    );
  }

    const handleAddInventoryProduct = (product: Product) => {
        append({
            description: product.name,
            karat: product.karat || '21k',
            estimatedWeightG: product.metalWeightG,
            wastagePercentage: product.wastagePercentage,
            makingCharges: product.makingCharges,
            diamondCharges: product.diamondCharges,
            stoneCharges: product.stoneCharges,
            sampleImageDataUri: product.imageUrl || '',
            referenceSku: product.sku,
            sampleGiven: false,
            hasDiamonds: product.hasDiamonds,
            stoneDetails: product.stoneDetails || '',
            diamondDetails: product.diamondDetails || '',
            metalType: product.metalType,
            isCompleted: false,
            stoneWeightG: product.stoneWeightG || 0,
            hasStones: product.hasStones || false,
        });
    };
  
  const handleAddNewItem = () => {
    append({
        description: '',
        karat: '21k',
        estimatedWeightG: 0,
        wastagePercentage: 10,
        makingCharges: 0,
        diamondCharges: 0,
        stoneCharges: 0,
        sampleImageDataUri: '',
        referenceSku: '',
        sampleGiven: false,
        hasDiamonds: false,
        stoneDetails: '',
        diamondDetails: '',
        metalType: 'gold',
        isCompleted: false,
        hasStones: false,
        stoneWeightG: 0,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <PencilRuler className="mr-3 h-6 w-6 text-primary"/>
                {isEditMode ? `Edit Order ${order?.id}` : 'Create Custom Order'}
              </CardTitle>
              <CardDescription>
                {isEditMode ? 'Update the details for this custom order.' : 'Add one or more items to generate a combined price estimate.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[60vh] pr-4 -mr-4">
                <div className="space-y-6">
                {fields.map((field, index) => (
                    <Card key={field.id} className="p-4 relative bg-muted/30">
                        <CardHeader className="p-0 pb-4">
                           <CardTitle className="text-lg">Item #{index + 1}</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 space-y-4">
                            {!isEditMode && (
                                <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={() => remove(index)}>
                                    <Trash2 className="h-4 w-4" />
                                    <span className="sr-only">Remove Item</span>
                                </Button>
                            )}
                            <FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (
                                <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="e.g., Custom 22k gold ring with ruby stone" {...field} rows={2}/></FormControl><FormMessage /></FormItem>
                            )}/>
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                               <FormField control={form.control} name={`items.${index}.metalType`} render={({ field }) => (
                                <FormItem><FormLabel>Metal</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                    <SelectContent>{metalTypeValues.map(m => <SelectItem key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent>
                                </Select><FormMessage /></FormItem>
                                )}/>
                                {form.watch(`items.${index}.metalType`) === 'gold' &&
                                    <FormField control={form.control} name={`items.${index}.karat`} render={({ field }) => (
                                        <FormItem><FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4"/>Karat</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                            <SelectContent>{karatValues.map(k => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}</SelectContent>
                                        </Select><FormMessage /></FormItem>
                                    )}/>
                                }
                                <FormField control={form.control} name={`items.${index}.estimatedWeightG`} render={({ field }) => (
                                    <FormItem><FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4"/>Est. Weight (g)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                             </div>
                              <FormField control={form.control} name={`items.${index}.wastagePercentage`} render={({ field }) => (
                                <FormItem><FormLabel className="flex items-center"><Percent className="mr-2 h-4 w-4"/>Wastage (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>
                            <Separator />
                            <p className="font-medium text-sm">Additional Charges & Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FormField control={form.control} name={`items.${index}.makingCharges`} render={({ field }) => (
                                    <FormItem><FormLabel className="flex items-center"><GemIcon className="mr-2 h-4 w-4"/>Making</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <FormField control={form.control} name={`items.${index}.diamondCharges`} render={({ field }) => (
                                    <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4"/>Diamonds</FormLabel><FormControl><Input type="number" {...field} disabled={!form.watch(`items.${index}.hasDiamonds`)} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <FormField control={form.control} name={`items.${index}.stoneCharges`} render={({ field }) => (
                                    <FormItem><FormLabel>Stones</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                            </div>
                            <div className="flex gap-4">
                                <FormField control={form.control} name={`items.${index}.hasDiamonds`} render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer">Item Contains Diamonds?</FormLabel></div></FormItem>
                                )}/>
                                <FormField control={form.control} name={`items.${index}.hasStones`} render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer">Item Contains Other Stones?</FormLabel></div></FormItem>
                                )}/>
                            </div>
                            {form.watch(`items.${index}.hasStones`) && <FormField control={form.control} name={`items.${index}.stoneWeightG`} render={({ field }) => (<FormItem><FormLabel>Stone Weight (grams)</FormLabel><FormControl><Input type="number" step="0.001" placeholder="e.g., 0.5" {...field} /></FormControl><FormMessage /></FormItem>)}/>}
                            {form.watch(`items.${index}.hasStones`) && <FormField control={form.control} name={`items.${index}.stoneDetails`} render={({ field }) => (
                               <FormItem><FormLabel className="flex items-center"><GemIcon className="mr-2 h-4 w-4"/>Stone Details</FormLabel><FormControl><Textarea placeholder="e.g., 1x Ruby (2ct), 4x Sapphire (0.5ct each)" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>}
                            {form.watch(`items.${index}.hasDiamonds`) &&
                              <FormField control={form.control} name={`items.${index}.diamondDetails`} render={({ field }) => (
                                 <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4"/>Diamond Details</FormLabel><FormControl><Textarea placeholder="e.g., Center: 1ct VVS1, Side: 12x 0.05ct VS2" {...field} /></FormControl><FormMessage /></FormItem>
                              )}/>
                            }

                            <Separator />
                            <p className="font-medium text-sm">Reference Details (Optional)</p>
                             <div>
                                <FormLabel className="flex items-center"><Camera className="mr-2 h-4 w-4"/>Sample Picture</FormLabel>
                                <FormField control={form.control} name={`items.${index}.sampleImageDataUri`} render={({ field }) => (
                                    <ImageCapture
                                        itemIndex={index}
                                        currentImage={field.value}
                                        onImageSelect={(dataUri) => form.setValue(`items.${index}.sampleImageDataUri`, dataUri, { shouldValidate: true, shouldDirty: true })}
                                        onImageRemove={() => form.setValue(`items.${index}.sampleImageDataUri`, '', { shouldValidate: true, shouldDirty: true })}
                                    />
                                )}/>
                             </div>

                            <FormField control={form.control} name={`items.${index}.referenceSku`} render={({ field }) => (
                               <FormItem><FormLabel className="flex items-center"><LinkIcon className="mr-2 h-4 w-4"/>Reference SKU</FormLabel><FormControl><Input placeholder="e.g., RIN-123456" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>

                            <FormField control={form.control} name={`items.${index}.sampleGiven`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer"><Hand className="mr-2 h-4 w-4"/>Customer provided a physical sample</FormLabel></div></FormItem>
                            )}/>

                            {isEditMode && <FormField control={form.control} name={`items.${index}.isCompleted`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer">Item is Completed</FormLabel></div></FormItem>
                            )}/>}
                        </CardContent>
                    </Card>
                ))}
                </div>
                </ScrollArea>
            </CardContent>
            <CardFooter className="flex gap-2">
                 <Button type="button" variant="outline" onClick={handleAddNewItem}>
                    <PlusCircle className="mr-2 h-4 w-4"/> Add Custom Item
                </Button>
                <ProductSearchDialog onAddProduct={handleAddInventoryProduct} />
            </CardFooter>
          </Card>
        </div>
        
        <div className="lg:col-span-1">
            <Card className="sticky top-8">
                <CardHeader>
                    <CardTitle className="flex items-center"><List className="mr-2 h-5 w-5"/>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <FormField
                        control={form.control}
                        name="customerId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Customer</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a customer" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value={WALK_IN_CUSTOMER_VALUE}>Walk-in Customer</SelectItem>
                                        {customers.map(c => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                     {selectedCustomerId === WALK_IN_CUSTOMER_VALUE ? (
                        <div className="space-y-4 pt-2">
                            <FormField control={form.control} name="customerName" render={({ field }) => (
                               <FormItem><FormLabel className="flex items-center"><User className="mr-2 h-4 w-4"/>Walk-in Customer Name</FormLabel><FormControl><Input placeholder="e.g., John Doe" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>
                            <FormField
                                control={form.control}
                                name="customerContact"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center"><Phone className="mr-2 h-4 w-4"/>Walk-in Customer Contact</FormLabel>
                                    <FormControl>
                                    <PhoneInput
                                        name={field.name}
                                        value={field.value}
                                        onChange={field.onChange}
                                        onBlur={field.onBlur}
                                        ref={field.ref}
                                        international
                                        defaultCountry="PK"
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                                    />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                        </div>
                     ) : (
                        <FormField control={form.control} name="customerContact" render={({ field }) => (
                            <FormItem><FormLabel className="flex items-center"><Phone className="mr-2 h-4 w-4"/>Customer Contact (Read-only)</FormLabel><FormControl><Input {...field} readOnly className="bg-muted/50"/></FormControl></FormItem>
                         )}/>
                     )}

                    <div className="space-y-2">
                        <Label className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Gold Rates (PKR/gram)</Label>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 border rounded-md">
                            <FormField control={form.control} name="goldRate24k" render={({ field }) => (<FormItem><FormLabel className="text-xs">24k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            <FormField control={form.control} name="goldRate22k" render={({ field }) => (<FormItem><FormLabel className="text-xs">22k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            <FormField control={form.control} name="goldRate21k" render={({ field }) => (<FormItem><FormLabel className="text-xs">21k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            <FormField control={form.control} name="goldRate18k" render={({ field }) => (<FormItem><FormLabel className="text-xs">18k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        </div>
                        <FormDescription>This rate applies to all items in this estimate.</FormDescription>
                    </div>

                    <FormField control={form.control} name="advancePayment" render={({ field }) => (
                       <FormItem>
                            <FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Advance Payment (Cash)</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl><FormMessage />
                        </FormItem>
                    )}/>
                    
                    <div className="p-3 border rounded-md bg-muted/30">
                        <p className="font-semibold text-sm mb-2">Advance in Exchange (Gold/Diamonds)</p>
                        <div className="space-y-2">
                            <FormField control={form.control} name="advanceInExchangeDescription" render={({ field }) => (
                               <FormItem><FormLabel className="text-xs">Description of Items Received</FormLabel><FormControl><Textarea placeholder="e.g., Old gold ring (21k, ~5.2g)" {...field} rows={2} /></FormControl><FormMessage /></FormItem>
                            )}/>
                            <FormField control={form.control} name="advanceInExchangeValue" render={({ field }) => (
                               <FormItem><FormLabel className="text-xs">Estimated Value (PKR)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>
                        </div>
                    </div>

                    <Separator/>
                    <div className="space-y-2 p-3 bg-muted/50 rounded-md">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Subtotal:</span>
                            <span className="font-semibold text-base">PKR {liveEstimate.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center text-destructive">
                            <span className="text-muted-foreground">Advance (Cash + Exchange):</span>
                            <span className="font-semibold text-base">- PKR {((formValues.advancePayment || 0) + (formValues.advanceInExchangeValue || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between items-center text-xl font-bold">
                            <span>Balance Due:</span>
                            <span className="text-primary">PKR {liveEstimate.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                        <Ban className="mr-2 h-4 w-4" /> Cancel
                    </Button>
                    <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Save className="mr-2 h-5 w-5" />}
                         {form.formState.isSubmitting ? "Saving..." : (isEditMode ? 'Save Changes' : 'Save Order')}
                    </Button>
                </CardFooter>
            </Card>
        </div>
      </form>
    </Form>
  );
};
