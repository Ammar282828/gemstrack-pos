
"use client";

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Product, Category, KaratValue, MetalType, GOLD_COIN_CATEGORY_ID } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Diamond, Zap, Shield, Weight, PlusCircle, Gem } from 'lucide-react';
import Image from 'next/image';
import { Label } from '@/components/ui/label';

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum'];
const CATEGORIES_WITH_STONES = ['cat001', 'cat002', 'cat003', 'cat005', 'cat006', 'cat010', 'cat011', 'cat012', 'cat013', 'cat014', 'cat015', 'cat016'];

// Schema for the form data
const productFormSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  metalType: z.enum(metalTypeValues, { required_error: "Metal type is required" }),
  karat: z.enum(karatValues).optional(),
  metalWeightG: z.coerce.number().min(0.001, "Metal weight must be a positive number"),
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingCharges: z.coerce.number().min(0, "Making charges must be non-negative"),
  hasDiamonds: z.boolean().default(false),
  hasStones: z.boolean().default(false),
  stoneWeightG: z.coerce.number().min(0, "Stone weight must be non-negative").default(0),
  diamondCharges: z.coerce.number().min(0, "Diamond charges must be non-negative").default(0),
  stoneCharges: z.coerce.number().min(0, "Stone charges must be non-negative"),
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  stoneDetails: z.string().optional(),
  diamondDetails: z.string().optional(),
  submitAction: z.enum(['saveAndClose', 'saveAndAddAnother']).optional(),
}).superRefine((data, ctx) => {
  if (data.metalType === 'gold' && !data.karat) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Karat is required for gold items.",
      path: ["karat"],
    });
  }
  if (data.stoneWeightG > data.metalWeightG) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Stone weight cannot be greater than the total metal weight.",
      path: ["stoneWeightG"],
    });
  }
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface ProductFormProps {
  product?: Product;
}

