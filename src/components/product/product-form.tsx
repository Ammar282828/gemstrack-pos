
"use client";

import React from 'react';
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

// Schema for form data, SKU is not included as it's auto-generated or read-only
const productFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  categoryId: z.string().min(1, "Category is required"),
  metalWeightG: z.coerce.number().min(0, "Metal weight must be non-negative"),
  stoneWeightCt: z.coerce.number().min(0, "Stone weight must be non-negative"),
  wastagePercentage: z.coerce.number().min(0).max(100, "Wastage must be between 0 and 100"),
  makingRatePerG: z.coerce.number().min(0, "Making rate must be non-negative"),
  stoneRatePerCt: z.coerce.number().min(0, "Stone rate must be non-negative"),
  miscCharges: z.coerce.number().min(0, "Misc charges must be non-negative"),
  assignedCustomerId: z.string().optional(),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface ProductFormProps {
  product?: Product; // For editing (includes SKU)
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
      name: product.name,
      categoryId: product.categoryId,
      metalWeightG: product.metalWeightG,
      stoneWeightCt: product.stoneWeightCt,
      wastagePercentage: product.wastagePercentage,
      makingRatePerG: product.makingRatePerG,
      stoneRatePerCt: product.stoneRatePerCt,
      miscCharges: product.miscCharges,
      assignedCustomerId: product.assignedCustomerId ?? undefined,
      imageUrl: product.imageUrl || "",
    } : {
      name: '',
      categoryId: '',
      metalWeightG: 0,
      stoneWeightCt: 0,
      wastagePercentage: 0,
      makingRatePerG: 0,
      stoneRatePerCt: 0,
      miscCharges: 0,
      assignedCustomerId: undefined,
      imageUrl: "",
    },
  });

  const onSubmit = (data: ProductFormData) => {
    try {
      if (isEditMode && product) { // product must exist in edit mode
        updateProduct(product.sku, data); // Pass only ProductFormData
        toast({ title: "Success", description: "Product updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess(); else router.push(`/products/${product.sku}`);
      } else {
        const newProduct = addProduct(data); // addProduct now expects ProductFormData
        if (newProduct) {
            toast({ title: "Success", description: `Product ${newProduct.name} (SKU: ${newProduct.sku}) added successfully.` });
            if (onSubmitSuccess) onSubmitSuccess(); else router.push('/products');
        } else {
            toast({ title: "Error", description: "Failed to add product. Category might be missing.", variant: "destructive" });
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
              <FormItem>
                <FormLabel>SKU (Read-only)</FormLabel>
                <FormControl>
                  <Input value={product.sku} disabled className="bg-muted/50" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
             {/* Spacer to keep layout consistent if SKU is not shown */}
            {!isEditMode && <div className="md:col-span-1 hidden md:block"></div>}


            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Diamond Solitaire Ring" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
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
              name="makingRatePerG"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Making Rate (per gram)</FormLabel>
                  <FormControl>
                    <Input type="number" step="1" placeholder="e.g., 500" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stoneRatePerCt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stone Rate (per carat)</FormLabel>
                  <FormControl>
                    <Input type="number" step="1" placeholder="e.g., 50000" {...field} />
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
                    value={field.value ?? "__NONE__"} // Ensure value is "__NONE__" if undefined for placeholder
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

