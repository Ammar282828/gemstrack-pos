
"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Karigar } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, User, Phone, StickyNote } from 'lucide-react';

const karigarSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().optional(),
  notes: z.string().optional(),
});

type KarigarFormData = z.infer<typeof karigarSchema>;

interface KarigarFormProps {
  karigar?: Karigar; // For editing
  onSubmitSuccess?: () => void;
}

export const KarigarForm: React.FC<KarigarFormProps> = ({ karigar, onSubmitSuccess }) => {
  const router = useRouter();
  const { toast } = useToast();
  const { addKarigar, updateKarigar } = useAppStore();

  const form = useForm<KarigarFormData>({
    resolver: zodResolver(karigarSchema),
    defaultValues: karigar ? {
      name: karigar.name,
      contact: karigar.contact || "",
      notes: karigar.notes || "",
    } : {
      name: '',
      contact: '',
      notes: '',
    },
  });

  const isEditMode = !!karigar;

  const onSubmit = (data: KarigarFormData) => {
    try {
      if (isEditMode && karigar) {
        updateKarigar(karigar.id, data);
        toast({ title: "Success", description: "Karigar details updated successfully." });
      } else {
        const newKarigar = addKarigar(data);
        toast({ title: "Success", description: `Karigar "${newKarigar.name}" added successfully.` });
      }
      if (onSubmitSuccess) {
        onSubmitSuccess();
      } else {
        router.push(isEditMode ? `/karigars/${karigar.id}` : '/karigars');
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
                  <div className="flex items-center">
                        <Phone className="h-5 w-5 mr-2 text-muted-foreground" />
                        <FormControl>
                            <Input type="text" placeholder="e.g., 0300-1234567" {...field} />
                        </FormControl>
                    </div>
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
            <Button type="submit" disabled={form.formState.isSubmitting}>
              <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Karigar'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
