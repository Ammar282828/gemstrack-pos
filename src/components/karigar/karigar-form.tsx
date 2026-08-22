
"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Karigar } from '@/lib/store';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, User, Phone, StickyNote } from 'lucide-react';
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
import 'react-phone-number-input/style.css';
import { normalizePhoneNumber } from '@/lib/utils';

const karigarSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().optional(),
  notes: z.string().optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
});

type KarigarFormData = z.infer<typeof karigarSchema>;

interface KarigarFormProps {
  karigar?: Karigar; // For editing
  onSubmitSuccess?: () => void;
}

export const KarigarForm: React.FC<KarigarFormProps> = ({ karigar, onSubmitSuccess }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { addKarigar, updateKarigar } = useAppStore();

  const redirectToHisaab = searchParams.get('redirect_to_hisaab') === 'true';

  const form = useForm<KarigarFormData>({
    resolver: zodResolver(karigarSchema),
    defaultValues: karigar ? {
      name: karigar.name,
      contact: normalizePhoneNumber(karigar.contact) || "",
      notes: karigar.notes || "",
      email: karigar.email || "",
    } : {
      name: '',
      contact: '',
      notes: '',
      email: '',
    },
  });

  const isEditMode = !!karigar;

  const onSubmit = async (rawData: KarigarFormData) => {
    // Store the login email lowercased — it is matched against the Google
    // account's address on every karigar-portal request.
    const data = { ...rawData, email: (rawData.email || '').trim().toLowerCase() };
    try {
      if (isEditMode && karigar) {
        await updateKarigar(karigar.id, data);
        toast({ title: "Success", description: "Karigar details updated successfully." });
        if (onSubmitSuccess) onSubmitSuccess();
        else router.push(`/karigars/${karigar.id}`);
      } else {
        const newKarigar = await addKarigar(data);
        if (newKarigar) {
          toast({ title: "Success", description: `Karigar "${newKarigar.name}" added successfully.` });
          if (onSubmitSuccess) onSubmitSuccess();
          else if (redirectToHisaab) {
            router.push(`/hisaab/${newKarigar.id}?type=karigar`);
          } else {
            router.push('/karigars');
          }
        } else {
           toast({ title: "Error", description: "Failed to create new karigar.", variant: "destructive" });
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save karigar details.", variant: "destructive" });
      console.error("Failed to save karigar", error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
                <User className="w-6 h-6 mr-2 text-primary"/>
                {isEditMode ? 'Edit Karigar' : 'Add New Karigar'}
            </CardTitle>
            <CardDescription>
                {isEditMode ? `Update details for ${karigar?.name}.` : 'Enter the details for the new karigar.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Full Name</FormLabel>
                   <div className="flex items-center">
                        <User className="h-5 w-5 mr-2 text-muted-foreground" />
                        <FormControl>
                            <Input placeholder="Enter karigar's full name" {...field} />
                        </FormControl>
                    </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contact"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Contact Information (Optional)</FormLabel>
                  <FormControl>
                    <PhoneInput
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      defaultCountry="PK"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    />
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
                  <FormLabel className="text-base">Google Login (Optional)</FormLabel>
                  <FormControl>
                    <Input type="email" inputMode="email" autoComplete="off"
                      placeholder="karigar@gmail.com" {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Adding a Gmail lets this karigar sign in and see only their own work list
                    and account. They cannot see customers, prices, or any other karigar.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Notes (Optional)</FormLabel>
                   <div className="flex items-start">
                        <StickyNote className="h-5 w-5 mr-2 mt-2.5 text-muted-foreground" />
                        <FormControl>
                            <Textarea placeholder="Any relevant notes, e.g., specialization, address, etc." {...field} rows={4} />
                        </FormControl>
                    </div>
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
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Karigar'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
