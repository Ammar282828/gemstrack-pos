
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
import { useAppStore, Product, Category, KaratValue, MetalType } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Diamond, Zap, Shield, Weight } from 'lucide-react';

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum'];

const GOLD_COIN_CATEGORY_ID = 'cat017'; // Assuming 'cat017' is Gold Coins

const goldCoinDenominations: Record<string, Array<{ label: string; value: number }>> = {
  '18k': [
    { label: '0.5 gram', value: 0.5 },
    { label: '1 gram', value: 1 },
    { label: '2 grams', value: 2 },
    { label: '4 grams', value: 4 },
    { label: '8 grams', value: 8 },
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
  metalWeightG: z.coerce.number().min(0, "Metal weight must be non-negative"),
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingCharges: z.coerce.number().min(0, "Making charges must be non-negative"),
  hasDiamonds: z.boolean().default(false),
  diamondCharges: z.coerce.number().min(0, "Diamond charges must be non-negative").default(0),
  stoneCharges: z.coerce.number().min(0, "Stone charges must be non-negative"),
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
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
});


type ProductFormData = z.infer<typeof productFormSchema>;

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

  const isGoldCoin = selectedCategoryId === GOLD_COIN_CATEGORY_ID && selectedMetalType === 'gold';
  const showDenominationDropdown = isGoldCoin && (selectedKarat === '18k' || selectedKarat === '24k');
  const currentDenominations = (isGoldCoin && selectedKarat && goldCoinDenominations[selectedKarat]) ? goldCoinDenominations[selectedKarat] : [];


  useEffect(() => {
    if (selectedMetalType !== 'gold') {
      form.setValue('karat', undefined, { shouldValidate: true }); // Validate to clear potential error if karat was required
    } else if (selectedMetalType === 'gold' && !form.getValues('karat')) {
      // If switching to gold and no karat is set, default to 21k or let validation handle it
      form.setValue('karat', '21k', {shouldValidate: true}); 
    }
    // If category changes from gold coins or karat changes for gold coins, reset weight if it came from a denomination
    if (!showDenominationDropdown && selectedCategoryId !== GOLD_COIN_CATEGORY_ID) {
        // Could add logic here if needed, but metalWeightG is direct input anyway
    }

  }, [selectedMetalType, selectedKarat, selectedCategoryId, form, showDenominationDropdown]);

  useEffect(() => {
    // This effect for wastage should run after metalType/karat might have changed
    const category = categories.find(c => c.id === selectedCategoryId);
    let defaultWastage = 10; // Default for "the rest"

    if (hasDiamondsValue) {
        defaultWastage = 25;
    } else if (category) {
        const lowerCaseTitle = category.title.toLowerCase();
        const fifteenPercentTriggers = ["chain", "bangle", "gold necklace set"];
        if (fifteenPercentTriggers.some(trigger => lowerCaseTitle.includes(trigger))) {
            defaultWastage = 15;
        }
        // Specific for Gold Coins - typically 0% wastage or very low, user can override
        if (selectedCategoryId === GOLD_COIN_CATEGORY_ID) {
            defaultWastage = product?.wastagePercentage ?? 0; // Default to 0 for new coins, or existing if editing
        }
    }
    form.setValue('wastagePercentage', defaultWastage, { shouldValidate: true });

    if (!hasDiamondsValue) {
        form.setValue('diamondCharges', 0, { shouldValidate: true });
    }

  }, [selectedCategoryId, hasDiamondsValue, categories, form, product?.wastagePercentage, selectedMetalType]);


  const processFormData = (data: ProductFormData): Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'> => {
    return {
      ...data,
      karat: data.metalType === 'gold' ? data.karat : undefined,
      diamondCharges: data.hasDiamonds ? data.diamondCharges : 0,
    } as Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>;
  };
  
  const onSubmitAndClose = async (data: ProductFormData) => {
    try {
      const processedData = processFormData(data);
      if (isEditMode && product) {
        updateProduct(product.sku, processedData);
        toast({ title: "Success", description: "Product updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess(); else router.push(`/products/${product.sku}`);
      } else {
        const newProduct = addProduct(processedData);
        if (newProduct) {
            toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added successfully.` });
            if (onSubmitSuccess) onSubmitSuccess(); else router.push('/products');
        } else {
            toast({ title: "Error", description: "Failed to add product. Category might be missing or other issue.", variant: "destructive" });
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save product.", variant: "destructive" });
      console.error("Failed to save product", error);
    }
  };

  const onSaveAndAddAnother = async (data: ProductFormData) => {
    try {
      const processedData = processFormData(data);
      const newProduct = addProduct(processedData);
      if (newProduct) {
        toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added. You can add another product.` });
        form.reset({
          categoryId: data.categoryId, // Retain category
          metalType: data.metalType, // Retain metal type
          karat: data.metalType === 'gold' ? data.karat : undefined, // Retain karat if gold
          metalWeightG: 0, // Reset weight
          wastagePercentage: data.categoryId === GOLD_COIN_CATEGORY_ID ? 0 : 10, // Reset wastage (0 for coins, 10 for others, diamonds will override)
          makingCharges: data.makingCharges, // Retain previous making charges
          hasDiamonds: false,    
          diamondCharges: 0,
          stoneCharges: 0,
          miscCharges: 0,
          imageUrl: "",
        });
      } else {
        toast({ title: "Error", description: "Failed to add product. Category might be missing or other issue.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save product (Save & Add Another).", variant: "destructive" });
      console.error("Failed to save product (Save & Add Another)", error);
    }
  };


  return (
    <Form {...form}>
      <form>
        <Card>
          <CardHeader>
            <CardTitle>{isEditMode ? 'Edit Product' : 'Add New Product'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isEditMode && product && (
              <>
                <FormItem>
                  <FormLabel>SKU (Read-only)</FormLabel>
                  <FormControl>
                    <Input value={product.sku} disabled className="bg-muted/50" />
                  </FormControl>
                </FormItem>
                <FormItem>
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
                    name="metalWeightG" // This will still be updated by the Select's onChange
                    render={({ field }) => ( // field here is for metalWeightG, but we use a Select to control it
                        <FormItem>
                        <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4 text-primary" /> Denomination / Weight (Gold Coins)</FormLabel>
                        <Select
                            // Use a temporary value for the Select if field.value doesn't match any denomination value
                            // Or, ensure field.value is always one of the denomination values when this dropdown is shown.
                            // For simplicity, we'll rely on onValueChange to set the correct metalWeightG.
                            // The `value` prop of Select should match one of the `SelectItem` `value` props.
                            value={currentDenominations.find(d => d.value === field.value)?.value.toString()}
                            onValueChange={(valStr) => {
                                form.setValue('metalWeightG', parseFloat(valStr), { shouldValidate: true });
                            }}
                        >
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder={`Select Denomination for ${selectedKarat?.toUpperCase()}`} />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                            {currentDenominations.map((denom) => (
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
                    <FormItem>
                    <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4 text-primary" /> Metal Weight (grams)</FormLabel>
                    <FormControl>
                        <Input type="number" step="0.01" placeholder="e.g., 5.75" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
            )}


             <FormField
              control={form.control}
              name="hasDiamonds"
              render={({ field }) => (
                <FormItem className={`flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 ${selectedMetalType === 'gold' && (selectedKarat !== '18k' && selectedKarat !== '24k' || selectedCategoryId !== GOLD_COIN_CATEGORY_ID) ? '' : 'md:col-span-1' } ${(selectedMetalType !== 'gold' || selectedCategoryId === GOLD_COIN_CATEGORY_ID && (selectedKarat === '18k' || selectedKarat === '24k')) ? 'md:col-span-2' : '' }`}>
                  {/* Conditional col-span to try and keep layout nice */}
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
                    <Input type="number" step="0.1" placeholder="e.g., 10 or 0 for coins" {...field} />
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

            {hasDiamondsValue && (
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
                <FormItem>
                  <FormLabel>{hasDiamondsValue ? "Other Stone Charges" : "Stone Charges"}</FormLabel>
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
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              <Ban className="mr-2 h-4 w-4" /> Cancel
            </Button>
            {!isEditMode && (
                 <Button type="button" onClick={form.handleSubmit(onSaveAndAddAnother)} disabled={form.formState.isSubmitting}>
                    <Save className="mr-2 h-4 w-4" /> Save & Add Another
                </Button>
            )}
            <Button type="button" onClick={form.handleSubmit(onSubmitAndClose)} disabled={form.formState.isSubmitting}>
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Product & Close'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};

