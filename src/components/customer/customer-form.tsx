
"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Customer } from '@/lib/store';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban } from 'lucide-react';

const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal('')),
  address: z.string().optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;

interface CustomerFormProps {
  customer?: Customer; // For editing
  onSubmitSuccess?: () => void;
}

export const CustomerForm: React.FC<CustomerFormProps> = ({ customer, onSubmitSuccess }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { addCustomer, updateCustomer } = useAppStore();

  const redirectToHisaab = searchParams.get('redirect_to_hisaab') === 'true';

  const form = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? {
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
    } : {
      name: '',
      phone: '',
      email: '',
      address: '',
    },
  });

  const isEditMode = !!customer;

  const onSubmit = async (data: CustomerFormData) => {
    try {
      if (isEditMode) {
        await updateCustomer(customer.id, data);
        toast({ title: "Success", description: "Customer updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess();
        else router.push(`/customers/${customer.id}`);
      } else {
        const newCustomer = await addCustomer(data);
        if (newCustomer) {
          toast({ title: "Success", description: "Customer added successfully." });
          if (onSubmitSuccess) onSubmitSuccess();
          else if (redirectToHisaab) {
            router.push(`/hisaab/${newCustomer.id}?type=customer`);
          } else {
            router.push('/customers');
          }
        } else {
          toast({ title: "Error", description: "Failed to create customer.", variant: "destructive" });
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save customer.", variant: "destructive" });
      console.error("Failed to save customer", error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>{isEditMode ? 'Edit Customer' : 'Add New Customer'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter customer's full name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number (Optional)</FormLabel>
                  <FormControl>
                    <Input type="tel" placeholder="e.g., +1 555-123-4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address (Optional)</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="e.g., customer@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Enter customer's address" {...field} rows={3} />
                  </FormControl>
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
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Customer'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
