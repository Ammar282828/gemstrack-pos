"use client";

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Product, Category, KaratValue, MetalType, GOLD_COIN_CATEGORY_ID } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Diamond, Zap, Shield, Weight } from 'lucide-react';

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum'];

const goldCoinDenominations: Record<string, Array<{ label: string; value: number }>> = {
  '18k': [
    { label: '0.5 gram', value: 0.5 },
    { label: '1 gram', value: 1 },
    { label: '2 grams', value: 2 },
    { label: '4 grams', value: 4 },
    { label: '8 grams', value: 8 },
  ],
  '21k': [
    { label: '1 gram', value: 1 },
    { label: '5 grams', value: 5 },
  ],
  '22k': [
    { label: '1 gram', value: 1 },
    { label: 'Half Sovereign (approx 3.66g of 22k gold in a ~4g coin)', value: 3.657 },
    { label: 'Full Sovereign (approx 7.32g of 22k gold in a ~8g coin)', value: 7.322 },
    { label: '8 grams (Guinea)', value: 8 },
  ],
  '24k': [
    { label: '1 gram', value: 1 },
    { label: '2.5 grams', value: 2.5 },
    { label: '5 grams', value: 5 },
    { label: 'Half Tola (5.83g)', value: 5.8319 },
    { label: '10 grams', value: 10 },
    { label: '1 Tola (11.66g)', value: 11.6638 },
    { label: '2 Tola (23.33g)', value: 23.3276 },
    { label: '5 Tola (58.32g)', value: 58.3190 },
    { label: '10 Tola (116.64g)', value: 116.6380 },
  ],
};


const productFormSchemaBase = z.object({
  categoryId: z.string().min(1, "Category is required"),
  metalType: z.enum(metalTypeValues, { required_error: "Metal type is required" }),
  metalWeightG: z.coerce.number().min(0.001, "Metal weight must be a positive number"), // Min weight slightly above 0
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingCharges: z.coerce.number().min(0, "Making charges must be non-negative"),
  hasDiamonds: z.boolean().default(false),
  diamondCharges: z.coerce.number().min(0, "Diamond charges must be non-negative").default(0),
  stoneCharges: z.coerce.number().min(0, "Stone charges must be non-negative"),
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  submitAction: z.enum(['saveAndClose', 'saveAndAddAnother']).optional(),
});

const productFormSchema = productFormSchemaBase.extend({
  karat: z.enum(karatValues).optional(),
}).superRefine((data, ctx) => {
  if (data.metalType === 'gold' && !data.karat) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Karat is required for gold items.",
      path: ["karat"],
    });
  }
  if (data.categoryId === GOLD_COIN_CATEGORY_ID && data.metalType === 'gold') {
    if (data.hasDiamonds) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Gold coins cannot have diamonds.", path: ["hasDiamonds"]});
    }
  }
});


type ProductFormData = z.infer<typeof productFormSchema>;
type ProductDataForActualAdd = Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>;

interface ProductFormProps {
  product?: Product;
  onSubmitSuccess?: () => void;
}

