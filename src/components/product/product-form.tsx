
"use client";

import React, { useEffect } from 'react'; // Added useEffect
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Product, Category, Customer } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban } from 'lucide-react';

// Schema for form data
const productFormSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  metalWeightG: z.coerce.number().min(0, "Metal weight must be non-negative"),
  stoneWeightCt: z.coerce.number().min(0, "Stone weight must be non-negative"),
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingCharges: z.coerce.number().min(0, "Making charges must be non-negative"), // Changed from makingRatePerG
  stoneCharges: z.coerce.number().min(0, "Stone charges must be non-negative"), // Changed from stonePricePerCt
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  assignedCustomerId: z.string().optional(),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface ProductFormProps {
  product?: Product; // For editing
  onSubmitSuccess?: () => void;
}

export const ProductForm: React.FC<ProductFormProps> = ({ product, onSubmitSuccess }) => {
  const router = useRouter();
  const { toast } = useToast();
  const { categories, customers, addProduct, updateProduct } = useAppStore();

  const isEditMode = !!product;

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? {
      categoryId: product.categoryId,
      metalWeightG: product.metalWeightG,
      stoneWeightCt: product.stoneWeightCt,
      wastagePercentage: product.wastagePercentage,
      makingCharges: product.makingCharges, // Changed
      stoneCharges: product.stoneCharges, // Changed
      miscCharges: product.miscCharges,
      assignedCustomerId: product.assignedCustomerId ?? "__NONE__",
      imageUrl: product.imageUrl || "",
    } : {
      categoryId: '',
      metalWeightG: 0,
      stoneWeightCt: 0,
      wastagePercentage: 10, 
      makingCharges: 0, // Changed
      stoneCharges: 0, // Changed
      miscCharges: 0,
      assignedCustomerId: "__NONE__",
      imageUrl: "",
    },
  });

  const selectedCategoryId = form.watch('categoryId');

  useEffect(() => {
    if (!isEditMode && selectedCategoryId) { 
      const category = categories.find(c => c.id === selectedCategoryId);
      if (category) {
        let defaultWastage = 10; 
        const lowerCaseTitle = category.title.toLowerCase();
  
        const fifteenPercentTriggers = [
          "chain", 
          "bangle", 
          "gold necklace set" 
        ];
  
        if (fifteenPercentTriggers.some(trigger => lowerCaseTitle.includes(trigger))) {
          defaultWastage = 15;
        }
        
        form.setValue('wastagePercentage', defaultWastage, { 
          shouldValidate: true, 
        });
      }
    }
  }, [selectedCategoryId, isEditMode, categories, form]);

  const onSubmit = (data: ProductFormData) => {
    try {
      if (isEditMode && product) { 
        const updateData: Partial<Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>> = {
            ...data,
            assignedCustomerId: data.assignedCustomerId === "__NONE__" ? undefined : data.assignedCustomerId,
        };
        updateProduct(product.sku, updateData);
        toast({ title: "Success", description: "Product updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess(); else router.push(`/products/${product.sku}`);
      } else {
         const productDataForAdd = {
            ...data,
            assignedCustomerId: data.assignedCustomerId === "__NONE__" ? undefined : data.assignedCustomerId,
        };
        const newProduct = addProduct(productDataForAdd); 
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
                <FormItem className={isEditMode ? "md:col-span-2" : ""}>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
              name="stoneWeightCt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stone Weight (carats)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="e.g., 0.50" {...field} />
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
                    <Input type="number" step="0.1" placeholder="e.g., 10" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="makingCharges" // Changed
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
            <FormField
              control={form.control}
              name="stoneCharges" // Changed
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stone Charges</FormLabel> 
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
              name="assignedCustomerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assign to Customer (Optional)</FormLabel>
                  <Select 
                    onValueChange={(value) => field.onChange(value === "__NONE__" ? undefined : value)} 
                    value={field.value ?? "__NONE__"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a customer or None" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__NONE__">None</SelectItem>
                      {customers.map((customer: Customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name} ({customer.id})
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
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Image URL (Optional)</FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://example.com/image.png" {...field} />
                  </FormControl>
                   {field.value && (
                        <div className="mt-2 p-2 border rounded-md w-fit">
                            <img src={field.value} alt="Product Preview" className="h-24 object-contain" data-ai-hint="product jewelry" />
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
            <Button type="submit" disabled={form.formState.isSubmitting}>
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Product'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
