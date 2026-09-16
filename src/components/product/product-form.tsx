
"use client";

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { SizePicker } from '@/components/shared/size-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { KARAT_VALUES as karatValues, METAL_TYPES as metalTypeValues, metalLabel } from '@/lib/materials';
import { PLATING_TYPES } from '@/lib/store';
import { useAppStore, Product, Category, KaratValue, MetalType, GOLD_COIN_CATEGORY_ID, MENS_RING_CATEGORY_ID, legacyPartKeyFor } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, PlusCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CategoryPicker } from '@/components/shared/category-picker';
import { AmountInput } from '@/components/ui/amount-input';
import { PageBack } from '@/components/shared/page-back';
import { FormSection, PriceModeToggle } from '@/components/shared/piece-form';
import { STORE_CONFIG } from '@/lib/store-config';


// Schema for the form data
const productFormSchema = z.object({
  name: z.string().optional(), // Product name is now optional
  categoryId: z.string().min(1, "Category is required"),
  // Primary Metal
  metalType: z.enum(metalTypeValues, { required_error: "Metal type is required" }),
  karat: z.enum(karatValues).optional(),
  metalWeightG: z.coerce.number().min(0),
  silverRatePerGram: z.coerce.number().min(0).optional(),
  // Secondary Metal (optional)
  secondaryMetalType: z.string().optional(),
  secondaryMetalKarat: z.enum(karatValues).optional().or(z.literal('')),
  secondaryMetalWeightG: z.coerce.number().min(0, "Secondary metal weight must be non-negative").optional(),
  // Other fields
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingCharges: z.coerce.number().min(0, "Making charges must be non-negative"),
  hasDiamonds: z.boolean().default(false),
  hasStones: z.boolean().default(false),
  stoneWeightG: z.coerce.number().min(0, "Stone weight must be non-negative").default(0),
  diamondCharges: z.coerce.number().min(0, "Diamond charges must be non-negative"),
  stoneCharges: z.coerce.number().min(0, "Stone charges must be non-negative"),
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  stoneDetails: z.string().optional(),
  diamondDetails: z.string().optional(),
  submitAction: z.enum(['saveAndClose', 'saveAndAddAnother']).optional(),
  // Manual Price Override fields
  isCustomPrice: z.boolean().default(true),
  customPrice: z.coerce.number().min(0).optional(),
  description: z.string().optional(),
  // Optional size for rings / bracelets / similar (e.g. "10 Indian / 5 US")
  size: z.string().optional(),
  platingType: z.string().optional(),
  platingNote: z.string().optional(),
  nickelFree: z.boolean().default(false),
}).superRefine((data, ctx) => {
  if (data.isCustomPrice) {
    if (!data.description || data.description.length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Description is required for custom priced items.", path: ["description"] });
    }
    if (data.customPrice === undefined || data.customPrice <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A positive price is required.", path: ["customPrice"] });
    }
  }

  if (!data.isCustomPrice && (!data.metalWeightG || data.metalWeightG < 0.001)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Metal weight must be a positive number", path: ["metalWeightG"] });
  }

  if (!data.isCustomPrice) {
    if (data.metalType === 'gold' && !data.karat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Karat is required for gold items.", path: ["karat"] });
    }
    if (data.secondaryMetalType === 'gold' && !data.secondaryMetalKarat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Karat is required for secondary gold metal.", path: ["secondaryMetalKarat"] });
    }
    if (data.secondaryMetalType && (!data.secondaryMetalWeightG || data.secondaryMetalWeightG <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A positive weight is required for secondary metal.", path: ["secondaryMetalWeightG"] });
    }
    const totalMetalWeight = (data.metalWeightG || 0) + (data.secondaryMetalWeightG || 0);
    if (data.stoneWeightG > totalMetalWeight) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Stone weight cannot be greater than the total metal weight.", path: ["stoneWeightG"] });
    }
  }
});

type ProductFormData = z.infer<typeof productFormSchema>;
type ProductDataForAdd = Omit<Product, 'sku' | 'qrCodeDataUrl'>;

