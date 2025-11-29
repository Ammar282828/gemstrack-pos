
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAppStore, KaratValue, MetalType } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { ArrowLeft, Plus, Trash2, Copy, Loader2, Save } from 'lucide-react';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

// --- Schema Definition ---
// We use a simplified schema for bulk adding, focusing on shared attributes + individual weights.

const BulkAddProductSchema = z.object({
  // Shared Configuration
  categoryId: z.string().min(1, "Category is required"),
  namePrefix: z.string().optional(), // Optional prefix for auto-generated names
  metalType: z.enum(['gold', 'palladium', 'platinum', 'silver'] as const),
  karat: z.enum(['18k', '21k', '22k', '24k'] as const).optional(),
  
  // Costs Configuration
  makingCharges: z.coerce.number().min(0),
  wastagePercentage: z.coerce.number().min(0),
  
  // Stones/Diamonds Configuration (Shared for simplicity in this bulk tool)
  hasStones: z.boolean().default(false),
  stoneCharges: z.coerce.number().min(0).default(0),
  stoneWeightG: z.coerce.number().min(0).default(0),
  
  hasDiamonds: z.boolean().default(false),
  diamondCharges: z.coerce.number().min(0).default(0),
  
  miscCharges: z.coerce.number().min(0).default(0),

  // The List of Weights
  items: z.array(z.object({
    weight: z.coerce.number().min(0.001, "Weight must be greater than 0"),
    customNameSuffix: z.string().optional(), // Optional specific name part
  })).min(1, "At least one item is required"),
});

type BulkAddFormValues = z.infer<typeof BulkAddProductSchema>;

