

"use client";

import React from 'react';
import { useForm, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppStore, Customer, CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS } from '@/lib/store';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban } from 'lucide-react';
import 'react-phone-number-input/style.css';
import { normalizePhoneNumber } from '@/lib/utils';
import { PageBack } from '@/components/shared/page-back';
import { PhoneField } from '@/components/ui/phone-field';

const NO_SOURCE_VALUE = '__none__';

const customerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  source: z.enum(CUSTOMER_SOURCES).optional(),
  // Sizes stay free text: a ring size is quoted as "12", "12.5" or "US 6" depending on who
  // is asking, and a number field loses the only version the counter recognises.
  ringSize: z.string().optional(),
  bangleSize: z.string().optional(),
  braceletSize: z.string().optional(),
  chainLength: z.string().optional(),
  birthday: z.string().optional(),
  anniversary: z.string().optional(),
  preference: z.string().optional(),
  notes: z.string().optional(),
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
      name: customer.name || '',
      phone: normalizePhoneNumber(customer.phone) || "",
      altPhone: normalizePhoneNumber(customer.altPhone) || "",
      email: customer.email || "",
      address: customer.address || "",
      city: customer.city || "",
      country: customer.country || "",
      source: customer.source,
      ringSize: customer.ringSize || "",
      bangleSize: customer.bangleSize || "",
      braceletSize: customer.braceletSize || "",
      chainLength: customer.chainLength || "",
      birthday: customer.birthday || "",
      anniversary: customer.anniversary || "",
      preference: customer.preference || "",
      notes: customer.notes || "",
    } : {
      name: '', phone: '', altPhone: '', email: '', address: '', city: '', country: '',
      source: undefined,
      ringSize: '', bangleSize: '', braceletSize: '', chainLength: '',
      birthday: '', anniversary: '', preference: '', notes: '',
    },
  });

  const isEditMode = !!customer;

  const onSubmit = async (data: CustomerFormData) => {
    try {
      const finalData = {
        ...data,
        name: data.name || (data.phone ? `Customer - ${data.phone}` : 'Unnamed Customer')
      }

      if (isEditMode && customer) {
        await updateCustomer(customer.id, finalData);
        toast({ title: "Success", description: "Customer updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess();
        else router.push(`/customers/${customer.id}`);
      } else {
        const newCustomer = await addCustomer(finalData);
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
      <PageBack fallback="/customers" label="Back to customers" className="mb-2" />
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
                  <FormLabel>Full Name (Optional)</FormLabel>
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
                        <PhoneField
                              value={field.value || undefined}
                              onChange={v => field.onChange(v || '')}
                              onBlur={field.onBlur}
                              aria-label="Phone number" />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="altPhone"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Second Number (Optional)</FormLabel>
                    <FormControl>
                        <PhoneField
                              value={field.value || undefined}
                              onChange={v => field.onChange(v || '')}
                              onBlur={field.onBlur}
                              aria-label="Second phone number" />
                    </FormControl>
                    <FormDescription>The spare slot. A contact import fills this rather than overwriting the number above.</FormDescription>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>City (Optional)</FormLabel>
                  <FormControl><Input placeholder="e.g., Karachi" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem>
                  <FormLabel>Country (Optional)</FormLabel>
                  <FormControl><Input placeholder="e.g., Pakistan" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="text-sm font-medium">Sizes</h3>
                <p className="text-sm text-muted-foreground">
                  What the shop needs before it can make anything. Written the way it is
                  quoted at the counter, not forced into a number.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField control={form.control} name="ringSize" render={({ field }) => (
                  <FormItem><FormLabel>Ring</FormLabel>
                    <FormControl><Input placeholder="e.g., 12.5" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="bangleSize" render={({ field }) => (
                  <FormItem><FormLabel>Bangle</FormLabel>
                    <FormControl><Input placeholder="e.g., 2.6" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="braceletSize" render={({ field }) => (
                  <FormItem><FormLabel>Bracelet</FormLabel>
                    <FormControl><Input placeholder="e.g., 7 in" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="chainLength" render={({ field }) => (
                  <FormItem><FormLabel>Chain</FormLabel>
                    <FormControl><Input placeholder="e.g., 18 in" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
              </div>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="text-sm font-medium">Dates</h3>
                <p className="text-sm text-muted-foreground">
                  What the dashboard watches for, so a regular gets a message before the day
                  rather than after it.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="birthday" render={({ field }) => (
                  <FormItem><FormLabel>Birthday</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="anniversary" render={({ field }) => (
                  <FormItem><FormLabel>Anniversary</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage /></FormItem>
                )} />
              </div>
            </div>

            <FormField control={form.control} name="preference" render={({ field }) => (
              <FormItem>
                <FormLabel>Preferences (Optional)</FormLabel>
                <FormControl><Input placeholder="e.g., no rose gold, prefers heavier sets" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (Optional)</FormLabel>
                <FormControl><Textarea placeholder="Anything worth remembering" {...field} rows={3} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referral source (optional)</FormLabel>
                  <Select
                    value={field.value ?? NO_SOURCE_VALUE}
                    onValueChange={(v) => field.onChange(v === NO_SOURCE_VALUE ? undefined : v)}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select a source" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SOURCE_VALUE}>— Not specified —</SelectItem>
                      {CUSTOMER_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>{CUSTOMER_SOURCE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>Acquisition channel — used for walk-in &amp; referral analytics.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              <Ban className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting} aria-label="Save">
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Customer'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