interface ProductFormProps {
  product?: Product;
  isCartEditMode?: boolean;
  onCartItemSubmit?: (sku: string, data: Partial<Product>) => void;
  onProductCreated?: (newProduct: Product) => void;
}

const getSafeDefaultValues = (p?: Product): ProductFormData => {
    return {
      name: p?.name || '',
      categoryId: p?.categoryId || '',
      platingType: p?.platingType || '',
      platingNote: p?.platingNote || '',
      nickelFree: !!p?.nickelFree,
      // The shop's own default, so the silver store starts on silver and the
      // gold store on gold rather than both starting on silver.
      metalType: p?.metalType || STORE_CONFIG.defaultMetal,
      karat: p?.karat || undefined,
      metalWeightG: p?.metalWeightG || 0,
      silverRatePerGram: p?.silverRatePerGram || 0,
      secondaryMetalType: p?.secondaryMetalType || '',
      secondaryMetalKarat: p?.secondaryMetalKarat || undefined,
      secondaryMetalWeightG: p?.secondaryMetalWeightG || 0,
      wastagePercentage: p?.wastagePercentage === undefined ? 10 : p.wastagePercentage,
      makingCharges: p?.makingCharges || 0,
      hasDiamonds: p?.hasDiamonds || false,
      hasStones: p?.hasStones || false,
      stoneWeightG: p?.stoneWeightG || 0,
      diamondCharges: p?.diamondCharges || 0,
      stoneCharges: p?.stoneCharges || 0,
      miscCharges: p?.miscCharges || 0,
      imageUrl: p?.imageUrl || "",
      stoneDetails: p?.stoneDetails || "",
      diamondDetails: p?.diamondDetails || "",
      isCustomPrice: p ? (p.isCustomPrice ?? false) : true,
      customPrice: p?.customPrice || 0,
      description: p?.description || '',
      size: p?.size || '',
    };
};