export const ProductForm: React.FC<ProductFormProps> = ({ product, onSubmitSuccess }) => {
  const router = useRouter();
  const { toast } = useToast();
  const { categories, addProduct, updateProduct } = useAppStore();

  const isEditMode = !!product;

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? {
      categoryId: product.categoryId,
      metalType: product.metalType || 'gold',
      karat: product.metalType === 'gold' ? product.karat : undefined,
      metalWeightG: product.metalWeightG,
      wastagePercentage: product.wastagePercentage,
      makingCharges: product.makingCharges,
      hasDiamonds: product.hasDiamonds || false,
      diamondCharges: product.diamondCharges || 0,
      stoneCharges: product.stoneCharges,
      miscCharges: product.miscCharges,
      imageUrl: product.imageUrl || "",
    } : {
      categoryId: '',
      metalType: 'gold', 
      karat: '21k',      
      metalWeightG: 0,
      wastagePercentage: 10,
      makingCharges: 0,
      hasDiamonds: false,
      diamondCharges: 0,
      stoneCharges: 0,
      miscCharges: 0,
      imageUrl: "",
    },
  });

  const selectedCategoryId = form.watch('categoryId');
  const hasDiamondsValue = form.watch('hasDiamonds');
  const selectedMetalType = form.watch('metalType');
  const selectedKarat = form.watch('karat');

  const isGoldCoinScenario = selectedCategoryId === GOLD_COIN_CATEGORY_ID && selectedMetalType === 'gold';
  
  const availableDenominations = (selectedKarat && goldCoinDenominations[selectedKarat]) 
                                 ? goldCoinDenominations[selectedKarat] 
                                 : [];
  const showDenominationDropdown = isGoldCoinScenario && availableDenominations.length > 0;


  useEffect(() => {
    if (selectedMetalType !== 'gold') {
      form.setValue('karat', undefined, { shouldValidate: true }); 
    } else if (selectedMetalType === 'gold' && !form.getValues('karat')) {
      form.setValue('karat', '21k', {shouldValidate: true}); 
    }
  }, [selectedMetalType, form]);

  useEffect(() => {
    if (isGoldCoinScenario) {
      form.setValue('hasDiamonds', false, { shouldValidate: true });
      form.setValue('wastagePercentage', 0, { shouldValidate: true });
      form.setValue('makingCharges', 0, { shouldValidate: true });
      form.setValue('diamondCharges', 0, { shouldValidate: true }); 
      form.setValue('stoneCharges', 0, { shouldValidate: true });
      form.setValue('miscCharges', 0, { shouldValidate: true });
    }
  }, [isGoldCoinScenario, form]);
  
  useEffect(() => {
    const selectedCategoryDetails = categories.find(c => c.id === selectedCategoryId);
    if (!selectedCategoryDetails || isGoldCoinScenario) return;
  
    if (hasDiamondsValue) {
      form.setValue('wastagePercentage', 25, { shouldValidate: true });
    } else {
      form.setValue('wastagePercentage', 10, { shouldValidate: true });
      form.setValue('diamondCharges', 0, { shouldValidate: true });
    }
  }, [isGoldCoinScenario, hasDiamondsValue, selectedCategoryId, form, categories]);


  const processFormData = (data: ProductFormData): ProductDataForActualAdd => {
    const isActualGoldCoinScenario = data.categoryId === GOLD_COIN_CATEGORY_ID && data.metalType === 'gold';
    const processed: ProductDataForActualAdd = {
      categoryId: data.categoryId,
      metalType: data.metalType,
      karat: data.metalType === 'gold' ? data.karat : undefined,
      metalWeightG: data.metalWeightG,
      wastagePercentage: isActualGoldCoinScenario ? 0 : data.wastagePercentage,
      makingCharges: isActualGoldCoinScenario ? 0 : data.makingCharges,
      hasDiamonds: isActualGoldCoinScenario ? false : data.hasDiamonds,
      diamondCharges: isActualGoldCoinScenario ? 0 : (data.hasDiamonds ? data.diamondCharges : 0),
      stoneCharges: isActualGoldCoinScenario ? 0 : data.stoneCharges,
      miscCharges: isActualGoldCoinScenario ? 0 : data.miscCharges,
      imageUrl: data.imageUrl,
    };
    if (processed.metalType !== 'gold') {
      processed.karat = undefined;
    }
    return processed;
  };

  const onSubmit = async (data: ProductFormData) => {
    const processedData = processFormData(data);

    try {
        if (isEditMode && product) {
            await updateProduct(product.sku, processedData);
            toast({ title: "Success", description: "Product updated successfully." });
            if (onSubmitSuccess) {
                onSubmitSuccess();
            } else {
                router.push(`/products/${product.sku}`);
            }
        } else {
            const newProduct = await addProduct(processedData);
            if (newProduct) {
                toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added.` });
                if (data.submitAction === 'saveAndAddAnother') {
                    const isNextItemAlsoGoldCoin = data.categoryId === GOLD_COIN_CATEGORY_ID && data.metalType === 'gold';
                    const nextWastage = isNextItemAlsoGoldCoin ? 0 : (data.hasDiamonds ? 25 : 10);
                    
                    form.reset({
                        categoryId: data.categoryId,
                        metalType: data.metalType,
                        karat: data.metalType === 'gold' ? data.karat : undefined,
                        metalWeightG: 0,
                        wastagePercentage: nextWastage,
                        makingCharges: isNextItemAlsoGoldCoin ? 0 : data.makingCharges,
                        hasDiamonds: false,
                        diamondCharges: 0,
                        stoneCharges: 0,
                        miscCharges: 0,
                        imageUrl: "",
                    });
                } else {
                    router.push('/products');
                }
            } else {
                toast({ title: "Error", description: "Failed to add product. Category might be missing or other issue.", variant: "destructive" });
            }
        }
    } catch (error) {
        toast({ title: "Error", description: `Failed to save product: ${(error as Error).message}`, variant: "destructive" });
        console.error("Failed to save product", error);
    }
  };
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
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
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((category: Category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="metalType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center"><Shield className="mr-2 h-4 w-4 text-primary" /> Metal Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Metal Type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {metalTypeValues.map((mVal) => (
                        <SelectItem key={mVal} value={mVal}>
                          {mVal.charAt(0).toUpperCase() + mVal.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {selectedMetalType === 'gold' && (
              <FormField
                control={form.control}
                name="karat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4 text-primary" /> Karat (for Gold)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Karat for Gold" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {karatValues.map((kVal) => (
                          <SelectItem key={kVal} value={kVal}>
                            {kVal.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
            {showDenominationDropdown ? (
                 <FormField
                    control={form.control}
                    name="metalWeightG" 
                    render={({ field }) => ( 
                        <FormItem className={selectedMetalType === 'gold' && !selectedKarat ? 'md:col-span-2' : ''}>
                        <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4 text-primary" /> Denomination / Weight (Gold Coins)</FormLabel>
                        <Select
                            value={availableDenominations.find(d => d.value === field.value)?.value.toString()}
                            onValueChange={(valStr) => {
                                if (valStr) {
                                   form.setValue('metalWeightG', parseFloat(valStr), { shouldValidate: true });
                                }
                            }}
                        >
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder={`Select Denomination for ${selectedKarat?.toUpperCase()}`} />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                            {availableDenominations.map((denom) => (
                                <SelectItem key={denom.label} value={denom.value.toString()}>
                                {denom.label}
                                </SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            ) : (
                <FormField
                control={form.control}
                name="metalWeightG"
                render={({ field }) => (
                    <FormItem className={selectedMetalType !== 'gold' ? 'md:col-span-2' : '' }>
                    <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4 text-primary" /> Metal Weight (grams)</FormLabel>
                    <FormControl>
                        <Input type="number" step="0.001" placeholder="e.g., 5.75" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
            )}
             <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">

                {!isGoldCoinScenario && (
                <>
                    <FormField
                    control={form.control}
                    name="hasDiamonds"
                    render={({ field }) => (
                        <FormItem className="md:col-span-2 flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                            <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            id="hasDiamonds"
                            />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="hasDiamonds" className="flex items-center cursor-pointer">
                            <Diamond className="mr-2 h-4 w-4 text-primary" />
                            Product Contains Diamonds?
                            </Label>
                            <FormMessage />
                        </div>
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="wastagePercentage"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Wastage (%)</FormLabel>
                        <FormControl>
                            <Input type="number" step="0.1" placeholder="e.g., 10" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="makingCharges"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Making Charges</FormLabel>
                        <FormControl>
                            <Input type="number" step="1" placeholder="e.g., 5000" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />

                    {hasDiamondsValue && !isGoldCoinScenario && (
                    <FormField
                        control={form.control}
                        name="diamondCharges"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Diamond Charges</FormLabel>
                            <FormControl>
                            <Input type="number" step="1" placeholder="e.g., 50000" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    )}

                    <FormField
                    control={form.control}
                    name="stoneCharges"
                    render={({ field }) => (
                        <FormItem className={!hasDiamondsValue && !isGoldCoinScenario ? 'md:col-span-2' : ''}>
                        <FormLabel>{hasDiamondsValue && !isGoldCoinScenario ? "Other Stone Charges" : "Stone Charges"}</FormLabel>
                        <FormControl>
                            <Input type="number" step="1" placeholder="e.g., 15000" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <FormField
                    control={form.control}
                    name="miscCharges"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Miscellaneous Charges</FormLabel>
                        <FormControl>
                            <Input type="number" step="1" placeholder="e.g., 250" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                </>
                )}
            </div>
             <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Image URL (Optional)</FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://example.com/image.png" {...field} />
                  </FormControl>
                   {field.value && (
                        <div className="mt-2 p-2 border rounded-md w-fit">
                            <img src={field.value} alt="Product Preview" className="h-24 object-contain" data-ai-hint="product jewelry"/>
                        </div>
                     )}
                  <FormMessage />
                </FormItem>
              )}
            </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()} className="w-full sm:w-auto">
              <Ban className="mr-2 h-4 w-4" /> Cancel
            </Button>
            {!isEditMode && (
                 <Button type="submit" disabled={form.formState.isSubmitting} onClick={() => form.setValue('submitAction', 'saveAndAddAnother')} className="w-full sm:w-auto">
                    <Save className="mr-2 h-4 w-4" /> Save & Add Another
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