export const ProductForm: React.FC<ProductFormProps> = ({ product }) => {
  const router = useRouter();
  const { toast } = useToast();
  const { categories, addProduct, updateProduct } = useAppStore();
  const isEditMode = !!product;

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? {
      categoryId: product.categoryId,
      metalType: product.metalType,
      karat: product.karat,
      metalWeightG: product.metalWeightG,
      wastagePercentage: product.wastagePercentage,
      makingCharges: product.makingCharges,
      hasDiamonds: product.hasDiamonds,
      hasStones: product.hasStones,
      stoneWeightG: product.stoneWeightG,
      diamondCharges: product.diamondCharges,
      stoneCharges: product.stoneCharges,
      miscCharges: product.miscCharges,
      imageUrl: product.imageUrl || "",
      stoneDetails: product.stoneDetails || "",
      diamondDetails: product.diamondDetails || "",
    } : {
      categoryId: '',
      metalType: 'gold',
      karat: '21k',
      metalWeightG: 0,
      wastagePercentage: 10,
      makingCharges: 0,
      hasDiamonds: false,
      hasStones: false,
      stoneWeightG: 0,
      diamondCharges: 0,
      stoneCharges: 0,
      miscCharges: 0,
      imageUrl: "",
      stoneDetails: "",
      diamondDetails: "",
    },
  });

  const selectedCategoryId = form.watch('categoryId');
  const selectedMetalType = form.watch('metalType');
  const hasDiamondsValue = form.watch('hasDiamonds');
  const hasStonesValue = form.watch('hasStones');
  const isGoldCoin = selectedCategoryId === GOLD_COIN_CATEGORY_ID && selectedMetalType === 'gold';


  useEffect(() => {
    if (selectedMetalType !== 'gold') {
      form.setValue('karat', undefined);
    } else if (!form.getValues('karat')) {
      form.setValue('karat', '21k');
    }
  }, [selectedMetalType, form]);
  
  useEffect(() => {
    if (isGoldCoin) {
      form.setValue('hasDiamonds', false);
      form.setValue('hasStones', false);
      form.setValue('diamondCharges', 0);
      form.setValue('wastagePercentage', 0);
      form.setValue('makingCharges', 0);
      form.setValue('stoneCharges', 0);
      form.setValue('miscCharges', 0);
      form.setValue('stoneDetails', '');
      form.setValue('diamondDetails', '');
      form.setValue('stoneWeightG', 0);
    } else {
        if (hasDiamondsValue) {
            form.setValue('wastagePercentage', 25);
        } else {
            form.setValue('wastagePercentage', 10); // Revert to default if unchecked
            form.setValue('diamondCharges', 0);
            form.setValue('diamondDetails', '');
        }

        if (!hasStonesValue) {
             form.setValue('stoneWeightG', 0);
             form.setValue('stoneDetails', '');
             // We don't reset stoneCharges as it might be used for non-weighable stones
        }
    }
  }, [isGoldCoin, hasDiamondsValue, hasStonesValue, form]);


  const processAndSubmit = async (data: ProductFormData) => {
    const processedData: Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'> = {
      ...data,
      karat: data.metalType === 'gold' ? data.karat : undefined,
    };

    try {
      if (isEditMode && product) {
        await updateProduct(product.sku, processedData);
        toast({ title: "Success", description: "Product updated successfully." });
        router.push(`/products/${product.sku}`);
      } else {
        const newProduct = await addProduct(processedData);
        if (newProduct) {
          toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added.` });
          if (data.submitAction === 'saveAndAddAnother') {
            form.reset({
                ...form.getValues(),
                metalWeightG: 0,
                hasDiamonds: false,
                hasStones: false,
                stoneWeightG: 0,
                diamondCharges: 0,
                stoneCharges: 0,
                miscCharges: 0,
                imageUrl: "",
                stoneDetails: "",
                diamondDetails: "",
            });
            // Manually trigger revalidation if needed
            form.trigger();
          } else {
            router.push('/products');
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
        <Card>
          <CardHeader>
            <CardTitle>{isEditMode ? 'Edit Product' : 'Add New Product'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isEditMode && product && (
              <>
                <FormItem className="md:col-span-1">
                  <FormLabel>SKU (Read-only)</FormLabel>
                  <FormControl>
                    <Input value={product.sku} disabled className="bg-muted/50" />
                  </FormControl>
                </FormItem>
                <FormItem className="md:col-span-1">
                  <FormLabel>Product Name (Auto-generated)</FormLabel>
                  <FormControl>
                    <Input value={product.name} disabled className="bg-muted/50" />
                  </FormControl>
                </FormItem>
              </>
            )}

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
             <FormField
              control={form.control} name="metalType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center"><Shield className="mr-2 h-4 w-4 text-primary" /> Metal Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select Metal Type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {metalTypeValues.map((mVal) => (
                        <SelectItem key={mVal} value={mVal}>{mVal.charAt(0).toUpperCase() + mVal.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {selectedMetalType === 'gold' && (
              <FormField
                control={form.control} name="karat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4 text-primary" /> Karat (for Gold)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select Karat for Gold" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {karatValues.map((kVal) => (<SelectItem key={kVal} value={kVal}>{kVal.toUpperCase()}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
            <FormField
              control={form.control} name="metalWeightG"
              render={({ field }) => (
                <FormItem className={selectedMetalType !== 'gold' ? 'md:col-span-2' : '' }>
                  <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4 text-primary" /> Gross Metal Weight (grams)</FormLabel>
                  <FormControl><Input type="number" step="0.001" placeholder="e.g., 5.75" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isGoldCoin && (
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                 <FormField
                  control={form.control} name="hasStones"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} id="hasStones" /></FormControl>
                      <div className="space-y-1 leading-none">
                        <Label htmlFor="hasStones" className="flex items-center cursor-pointer">
                          <Gem className="mr-2 h-4 w-4 text-primary" /> Product Contains Stones?
                        </Label>
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
                        <Label htmlFor="hasDiamonds" className="flex items-center cursor-pointer">
                          <Diamond className="mr-2 h-4 w-4 text-primary" /> Product Contains Diamonds?
                        </Label>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control} name="wastagePercentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Wastage (%)</FormLabel>
                      <FormControl><Input type="number" step="0.1" placeholder="e.g., 10" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control} name="makingCharges"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Making Charges</FormLabel>
                      <FormControl><Input type="number" step="1" placeholder="e.g., 5000" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {hasStonesValue &&
                   <FormField
                    control={form.control} name="stoneWeightG"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Stone Weight (grams)</FormLabel>
                        <FormControl><Input type="number" step="0.001" placeholder="e.g., 0.5" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                }

                {hasDiamondsValue && (
                  <FormField
                    control={form.control} name="diamondCharges"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Diamond Charges</FormLabel>
                        <FormControl><Input type="number" step="1" placeholder="e.g., 50000" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                 {hasStonesValue &&
                    <FormField
                    control={form.control} name="stoneCharges"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Stone Charges</FormLabel>
                        <FormControl><Input type="number" step="1" placeholder="e.g., 15000" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                }
                
                <FormField
                  control={form.control} name="miscCharges"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Miscellaneous Charges</FormLabel>
                      <FormControl><Input type="number" step="1" placeholder="e.g., 250" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {hasStonesValue && (
                  <FormField
                    control={form.control} name="stoneDetails"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel className="flex items-center"><Gem className="mr-2 h-4 w-4 text-primary" /> Stone Details</FormLabel>
                        <FormControl><Textarea placeholder="e.g., 1x Ruby (2ct), 4x Sapphire (0.5ct each)" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {hasDiamondsValue && (
                  <FormField
                    control={form.control} name="diamondDetails"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4 text-primary" /> Diamond Details</FormLabel>
                        <FormControl><Textarea placeholder="e.g., Center: 1ct VVS1, Side: 12x 0.05ct VS2" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            <FormField
              control={form.control} name="imageUrl"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Image URL (Optional)</FormLabel>
                  <FormControl><Input type="url" placeholder="https://placehold.co/400x400.png" {...field} /></FormControl>
                   {field.value && (
                    <div className="mt-2 p-2 border rounded-md w-fit bg-muted">
                        <Image src={field.value} alt="Product Preview" width={80} height={80} className="h-20 w-20 object-contain" data-ai-hint="product jewelry" unoptimized/>
                    </div>
                   )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()} className="w-full sm:w-auto">
              <Ban className="mr-2 h-4 w-4" /> Cancel
            </Button>
            {!isEditMode && (
                <Button type="submit" disabled={form.formState.isSubmitting} onClick={() => form.setValue('submitAction', 'saveAndAddAnother')} className="w-full sm:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" /> Save & Add Another
                </Button>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting} onClick={() => form.setValue('submitAction', 'saveAndClose')} className="w-full sm:w-auto">
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Product & Close'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
