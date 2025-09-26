
"use client";

import React from 'react';
import Image from 'next/image';
import { useAppStore, PaymentMethod } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Landmark, MessageSquare, ArrowLeft, Info, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const DetailRow: React.FC<{ label: string; value: string; onCopy: () => void }> = ({ label, value, onCopy }) => (
  <div className="flex justify-between items-center py-1.5">
    <span className="text-sm text-muted-foreground">{label}:</span>
    <div className="flex items-center gap-2">
      <span className="font-semibold text-sm">{value}</span>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>
);

export default function PaymentMethodsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const paymentMethods = useAppStore(state => state.settings.paymentMethods);

  const handleCopyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to Clipboard", description: `${fieldName} has been copied.` });
  };

  const handleSendWhatsApp = (method: PaymentMethod) => {
    let message = `Here are the payment details for your order:\n\n`;
    message += `*Bank:* ${method.bankName}\n`;
    message += `*Account Name:* ${method.accountName}\n`;
    message += `*Account Number:* ${method.accountNumber}\n`;
    if (method.iban) {
      message += `*IBAN:* ${method.iban}\n`;
    }
    message += `\nPlease send a screenshot of the transaction once completed. Thank you!`;

    // Prompt for customer's number
    const customerNumber = prompt("Please enter the customer's WhatsApp number (e.g., 923001234567):");
    if (customerNumber) {
      const numberOnly = customerNumber.replace(/\D/g, '');
      const whatsappUrl = `https://wa.me/${numberOnly}?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, '_blank');
      toast({ title: "Redirecting to WhatsApp", description: "Your message is ready to be sent." });
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-8">
      <header>
        <Button variant="outline" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
        <h1 className="text-3xl font-bold text-primary flex items-center"><Landmark className="mr-3 h-8 w-8"/>Payment Methods</h1>
        <p className="text-muted-foreground">Easily share your bank details with customers for seamless payments.</p>
      </header>

      {paymentMethods.length === 0 ? (
        <Card>
            <CardHeader>
                <CardTitle>No Payment Methods Configured</CardTitle>
            </CardHeader>
            <CardContent>
                <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Get Started</AlertTitle>
                    <AlertDescription>
                        You haven't added any bank accounts yet. Go to the main settings page to add your payment methods.
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {paymentMethods.map(method => (
            <Card key={method.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Landmark className="h-6 w-6 text-primary" />
                  {method.bankName}
                </CardTitle>
                <CardDescription>Account Holder: {method.accountName}</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow space-y-2">
                {method.qrCodeUrl && (
                    <div className="flex justify-center mb-4 p-2 border rounded-md bg-white">
                        <Image src={method.qrCodeUrl} alt={`${method.bankName} QR Code`} width={150} height={150} className="object-contain"/>
                    </div>
                )}
                <DetailRow label="Account #" value={method.accountNumber} onCopy={() => handleCopyToClipboard(method.accountNumber, "Account Number")} />
                {method.iban && <DetailRow label="IBAN" value={method.iban} onCopy={() => handleCopyToClipboard(method.iban, "IBAN")} />}
              </CardContent>
              <CardFooter>
                <Button className="w-full" onClick={() => handleSendWhatsApp(method)}>
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

