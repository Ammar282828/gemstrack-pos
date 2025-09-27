
"use client";

import React, { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, PaymentMethod } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Landmark, MessageSquare, ArrowLeft, Info, Copy, Save, PlusCircle, Trash2, Edit, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import QRCode from 'qrcode.react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
import 'react-phone-number-input/style.css'
import { Label } from '@/components/ui/label';

const PAKISTANI_BANKS = [
    "Al Baraka Bank (Pakistan) Limited",
    "Allied Bank Limited",
    "Askari Bank",
    "Bank Alfalah",
    "Bank Al-Habib",
    "BankIslami Pakistan",
    "Bank of Khyber",
    "Bank of Punjab",
    "Dubai Islamic Bank",
    "Faysal Bank",
    "First Women Bank",
    "Habib Bank Limited (HBL)",
    "Habib Metropolitan Bank",
    "Industrial and Commercial Bank of China",
    "JS Bank",
    "MCB Bank",
    "MCB Islamic Bank",
    "Meezan Bank",
    "National Bank of Pakistan",
    "Samba Bank",
    "Silkbank Limited",
    "Sindh Bank",
    "Soneri Bank",
    "Standard Chartered Bank (Pakistan)",
    "Summit Bank",
    "United Bank Limited (UBL)",
    "Zarai Taraqiati Bank Limited",
];


const paymentMethodSchema = z.object({
    id: z.string().optional(),
    bankName: z.string().min(1, "Bank name is required"),
    accountName: z.string().min(1, "Account holder name is required"),
    accountNumber: z.string().min(1, "Account number is required"),
    iban: z.string().optional(),
});

type PaymentMethodFormData = z.infer<typeof paymentMethodSchema>;

type PhoneFormData = { phone: string; };

