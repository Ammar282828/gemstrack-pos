
"use client";

import React, { useEffect } from 'react';
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
import { useAppStore, Product, Category, KaratValue } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Diamond, Zap } from 'lucide-react';

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k'];

const productFormSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  karat: z.enum(karatValues, { required_error: "Karat is required" }),
  metalWeightG: z.coerce.number().min(0, "Metal weight must be non-negative"),
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingCharges: z.coerce.number().min(0, "Making charges must be non-negative"),
  hasDiamonds: z.boolean().default(false),
  diamondCharges: z.coerce.number().min(0, "Diamond charges must be non-negative").default(0),
  stoneCharges: z.coerce.number().min(0, "Stone charges must be non-negative"),
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface ProductFormProps {
  product?: Product;
  onSubmitSuccess?: () => void; // This prop might become less relevant with "Save & Add Another"
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
      karat: product.karat,
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

  useEffect(() => {
    if (hasDiamondsValue) {
      form.setValue('wastagePercentage', 25, { shouldValidate: true });
      if(!isEditMode || (product && !product.hasDiamonds)){
         form.setValue('diamondCharges', product?.diamondCharges || 0);
      }
    } else {
      // This logic applies when hasDiamonds is false, or when it's unchecked,
      // or when the form is reset for "Save & Add Another"
      const category = categories.find(c => c.id === selectedCategoryId);
      let defaultWastage = 10; // Default for most categories
      if (category) {
        const lowerCaseTitle = category.title.toLowerCase();
        const fifteenPercentTriggers = ["chain", "bangle", "gold necklace set"];
        if (fifteenPercentTriggers.some(trigger => lowerCaseTitle.includes(trigger))) {
          defaultWastage = 15;
        }
      }
      form.setValue('wastagePercentage', defaultWastage, { shouldValidate: true });
      
      // If diamonds are deselected, ensure diamond charges are reset if they were set
      if (form.getValues('diamondCharges') !== 0 && !isEditMode && product?.hasDiamonds === undefined) { // only for new product form
         form.setValue('diamondCharges', 0);
      } else if (isEditMode && product && product.hasDiamonds && !hasDiamondsValue) { // if editing and unchecking diamonds
         form.setValue('diamondCharges', 0);
      }
    }
  }, [selectedCategoryId, hasDiamondsValue, isEditMode, categories, form, product]);


  const onSubmitAndClose = async (data: ProductFormData) => {
    try {
      const finalData = {
        ...data,
        diamondCharges: data.hasDiamonds ? data.diamondCharges : 0,
      };

      if (isEditMode && product) {
        updateProduct(product.sku, finalData as Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>);
        toast({ title: "Success", description: "Product updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess(); else router.push(`/products/${product.sku}`);
      } else {
        const newProduct = addProduct(finalData as Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>);
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
    // This handler is only for *adding* new products.
    try {
      const finalData = { // Ensure diamondCharges are handled correctly if hasDiamonds is false
        ...data,
        diamondCharges: data.hasDiamonds ? data.diamondCharges : 0,
      };
      const newProduct = addProduct(finalData as Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>);
      if (newProduct) {
        toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added. You can add another product.` });
        // Reset form, keeping category and karat, defaulting others
        // The wastagePercentage will be recalculated by the useEffect based on the (retained) category
        // and hasDiamonds (which is reset to false).
        form.reset({
          categoryId: data.categoryId, // Keep current category
          karat: data.karat,           // Keep current karat
          metalWeightG: 0,
          wastagePercentage: 10, // This is a temporary value; useEffect will set the correct one
          makingCharges: 0,
          hasDiamonds: false,      // Default to false for the next item
          diamondCharges: 0,
          stoneCharges: 0,
          miscCharges: 0,
          imageUrl: "",
        });
        // Ensure focus goes to a logical first field for the new entry, e.g., category or metal weight.
        // You might need a ref for this, or just let the browser default.
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
      {/* Removed onSubmit from form tag to handle submission via button clicks */}
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
              name="karat"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4 text-primary" /> Karat</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Karat" />
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
             <FormField
              control={form.control}
              name="hasDiamonds"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 md:col-span-2">
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
              name="metalWeightG"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Metal Weight (grams)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="e.g., 5.75" {...field} />
                  </FormControl>
                  <FormMessage />
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
                    <Input type="number" step="0.1" placeholder="e.g., 10 or 25" {...field} />
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
                <FormItem className={ (hasDiamondsValue && product?.karat) ? "" : "md:col-span-2"}>
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

    