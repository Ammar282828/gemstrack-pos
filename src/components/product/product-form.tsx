

"use client";

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { useAppStore, Product, Category, KaratValue, MetalType, GOLD_COIN_CATEGORY_ID, MENS_RING_CATEGORY_ID } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Diamond, Zap, Shield, Weight, PlusCircle, Gem, Info, Upload, Loader2, CaseSensitive } from 'lucide-react';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { Separator } from '../ui/separator';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum', 'silver'];

// Schema for the form data
const productFormSchema = z.object({
  name: z.string().optional(), // Product name is now optional
  categoryId: z.string().min(1, "Category is required"),
  // Primary Metal
  metalType: z.enum(metalTypeValues, { required_error: "Metal type is required" }),
  karat: z.enum(karatValues).optional(),
  metalWeightG: z.coerce.number().min(0.001, "Metal weight must be a positive number"),
  // Secondary Metal (optional)
  secondaryMetalType: z.enum(metalTypeValues).optional().or(z.literal('')),
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
  isCustomPrice: z.boolean().default(false),
  customPrice: z.coerce.number().min(0).optional(),
  description: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.isCustomPrice) {
    if (!data.description || data.description.length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Description is required for custom priced items.", path: ["description"] });
    }
    if (data.customPrice === undefined || data.customPrice <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A positive price is required.", path: ["customPrice"] });
    }
  }
  // Name validation is removed from here to make it optional for standard items.

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
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface ProductFormProps {
  product?: Product;
  isCartEditMode?: boolean;
  onCartItemSubmit?: (sku: string, data: Partial<Product>) => void;
  onProductCreated?: (newProduct: Product) => void;
}

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
  
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const isDialogMode = isCartEditMode || onProductCreated;


  const getSafeDefaultValues = (p?: Product): ProductFormData => {
    return {
      name: p?.name || '',
      categoryId: p?.categoryId || '',
      metalType: p?.metalType || 'gold',
      karat: p?.karat,
      metalWeightG: p?.metalWeightG || 0,
      secondaryMetalType: p?.secondaryMetalType || '',
      secondaryMetalKarat: p?.secondaryMetalKarat,
      secondaryMetalWeightG: p?.secondaryMetalWeightG || 0,
      wastagePercentage: p?.wastagePercentage || 10,
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
      isCustomPrice: p?.isCustomPrice || false,
      customPrice: p?.customPrice || 0,
      description: p?.description || '',
    };
  };

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: getSafeDefaultValues(product),
  });

  const selectedCategoryId = form.watch('categoryId');
  const selectedMetalType = form.watch('metalType');
  const selectedSecondaryMetalType = form.watch('secondaryMetalType');
  const hasDiamondsValue = form.watch('hasDiamonds');
  const hasStonesValue = form.watch('hasStones');
  const isCustomPrice = form.watch('isCustomPrice');
  const imageUrl = form.watch('imageUrl');
  const isGoldCoin = selectedCategoryId === GOLD_COIN_CATEGORY_ID && selectedMetalType === 'gold';
  const isMensRing = selectedCategoryId === MENS_RING_CATEGORY_ID;

  useEffect(() => {
    if (selectedMetalType !== 'gold') { form.setValue('karat', undefined); } 
    else if (!form.getValues('karat')) { form.setValue('karat', '21k'); }
  }, [selectedMetalType, form]);
  
  useEffect(() => {
    if (selectedSecondaryMetalType !== 'gold') { form.setValue('secondaryMetalKarat', undefined); }
    if(!selectedSecondaryMetalType){
      form.setValue('secondaryMetalWeightG', 0);
      form.setValue('secondaryMetalKarat', '');
    }
  }, [selectedSecondaryMetalType, form]);

  useEffect(() => {
    if (!isMensRing) {
        form.setValue('secondaryMetalType', '');
        form.setValue('secondaryMetalKarat', '');
        form.setValue('secondaryMetalWeightG', 0);
    }
  }, [isMensRing, form]);
  
  useEffect(() => {
    if (isGoldCoin) {
      form.setValue('hasDiamonds', false); form.setValue('hasStones', false); form.setValue('diamondCharges', 0);
      form.setValue('wastagePercentage', 0); form.setValue('makingCharges', 0); form.setValue('stoneCharges', 0);
      form.setValue('miscCharges', 0); form.setValue('stoneDetails', ''); form.setValue('diamondDetails', '');
      form.setValue('stoneWeightG', 0);
      form.setValue('karat', '24k');
    } else {
        if (hasDiamondsValue) { form.setValue('wastagePercentage', 25); } 
        else { form.setValue('wastagePercentage', 10); form.setValue('diamondCharges', 0); form.setValue('diamondDetails', ''); }
        if (!hasStonesValue) { form.setValue('stoneWeightG', 0); form.setValue('stoneDetails', ''); }
    }
  }, [isGoldCoin, hasDiamondsValue, hasStonesValue, form]);
  
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
                form.setValue('imageUrl', downloadURL, { shouldValidate: true, shouldDirty: true });
                setIsUploading(false);
                setUploadProgress(100);
                toast({ title: "Upload Complete", description: "Image has been successfully uploaded." });
            });
        }
    );
  };


  const processAndSubmit = async (data: ProductFormData) => {
    const processedData: Partial<Product> = {
      ...data,
      name: data.isCustomPrice ? (data.description || 'Custom Item') : (data.name || ''),
      karat: data.metalType === 'gold' ? data.karat : undefined,
      secondaryMetalType: isMensRing ? (data.secondaryMetalType || undefined) : undefined,
      secondaryMetalKarat: isMensRing && data.secondaryMetalType === 'gold' ? data.secondaryMetalKarat : undefined,
      secondaryMetalWeightG: isMensRing && data.secondaryMetalType ? data.secondaryMetalWeightG : undefined,
    };
    
    if (isCartEditMode) {
      if (onCartItemSubmit && product) {
        onCartItemSubmit(product.sku, processedData);
      }
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
              const originalCategory = form.getValues('categoryId');
              form.reset({
                  name: '',
                  categoryId: originalCategory, metalType: 'gold', karat: '21k', metalWeightG: 0, wastagePercentage: 10,
                  makingCharges: 0, hasDiamonds: false, hasStones: false, stoneWeightG: 0, diamondCharges: 0,
                  stoneCharges: 0, miscCharges: 0, imageUrl: "", stoneDetails: "", diamondDetails: "",
                  secondaryMetalType: '', secondaryMetalKarat: '', secondaryMetalWeightG: 0,
                  isCustomPrice: false, customPrice: 0, description: '',
              });
            } else { router.push('/products'); }
          }
        } else {
          toast({ title: "Error", description: "Failed to add product. Check logs for details.", variant: "destructive" });
        }
      }
    } catch (error) {
        toast({ title: "Error", description: `Failed to save product: ${(error as Error).message}`, variant: "destructive" });
    }
  };
  
  return (
    <Form {...form}>
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
           <div className={cn(!isDialogMode && 'p-6 pt-0')}>
             <ScrollArea className={cn(isDialogMode && 'h-[70vh] p-4')}>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control} name="categoryId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Category</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {categories.map((category: Category) => (
                                  <SelectItem key={category.id} value={category.id}>{category.title}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                  </div>
                  
                  <FormField
                    control={form.control} name="isCustomPrice"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 bg-primary/5">
                        <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="isCustomPrice" /></FormControl>
                        <div className="space-y-1 leading-none">
                          <Label htmlFor="isCustomPrice" className="flex items-center cursor-pointer text-base font-semibold text-primary"><Info className="mr-2 h-4 w-4" /> Set Manual Price</Label>
                          <FormDescription>Check this to bypass detailed calculations and set a final price directly.</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  {isCustomPrice ? (
                    <div className="space-y-6 p-4 border rounded-md bg-muted/30">
                        <FormField control={form.control} name="description"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Product Description / Name</FormLabel>
                                <FormControl><Textarea placeholder="e.g., Turkish Silver Ring with Onyx Stone" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField control={form.control} name="customPrice"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Final Price (PKR)</FormLabel>
                                <FormControl><Input type="number" placeholder="e.g., 15000" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                    </div>
                  ) : (
                  <>
                    <Separator />
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><CaseSensitive className="mr-2 h-4 w-4" />Product Name (Optional)</FormLabel>
                          <FormDescription>A descriptive name for the product. If left blank, a name will be auto-generated from the category and SKU.</FormDescription>
                          <FormControl><Input placeholder="e.g., Elegant 22k Gold Ring" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <h3 className="text-lg font-semibold text-primary">Primary Metal</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <FormField
                          control={form.control} name="metalType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center"><Shield className="mr-2 h-4 w-4" /> Metal Type</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select Metal Type" /></SelectTrigger></FormControl>
                                <SelectContent>
                                  {metalTypeValues.map((mVal) => (<SelectItem key={mVal} value={mVal}>{mVal.charAt(0).toUpperCase() + mVal.slice(1)}</SelectItem>))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {selectedMetalType === 'gold' && (
                          <FormField control={form.control} name="karat"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4" /> Karat</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Select Karat" /></SelectTrigger></FormControl>
                                  <SelectContent>{karatValues.map((kVal) => (<SelectItem key={kVal} value={kVal}>{kVal.toUpperCase()}</SelectItem>))}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <FormField
                          control={form.control} name="metalWeightG"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" /> Weight (g)</FormLabel>
                              <FormControl><Input type="number" step="0.001" placeholder="e.g., 5.75" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                    </div>

                    {isMensRing && (
                        <>
                        <Separator />
                        <h3 className="text-lg font-semibold text-primary">Secondary Metal (Optional)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField control={form.control} name="secondaryMetalType"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center"><Shield className="mr-2 h-4 w-4" /> Metal Type</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                          <SelectItem value="">None</SelectItem>
                                          {metalTypeValues.map((mVal) => (<SelectItem key={mVal} value={mVal}>{mVal.charAt(0).toUpperCase() + mVal.slice(1)}</SelectItem>))}
                                          </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            {selectedSecondaryMetalType === 'gold' && (
                            <FormField control={form.control} name="secondaryMetalKarat"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4" /> Karat</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Select Karat" /></SelectTrigger></FormControl>
                                    <SelectContent>{karatValues.map((kVal) => (<SelectItem key={kVal} value={kVal}>{kVal.toUpperCase()}</SelectItem>))}</SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            )}
                            <FormField control={form.control} name="secondaryMetalWeightG"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" /> Weight (g)</FormLabel>
                                    <FormControl><Input type="number" step="0.001" placeholder="e.g., 1.25" {...field} disabled={!selectedSecondaryMetalType} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                        </div>
                        </>
                    )}


                    {!isGoldCoin && (
                      <>
                      <Separator/>
                      <h3 className="text-lg font-semibold text-primary">Stones, Diamonds &amp; Charges</h3>
                      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                          control={form.control} name="hasStones"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="hasStones" /></FormControl>
                              <div className="space-y-1 leading-none">
                                <Label htmlFor="hasStones" className="flex items-center cursor-pointer"><Gem className="mr-2 h-4 w-4 text-primary" /> Contains Stones?</Label>
                              </div>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control} name="hasDiamonds"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="hasDiamonds" /></FormControl>
                              <div className="space-y-1 leading-none">
                                <Label htmlFor="hasDiamonds" className="flex items-center cursor-pointer"><Diamond className="mr-2 h-4 w-4 text-primary" /> Contains Diamonds?</Label>
                              </div>
                            </FormItem>
                          )}
                        />
                        <FormField control={form.control} name="wastagePercentage" render={({ field }) => (<FormItem><FormLabel>Wastage (%)</FormLabel><FormControl><Input type="number" step="0.1" placeholder="e.g., 10" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="makingCharges" render={({ field }) => (<FormItem><FormLabel>Making Charges</FormLabel><FormControl><Input type="number" step="1" placeholder="e.g., 5000" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        {hasStonesValue && <FormField control={form.control} name="stoneWeightG" render={({ field }) => (<FormItem><FormLabel>Stone Weight (grams)</FormLabel><FormControl><Input type="number" step="0.001" placeholder="e.g., 0.5" {...field} /></FormControl><FormMessage /></FormItem>)}/>}
                        {hasDiamondsValue && <FormField control={form.control} name="diamondCharges" render={({ field }) => (<FormItem><FormLabel>Diamond Charges</FormLabel><FormControl><Input type="number" step="1" placeholder="e.g., 50000" {...field} /></FormControl><FormMessage /></FormItem>)} />}
                        {hasStonesValue && <FormField control={form.control} name="stoneCharges" render={({ field }) => (<FormItem><FormLabel>Stone Charges</FormLabel><FormControl><Input type="number" step="1" placeholder="e.g., 15000" {...field} /></FormControl><FormMessage /></FormItem>)} />}
                        <FormField control={form.control} name="miscCharges" render={({ field }) => (<FormItem><FormLabel>Miscellaneous Charges</FormLabel><FormControl><Input type="number" step="1" placeholder="e.g., 250" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        {hasStonesValue && <FormField control={form.control} name="stoneDetails" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel className="flex items-center"><Gem className="mr-2 h-4 w-4 text-primary" /> Secondary Metal &amp; Stone Details</FormLabel><FormControl><Textarea placeholder="e.g., 1x Ruby (2ct) and 2g gold accent" {...field} /></FormControl><FormMessage /></FormItem>)} />}
                        {hasDiamondsValue && <FormField control={form.control} name="diamondDetails" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4 text-primary" /> Diamond Details</FormLabel><FormControl><Textarea placeholder="e.g., Center: 1ct VVS1, Side: 12x 0.05ct VS2" {...field} /></FormControl><FormMessage /></FormItem>)} />}
                      </div>
                      </>
                    )}
                  </>
                  )}

                  <FormItem className="md:col-span-2">
                      <FormLabel>Product Image</FormLabel>
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
            </ScrollArea>
          </div>
          {!isDialogMode &&
            <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full sm:w-auto">
                <Ban className="mr-2 h-4 w-4" /> Cancel
              </Button>
              {!isEditMode && (
                  <Button type="submit" disabled={form.formState.isSubmitting || isUploading} onClick={() => form.setValue('submitAction', 'saveAndAddAnother')} className="w-full sm:w-auto">
                      {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                      Save & Add Another
                  </Button>
              )}
              <Button type="submit" disabled={form.formState.isSubmitting || isUploading} onClick={() => form.setValue('submitAction', 'saveAndClose')} className="w-full sm:w-auto">
                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEditMode ? 'Save Changes' : 'Add Product & Close'}
              </Button>
            </CardFooter>
          }
          {isDialogMode && (
             <div className="p-6 pt-0">
                <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
                    <Save className="mr-2 h-4 w-4" />
                    {isCartEditMode ? 'Apply Changes to Cart Item' : 'Create New Product'}
                </Button>
            </div>
          )}
        </div>
      </form>
    </Form>
  );
};