export const ProductForm: React.FC<ProductFormProps> = ({ 
  product, 
  isCartEditMode = false, 
  onCartItemSubmit, 
  onProductCreated 
}) => {
  const router = useRouter();
  const { toast } = useToast();
  const { categories, addProduct, updateProduct } = useAppStore();
  const isEditMode = !!product;
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const isDialogMode = isCartEditMode || !!onProductCreated;


  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: getSafeDefaultValues(product),
  });

  const { watch, setValue, getValues, control, register } = form;

  const selectedCategoryId = watch('categoryId');
  const selectedMetalType = watch('metalType');
  const selectedSecondaryMetalType = watch('secondaryMetalType');
  const hasDiamondsValue = watch('hasDiamonds');
  const hasStonesValue = watch('hasStones');
  const isCustomPrice = watch('isCustomPrice');
  const imageUrl = watch('imageUrl');
  const karat = watch('karat');

  const isGoldCoin = selectedCategoryId === GOLD_COIN_CATEGORY_ID && selectedMetalType === 'gold';
  const isMensRing = selectedCategoryId === MENS_RING_CATEGORY_ID;

  useEffect(() => {
    if (isGoldCoin) {
        setValue('hasDiamonds', false);
        setValue('hasStones', false);
        setValue('diamondCharges', 0);
        setValue('wastagePercentage', 0);
        setValue('makingCharges', 0);
        setValue('stoneCharges', 0);
        setValue('miscCharges', 0);
        setValue('stoneDetails', '');
        setValue('diamondDetails', '');
        setValue('stoneWeightG', 0);
        setValue('karat', '24k');
    } else if (selectedMetalType === 'silver') {
        setValue('wastagePercentage', 0);
        setValue('makingCharges', 0);
    } else {
        if (hasDiamondsValue) {
            if (getValues('wastagePercentage') !== 25) setValue('wastagePercentage', 25);
        } else {
            if (getValues('wastagePercentage') !== 10) setValue('wastagePercentage', 10);
            if (getValues('diamondCharges') !== 0) setValue('diamondCharges', 0);
            if (getValues('diamondDetails') !== '') setValue('diamondDetails', '');
        }
        if (!hasStonesValue) {
            if (getValues('stoneWeightG') !== 0) setValue('stoneWeightG', 0);
            if (getValues('stoneDetails') !== '') setValue('stoneDetails', '');
        }
    }

    if (selectedMetalType !== 'gold') {
        if (getValues('karat')) setValue('karat', undefined);
    } else if (!getValues('karat')) {
        setValue('karat', '21k');
    }

    if (!isMensRing) {
        if (getValues('secondaryMetalType') || getValues('secondaryMetalWeightG')) {
            setValue('secondaryMetalType', undefined);
            setValue('secondaryMetalKarat', undefined);
            setValue('secondaryMetalWeightG', 0);
        }
    }
    if (selectedSecondaryMetalType && selectedSecondaryMetalType !== 'gold') {
        if (getValues('secondaryMetalKarat')) setValue('secondaryMetalKarat', undefined);
    }

  }, [isGoldCoin, hasDiamondsValue, hasStonesValue, selectedMetalType, isMensRing, selectedSecondaryMetalType, setValue, getValues]);
  
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ title: "File too large", description: "Please upload an image file smaller than 5MB.", variant: "destructive" });
        return;
    }
    
    const storage = getStorage();
    const storageRef = ref(storage, `product_images/${Date.now()}-${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    setIsUploading(true);
    setUploadProgress(0);

    uploadTask.on('state_changed',
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(progress);
        },
        (error) => {
            console.error("Upload error:", error);
            toast({ title: "Upload Failed", description: "There was an error uploading the image.", variant: "destructive" });
            setIsUploading(false);
            setUploadProgress(null);
        },
        () => {
            getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                setValue('imageUrl', downloadURL, { shouldValidate: true, shouldDirty: true });
                setIsUploading(false);
                setUploadProgress(100);
                toast({ title: "Upload Complete", description: "Image has been successfully uploaded." });
            });
        }
    );
  };


  const processAndSubmit = async (data: ProductFormData) => {
    setIsSubmitting(true);
    const processedData: Partial<Product> = {
      ...data,
      name: data.isCustomPrice ? (data.description || 'Custom Item') : (data.name || ''),
      karat: data.metalType === 'gold' ? data.karat : undefined,
      secondaryMetalType: isMensRing && data.secondaryMetalType !== 'none' ? (data.secondaryMetalType as MetalType) : undefined,
      secondaryMetalKarat: isMensRing && data.secondaryMetalType === 'gold' ? (data.secondaryMetalKarat as KaratValue) : undefined,
      secondaryMetalWeightG: isMensRing && data.secondaryMetalType !== 'none' ? data.secondaryMetalWeightG : undefined,
    };
    
    if (isCartEditMode) {
      if (onCartItemSubmit && product) {
        onCartItemSubmit(product.sku, processedData);
      }
      setIsSubmitting(false);
      return;
    }

    try {
      if (isEditMode && product) {
        await updateProduct(product.sku, processedData as Omit<Product, 'sku'>);
        toast({ title: "Success", description: "Product updated successfully." });
        router.push(`/products/${product.sku}`);
      } else {
        const newProduct = await addProduct(processedData as ProductDataForAdd);
        if (newProduct) {
          if (onProductCreated) {
            onProductCreated(newProduct);
          } else {
            toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added.` });
            if (data.submitAction === 'saveAndAddAnother') {
                const originalCategory = getValues('categoryId');
                form.reset(getSafeDefaultValues());
                setValue('categoryId', originalCategory);
            } else { router.push('/products'); }
          }
        } else {
          toast({ title: "Error", description: "Failed to add product. Check logs for details.", variant: "destructive" });
        }
      }
    } catch (error) {
        toast({ title: "Error", description: `Failed to save product: ${(error as Error).message}`, variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  return (
    <Form {...form}>
      {/* Not in dialog mode — a dialog closes, it does not navigate. */}
      {!isDialogMode && <PageBack fallback="/products" label="Back to products" className="mb-2" />}
      <form onSubmit={form.handleSubmit(processAndSubmit)}>
        <div className={cn(!isDialogMode && "p-1")}>
          {!isDialogMode &&
            <CardHeader>
              <CardTitle>{isEditMode ? 'Edit Product' : 'Add New Product'}</CardTitle>
              <CardDescription>
                  {isEditMode ? `Editing SKU: ${product?.sku}` : 'Fill in the details for the new inventory item.'}
              </CardDescription>
            </CardHeader>
          }
           <div className={cn(!isDialogMode && 'p-6 pt-0', isDialogMode && 'p-4')}>
             <div className="space-y-5">
                  {/*
                    The same order as the order form's piece and a line on a bill:
                    what the piece is, then what it costs, then what only a product
                    has -- its photo. Every field is still here under the same rules.
                    The price mode is two buttons instead of a checkbox that read
                    "use the calculation instead", and the metal can be chosen for a
                    fixed-price piece too, which it could not be before.
                  */}

                  {/* ── The piece ─────────────────────────────────────────── */}
                  <FormSection title="The piece" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField control={form.control} name="categoryId" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Category</FormLabel>
                            <CategoryPicker
                              categories={categories}
                              value={field.value || ''}
                              onChange={field.onChange}
                              placeholder="Select a category"
                            />
                            <FormMessage />
                          </FormItem>
                      )}/>
                      <div className="md:col-span-2">
                        {/* A fixed-price product is named by its description -- that is
                            what the save writes into `name` -- so the field that names
                            the piece is whichever one the price mode actually uses. */}
                        {isCustomPrice ? (
                          <FormField control={form.control} name="description" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Description</FormLabel>
                                <FormControl><Textarea rows={2} placeholder="e.g. Turkish silver ring with onyx stone" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                          )}/>
                        ) : (
                          <FormField control={form.control} name="name" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Name <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                                <FormControl><Input placeholder="e.g. Elegant 22k gold ring" {...field} /></FormControl>
                                <FormDescription>Left blank, it is named from the category and SKU.</FormDescription>
                                <FormMessage />
                              </FormItem>
                          )}/>
                        )}
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:gap-4">
                      <FormField control={form.control} name="metalType" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Metal</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Choose the metal" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {metalTypeValues.map((mVal) => (<SelectItem key={mVal} value={mVal}>{metalLabel(mVal)}</SelectItem>))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                      )}/>
                      {selectedMetalType === 'gold' && (
                        <FormField control={form.control} name="karat" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Karat</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select karat" /></SelectTrigger></FormControl>
                                <SelectContent>{karatValues.map((kVal) => (<SelectItem key={kVal} value={kVal}>{kVal.toUpperCase()}</SelectItem>))}</SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                        )}/>
                      )}
                  </div>

                  {selectedMetalType === 'silver' && (
                    <div className="rounded-md border p-3 space-y-3">
                      <p className="text-sm font-medium">925 Sterling Silver finish</p>
                      <FormField control={form.control} name="platingType" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Plating</FormLabel>
                          <Select value={field.value || '__none__'} onValueChange={v => { if (v === '') return; field.onChange(v === '__none__' ? '' : v); }}>
                            <FormControl><SelectTrigger><SelectValue placeholder="No plating" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">No plating</SelectItem>
                              {PLATING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}/>
                      {watch('platingType') === 'Other' && (
                        <FormField control={form.control} name="platingNote" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Describe the plating</FormLabel>
                            <FormControl><Input placeholder="e.g. Rose gold plating" {...field} /></FormControl>
                          </FormItem>
                        )}/>
                      )}
                      <FormField control={form.control} name="nickelFree" render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                          <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                          <FormLabel className="font-normal text-sm cursor-pointer">Nickel free</FormLabel>
                        </FormItem>
                      )}/>
                    </div>
                  )}

                  {/* A men's ring can carry a second metal. Priced from the rate only,
                      as before. */}
                  {isMensRing && !isCustomPrice && (
                    <div className="rounded-md border p-3 space-y-3">
                      <p className="text-sm font-medium">Second metal <span className="text-muted-foreground font-normal">(optional)</span></p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                          <FormField control={form.control} name="secondaryMetalType" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Metal</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      {metalTypeValues.map((mVal) => (<SelectItem key={mVal} value={mVal}>{metalLabel(mVal)}</SelectItem>))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                          )}/>
                          {selectedSecondaryMetalType === 'gold' && (
                          <FormField control={form.control} name="secondaryMetalKarat" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Karat</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select karat" /></SelectTrigger></FormControl>
                                <SelectContent>{karatValues.map((kVal) => (<SelectItem key={kVal} value={kVal}>{kVal.toUpperCase()}</SelectItem>))}</SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                          )}/>
                          )}
                          <FormField control={form.control} name="secondaryMetalWeightG" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Weight (g)</FormLabel>
                                <FormControl><AmountInput placeholder="e.g. 1.25" {...field} disabled={!selectedSecondaryMetalType || selectedSecondaryMetalType === 'none'} /></FormControl>
                                <FormMessage />
                            </FormItem>
                          )}/>
                      </div>
                    </div>
                  )}

                  {/* SizePicker decides whether the category has sizes at all. */}
                  <FormField control={form.control} name="size" render={({ field }) => (
                    <FormItem>
                      <SizePicker
                        categoryId={selectedCategoryId}
                        value={field.value || ''}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}/>

                  {/* ── Price ─────────────────────────────────────────────── */}
                  <FormSection title="Price" />
                  <FormField control={form.control} name="isCustomPrice" render={({ field }) => (
                    <FormItem>
                      <PriceModeToggle fixed={!!field.value} onChange={field.onChange} />
                    </FormItem>
                  )}/>

                  {isCustomPrice ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                        <FormField control={form.control} name="customPrice" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Price (PKR)</FormLabel>
                              <FormControl><AmountInput placeholder="e.g. 15000" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                        )}/>
                        <FormField control={form.control} name="silverRatePerGram" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Reference rate per gram <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                              <FormControl><AmountInput placeholder="e.g. 275" {...field} /></FormControl>
                              <FormDescription>For internal reference only — does not affect the price.</FormDescription>
                            </FormItem>
                        )}/>
                    </div>
                  ) : (
                    <>
                    {/* Weight and the figure the metal price is made from: wastage, or
                        for silver an all-inclusive rate. A gold coin has neither. */}
                    <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <FormField control={form.control} name="metalWeightG" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Weight (g)</FormLabel>
                              <FormControl><AmountInput placeholder="e.g. 5.75" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                        )}/>
                        {selectedMetalType === 'silver' ? (
                          <FormField control={form.control} name="silverRatePerGram" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Rate per gram (PKR)</FormLabel>
                                <FormControl><AmountInput placeholder="e.g. 275" {...field} /></FormControl>
                                <FormDescription>All-inclusive, for this piece. 0 uses the rate in settings.</FormDescription>
                                <FormMessage />
                              </FormItem>
                          )}/>
                        ) : !isGoldCoin && (
                          <FormField control={form.control} name="wastagePercentage" render={({ field }) => (
                              <FormItem><FormLabel>Wastage (%)</FormLabel><FormControl><Input type="number" step="0.1" placeholder="e.g. 10" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                        )}
                    </div>

                    {!isGoldCoin && (
                      <>
                      <div className="grid grid-cols-2 gap-3 md:gap-4">
                          {selectedMetalType !== 'silver' && (
                            <FormField control={form.control} name="makingCharges" render={({ field }) => (
                              <FormItem><FormLabel>Making (PKR)</FormLabel><FormControl><Input type="number" step="1" placeholder="e.g. 5000" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          )}
                          <FormField control={form.control} name="miscCharges" render={({ field }) => (
                              <FormItem><FormLabel>Misc (PKR)</FormLabel><FormControl><AmountInput placeholder="e.g. 250" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                      </div>

                      {/* The box first, and the fields it opens under it. */}
                      <FormField control={form.control} name="hasDiamonds" render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="font-normal text-sm cursor-pointer">Has diamonds</FormLabel>
                          </FormItem>
                      )}/>
                      {hasDiamondsValue && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 pl-6 border-l-2 border-muted">
                          <FormField control={form.control} name="diamondCharges" render={({ field }) => (
                              <FormItem><FormLabel>Diamonds (PKR)</FormLabel><FormControl><AmountInput placeholder="e.g. 50000" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          <div className="md:col-span-2">
                            <FormField control={form.control} name="diamondDetails" render={({ field }) => (
                              <FormItem><FormLabel>Diamond details</FormLabel><FormControl><Textarea rows={2} placeholder="e.g. Centre 1ct VVS1, sides 12 × 0.05ct VS2" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          </div>
                        </div>
                      )}

                      <FormField control={form.control} name="hasStones" render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="font-normal text-sm cursor-pointer">Has other stones</FormLabel>
                          </FormItem>
                      )}/>
                      {hasStonesValue && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 pl-6 border-l-2 border-muted">
                          <FormField control={form.control} name="stoneWeightG" render={({ field }) => (
                              <FormItem><FormLabel>Stone weight (g)</FormLabel><FormControl><AmountInput placeholder="e.g. 0.5" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          <FormField control={form.control} name="stoneCharges" render={({ field }) => (
                              <FormItem><FormLabel>Stones (PKR)</FormLabel><FormControl><AmountInput placeholder="e.g. 15000" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          <div className="col-span-2 md:col-span-3">
                            <FormField control={form.control} name="stoneDetails" render={({ field }) => (
                              <FormItem><FormLabel>Stone details</FormLabel><FormControl><Textarea rows={2} placeholder="e.g. 1 × ruby 2ct, and 2g gold accent" {...field} /></FormControl><FormMessage /></FormItem>
                          )}/>
                          </div>
                        </div>
                      )}
                      </>
                    )}
                    </>
                  )}

                  {/* ── Photo ─────────────────────────────────────────────── */}
                  <FormSection title="Photo" hint="optional" />
                  <FormItem>
                      <FormLabel>Product photo</FormLabel>
                      <FormControl>
                          <Input id="image-upload" type="file" accept="image/*" onChange={handleImageUpload} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
                      </FormControl>
                      {isUploading && uploadProgress !== null && (
                          <div className="mt-2">
                              <Progress value={uploadProgress} className="w-full" />
                              <p className="text-sm text-muted-foreground mt-1 text-center">{Math.round(uploadProgress)}% uploaded</p>
                          </div>
                      )}
                      {imageUrl && (
                          <div className="mt-2 p-2 border rounded-md w-fit bg-muted">
                              <Image src={imageUrl} alt="Product Preview" width={80} height={80} className="h-20 w-20 object-contain" data-ai-hint="product jewelry" unoptimized/>
                          </div>
                      )}
                      <FormMessage />
                  </FormItem>
                </div>
          </div>
          {!isDialogMode &&
            <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full sm:w-auto">
                <Ban className="mr-2 h-4 w-4" /> Cancel
              </Button>
              {!isEditMode && (
                  <Button type="submit" disabled={isSubmitting || isUploading} onClick={() => form.setValue('submitAction', 'saveAndAddAnother')} className="w-full sm:w-auto">
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                      Save & Add Another
                  </Button>
              )}
              <Button type="submit" disabled={isSubmitting || isUploading} onClick={() => form.setValue('submitAction', 'saveAndClose')} className="w-full sm:w-auto">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEditMode ? 'Save Changes' : 'Add Product & Close'}
              </Button>
            </CardFooter>
          }
          {isDialogMode && (
             <div className="p-6 pt-0">
                <Button type="submit" disabled={isSubmitting || isUploading} className="w-full" aria-label="Save">
                    {isSubmitting || isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {isCartEditMode ? 'Apply Changes to Cart Item' : 'Create New Product'}
                </Button>
            </div>
          )}
        </div>
      </form>
    </Form>
  );
};