const PaymentMethodForm: React.FC<{
    method?: PaymentMethod;
    onSave: (data: PaymentMethodFormData) => void;
    onClose: () => void;
}> = ({ method, onSave, onClose }) => {

    const form = useForm<PaymentMethodFormData>({
        resolver: zodResolver(paymentMethodSchema),
        defaultValues: method || {
            bankName: '',
            accountName: '',
            accountNumber: '',
            iban: '',
        },
    });

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
                 <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Bank Name</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a bank" />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {PAKISTANI_BANKS.map((bank) => (
                                    <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                <FormField name="accountName" control={form.control} render={({ field }) => (<FormItem><FormLabel>Account Name</FormLabel><FormControl><Input placeholder="e.g., John Doe" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField name="accountNumber" control={form.control} render={({ field }) => (<FormItem><FormLabel>Account Number</FormLabel><FormControl><Input placeholder="e.g., 01234567890" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField name="iban" control={form.control} render={({ field }) => (<FormItem><FormLabel>IBAN (Optional)</FormLabel><FormControl><Input placeholder="e.g., PK12..." {...field} /></FormControl><FormMessage /></FormItem>)} />

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="submit">
                        <Save className="mr-2 h-4 w-4" /> Save Method
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};

export default function PaymentMethodsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { paymentMethods, updateSettings } = useAppStore(state => ({
    paymentMethods: state.settings.paymentMethods || [],
    updateSettings: state.updateSettings,
  }));
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isWhatsAppDialogOpen, setIsWhatsAppDialogOpen] = useState(false);
  const [selectedMethodForWhatsApp, setSelectedMethodForWhatsApp] = useState<PaymentMethod | null>(null);

  const phoneForm = useForm<PhoneFormData>({
    defaultValues: { phone: '' }
  });


  const filteredPaymentMethods = useMemo(() => {
    if (!searchTerm) {
        return paymentMethods;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return paymentMethods.filter(method =>
        method.bankName.toLowerCase().includes(lowercasedFilter) ||
        method.accountName.toLowerCase().includes(lowercasedFilter) ||
        method.accountNumber.includes(searchTerm)
    );
  }, [paymentMethods, searchTerm]);


  const handleCopyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to Clipboard", description: `${fieldName} has been copied.` });
  };

  const openWhatsAppDialog = (method: PaymentMethod) => {
    setSelectedMethodForWhatsApp(method);
    setIsWhatsAppDialogOpen(true);
  };

  const handleSendWhatsApp = (data: PhoneFormData) => {
    if (!selectedMethodForWhatsApp || !data.phone) {
        toast({ title: "Missing Information", description: "Please select a method and enter a phone number.", variant: "destructive" });
        return;
    }

    let message = `Here are the payment details for your order:\n\n`;
    message += `*Bank:* ${selectedMethodForWhatsApp.bankName}\n`;
    message += `*Account Name:* ${selectedMethodForWhatsApp.accountName}\n`;
    message += `*Account Number:* ${selectedMethodForWhatsApp.accountNumber}\n`;
    if (selectedMethodForWhatsApp.iban) {
      message += `*IBAN:* ${selectedMethodForWhatsApp.iban}\n`;
    }
    message += `\nPlease send a screenshot of the transaction once completed. Thank you!`;

    const numberOnly = data.phone.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${numberOnly}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    toast({ title: "Redirecting to WhatsApp", description: "Your message is ready to be sent." });
    setIsWhatsAppDialogOpen(false);
    phoneForm.reset();
  };


  const handleSaveMethod = async (data: PaymentMethodFormData) => {
    setIsSaving(true);
    let updatedMethods;

    if (editingMethod) { // Editing existing method
      updatedMethods = paymentMethods.map(m => m.id === editingMethod.id ? { ...m, ...data } : m);
    } else { // Adding new method
      const newMethod: PaymentMethod = { ...data, id: `pm-${Date.now()}` };
      updatedMethods = [...paymentMethods, newMethod];
    }
    
    try {
        await updateSettings({ paymentMethods: updatedMethods });
        toast({ title: "Success", description: `Payment method ${editingMethod ? 'updated' : 'added'} successfully.` });
        setIsFormOpen(false);
        setEditingMethod(undefined);
    } catch (e) {
        toast({ title: "Error", description: "Failed to save payment method.", variant: "destructive" });
    } finally {
        setIsSaving(false);
    }
  };

  const handleDeleteMethod = async (id: string) => {
    setIsSaving(true);
    const updatedMethods = paymentMethods.filter(m => m.id !== id);
    try {
        await updateSettings({ paymentMethods: updatedMethods });
        toast({ title: "Deleted", description: "Payment method removed." });
    } catch (e) {
         toast({ title: "Error", description: "Failed to delete payment method.", variant: "destructive" });
    } finally {
        setIsSaving(false);
    }
  };
  
  const getQrValue = (method: PaymentMethod) => {
      return `Bank: ${method.bankName}\nAccount Name: ${method.accountName}\nAccount #: ${method.accountNumber}${method.iban ? `\nIBAN: ${method.iban}` : ''}`;
  }

  return (
    <div className="container mx-auto p-4 space-y-8">
       <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{editingMethod ? 'Edit' : 'Add'} Payment Method</DialogTitle>
                    <DialogDescription>
                        Fill in the bank account details. This will be visible to share with customers.
                    </DialogDescription>
                </DialogHeader>
                <PaymentMethodForm
                    method={editingMethod}
                    onSave={handleSaveMethod}
                    onClose={() => setIsFormOpen(false)}
                />
            </DialogContent>
        </Dialog>
        
        <Dialog open={isWhatsAppDialogOpen} onOpenChange={setIsWhatsAppDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Send Payment Details</DialogTitle>
                    <DialogDescription>
                        Enter the customer's WhatsApp number to send the details for {selectedMethodForWhatsApp?.bankName}.
                    </DialogDescription>
                </DialogHeader>
                 <Form {...phoneForm}>
                    <form onSubmit={phoneForm.handleSubmit(handleSendWhatsApp)} className="space-y-4 py-4">
                        <FormField
                            control={phoneForm.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Customer WhatsApp Number</FormLabel>
                                <FormControl>
                                    <PhoneInput
                                        name={field.name} value={field.value} onChange={field.onChange}
                                        onBlur={field.onBlur} ref={field.ref} defaultCountry="PK"
                                        international
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                                    />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                         <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit">
                                <MessageSquare className="mr-2 h-4 w-4" /> Send
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>

      <header>
        <Button variant="outline" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
        <div className="flex justify-between items-start">
            <div>
                <h1 className="text-3xl font-bold text-primary flex items-center"><Landmark className="mr-3 h-8 w-8"/>Payment Methods</h1>
                <p className="text-muted-foreground">Manage your bank details to share with customers for seamless payments.</p>
            </div>
            <Button onClick={() => { setEditingMethod(undefined); setIsFormOpen(true); }}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add New Method
            </Button>
        </div>
      </header>
      
      <Card>
        <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                    placeholder="Search by bank name, account name, or account number..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                />
            </div>
        </CardContent>
      </Card>


      {filteredPaymentMethods.length === 0 ? (
        <Card>
            <CardHeader>
                <CardTitle>No Payment Methods Found</CardTitle>
            </CardHeader>
            <CardContent>
                <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Get Started</AlertTitle>
                    <AlertDescription>
                        {searchTerm ? "No methods match your search." : "Click 'Add New Method' to add your first bank account."}
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredPaymentMethods.map(method => (
            <Card key={method.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="flex items-center gap-3">
                      <Landmark className="h-6 w-6 text-primary" />
                      {method.bankName}
                    </CardTitle>
                    <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingMethod(method); setIsFormOpen(true); }}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteMethod(method.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                </div>
                <CardDescription>Account Holder: {method.accountName}</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow space-y-2">
                 <div className="flex justify-center mb-4 p-4 border rounded-md bg-card">
                    <div className="bg-white p-2 rounded-md">
                        <QRCode
                            value={getQrValue(method)}
                            size={128}
                            level="H"
                        />
                    </div>
                </div>
                <div className="flex justify-between items-center py-1.5">
                    <span className="text-sm text-muted-foreground">Account #:</span>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{method.accountNumber}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopyToClipboard(method.accountNumber, "Account Number")}><Copy className="h-3.5 w-3.5" /></Button>
                    </div>
                </div>
                {method.iban && (
                    <div className="flex justify-between items-center py-1.5">
                        <span className="text-sm text-muted-foreground">IBAN:</span>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{method.iban}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => method.iban && handleCopyToClipboard(method.iban, "IBAN")}><Copy className="h-3.5 w-3.5" /></Button>
                        </div>
                    </div>
                )}
              </CardContent>
              <CardFooter>
                <Button className="w-full" onClick={() => openWhatsAppDialog(method)}>
                  <MessageSquare className="mr-2 h-4 w-4" /> Send to Customer
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