export default function BulkAddProductPage() {
  const router = useRouter();
  const { toast } = useToast();
  const appReady = useAppReady();
  const { categories, addProduct } = useAppStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<BulkAddFormValues>({
    resolver: zodResolver(BulkAddProductSchema),
    defaultValues: {
      metalType: 'gold',
      karat: '21k',
      makingCharges: 0,
      wastagePercentage: 0,
      hasStones: false,
      stoneCharges: 0,
      stoneWeightG: 0,
      hasDiamonds: false,
      diamondCharges: 0,
      miscCharges: 0,
      items: [{ weight: 0 }], // Start with one row
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // Watchers for conditional rendering
  const metalType = form.watch('metalType');
  const hasStones = form.watch('hasStones');
  const hasDiamonds = form.watch('hasDiamonds');

  const onSubmit = async (data: BulkAddFormValues) => {
    setIsSubmitting(true);
    let successCount = 0;
    
    try {
        const categoryTitle = categories.find(c => c.id === data.categoryId)?.title || 'Item';

        // Iterate through each weight item and create a product
        for (const item of data.items) {
            // Construct the product name
            let finalName = data.namePrefix 
                ? `${data.namePrefix} ${item.customNameSuffix || ''}`.trim()
                : undefined; // If undefined, store will auto-generate based on category

            // Prepare the payload for addProduct
            const productPayload = {
                categoryId: data.categoryId,
                name: finalName || '', // Store handles empty string name generation if needed, but we pass empty string to satisfy type if logic allows
                metalType: data.metalType,
                karat: data.metalType === 'gold' ? data.karat : undefined,
                metalWeightG: item.weight, // The unique weight for this item
                
                // Shared configs
                makingCharges: data.makingCharges,
                wastagePercentage: data.wastagePercentage,
                
                hasStones: data.hasStones,
                stoneCharges: data.hasStones ? data.stoneCharges : 0,
                stoneWeightG: data.hasStones ? data.stoneWeightG : 0,
                
                hasDiamonds: data.hasDiamonds,
                diamondCharges: data.hasDiamonds ? data.diamondCharges : 0,
                
                miscCharges: data.miscCharges,
                
                // Defaults for fields not in bulk form
                secondaryMetalType: undefined,
                secondaryMetalWeightG: 0,
                isCustomPrice: false,
            };

            const result = await addProduct(productPayload as any);
            if (result) successCount++;
        }

        toast({
            title: "Bulk Add Complete",
            description: `Successfully added ${successCount} products.`,
        });
        router.push('/products');

    } catch (error: any) {
        console.error(error);
        toast({
            title: "Error",
            description: "Failed to add some products. Please try again.",
            variant: "destructive",
        });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handlePasteWeights = async () => {
      try {
          const text = await navigator.clipboard.readText();
          // Match all numbers (decimal or integer) separated by newlines, spaces, or commas
          const weights = text.match(/[\d.]+/g)?.map(Number).filter(n => !isNaN(n) && n > 0);
          
          if (weights && weights.length > 0) {
              // Append new rows for pasted weights
              weights.forEach(w => append({ weight: w }));
              toast({ title: "Pasted", description: `Added ${weights.length} weight entries from clipboard.` });
          } else {
              toast({ title: "No Weights Found", description: "Could not find valid numbers in clipboard.", variant: "destructive" });
          }
      } catch (err) {
          console.error("Failed to read clipboard", err);
          toast({ title: "Clipboard Error", description: "Could not access clipboard.", variant: "destructive" });
      }
  };

  if (!appReady) return <div className="p-8 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto" /></div>;

  return (
    <div className="container mx-auto py-6 max-w-4xl">
      <Button variant="ghost" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Products
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Bulk Add Products</CardTitle>
          <CardDescription>Add multiple products with the same configuration but different weights.</CardDescription>
        </CardHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              
              {/* --- Configuration Section --- */}
              <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
                  <h3 className="font-semibold text-sm uppercase text-muted-foreground mb-2">Shared Configuration</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="categoryId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Category</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="namePrefix"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name Prefix (Optional)</FormLabel>
                            <FormControl><Input placeholder="e.g., Gold Ring Design A" {...field} /></FormControl>
                            <FormDescription>Will be used as "Prefix - SKU" if not empty.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <FormField
                        control={form.control}
                        name="metalType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Metal Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="gold">Gold</SelectItem>
                                <SelectItem value="silver">Silver</SelectItem>
                                <SelectItem value="platinum">Platinum</SelectItem>
                                <SelectItem value="palladium">Palladium</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      {metalType === 'gold' && (
                          <FormField
                            control={form.control}
                            name="karat"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Karat</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectItem value="18k">18k</SelectItem>
                                    <SelectItem value="21k">21k</SelectItem>
                                    <SelectItem value="22k">22k</SelectItem>
                                    <SelectItem value="24k">24k</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                      )}

                      <FormField
                        control={form.control}
                        name="wastagePercentage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Wastage %</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="makingCharges"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Making (PKR)</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                  </div>

                  {/* Stones & Extra */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                      <FormField
                        control={form.control}
                        name="hasStones"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <div className="space-y-1 leading-none"><FormLabel>Stones?</FormLabel></div>
                          </FormItem>
                        )}
                      />
                      
                      {hasStones && (
                          <>
                          <FormField
                            control={form.control}
                            name="stoneCharges"
                            render={({ field }) => (
                              <FormItem><FormLabel>Stone Charges</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                            )}
                          />
                           <FormField
                            control={form.control}
                            name="stoneWeightG"
                            render={({ field }) => (
                              <FormItem><FormLabel>Stone Weight</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                            )}
                          />
                          </>
                      )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                       <FormField
                        control={form.control}
                        name="hasDiamonds"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <div className="space-y-1 leading-none"><FormLabel>Diamonds?</FormLabel></div>
                          </FormItem>
                        )}
                      />
                      {hasDiamonds && (
                          <FormField
                            control={form.control}
                            name="diamondCharges"
                            render={({ field }) => (
                              <FormItem><FormLabel>Diamond Charges</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                            )}
                          />
                      )}
                      
                      <FormField
                        control={form.control}
                        name="miscCharges"
                        render={({ field }) => (
                          <FormItem><FormLabel>Misc Charges</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                        )}
                      />
                  </div>
              </div>

              {/* --- Weights List Section --- */}
              <div>
                  <div className="flex justify-between items-center mb-2">
                      <Label className="text-base">Weights to Add</Label>
                      <div className="flex gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={handlePasteWeights}>
                              <Copy className="mr-2 h-3 w-3" /> Paste Weights
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => append({ weight: 0 })}>
                              <Plus className="mr-2 h-3 w-3" /> Add Row
                          </Button>
                      </div>
                  </div>
                  
                  <ScrollArea className="h-[300px] border rounded-md p-4">
                      {fields.length === 0 && <p className="text-center text-muted-foreground py-8">No items added. Paste weights or add a row.</p>}
                      <div className="space-y-2">
                          {fields.map((field, index) => (
                              <div key={field.id} className="flex gap-2 items-center">
                                  <div className="w-8 text-center text-sm text-muted-foreground">{index + 1}</div>
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.weight`}
                                    render={({ field }) => (
                                        <FormItem className="flex-1 space-y-0">
                                            <FormControl><Input type="number" placeholder="Weight (g)" {...field} /></FormControl>
                                        </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.customNameSuffix`}
                                    render={({ field }) => (
                                        <FormItem className="flex-1 space-y-0">
                                            <FormControl><Input placeholder="Name Suffix (Optional)" {...field} /></FormControl>
                                        </FormItem>
                                    )}
                                  />
                                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive hover:bg-destructive/10">
                                      <Trash2 className="h-4 w-4" />
                                  </Button>
                              </div>
                          ))}
                      </div>
                  </ScrollArea>
              </div>

            </CardContent>
            <CardFooter className="flex justify-between">
                <Button type="button" variant="ghost" onClick={() => form.reset()}>Reset Form</Button>
                <Button type="submit" size="lg" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isSubmitting ? 'Creating Products...' : `Create ${fields.length} Products`}
                </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
