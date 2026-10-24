'use client';

/**
 * "Give back PKR X": the owner hands a customer the credit an invoice holds (owner, 2026-10-24: "in situations
 * with credit let me finish that credit by giving customer money"). The amount starts at the whole credit;
 * a part is allowed. It is a payment going out, not a refund of the sale (lib/writes/invoice-credit-payback.ts),
 * so it asks no delete code and tells Shopify nothing. Used on the invoice page and the customer's page.
 */

import { useState } from 'react';
import { Loader2, HandCoins } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AmountInput } from '@/components/ui/amount-input';
import { useToast } from '@/hooks/use-toast';
import { useAppStore, type Invoice, type PaymentType } from '@/lib/store';
import { balanceLine, canHoldCredit } from '@/lib/invoice-credit';
import { rupees } from '@/lib/money';

const pkr = (n: number) => `PKR ${rupees(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** How the money is handed over: cash or a bank transfer. */
const METHODS: PaymentType[] = ['Cash', 'Bank Transfer'];

/** The credit an invoice holds for a named customer; 0 when none (a walk-in's overpayment is change, not credit). */
export function creditHeld(inv: { customerId?: string | null; balanceDue?: number; status?: string } | null | undefined): number {
  if (!inv || inv.status === 'Refunded' || !canHoldCredit(inv.customerId)) return 0;
  const line = balanceLine(inv.balanceDue);
  return line.state === 'credit' ? rupees(line.amount) : 0;
}

export function GiveBackCredit({ invoiceId, customerName, credit, variant = 'outline', size, onDone }: {
  invoiceId: string;
  customerName?: string;
  credit: number;
  variant?: 'outline' | 'default' | 'ghost';
  size?: 'sm' | 'default';
  onDone?: (updated: Invoice) => void;
}) {
  const { toast } = useToast();
  const payBackCredit = useAppStore(s => s.payBackCredit);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentType>('Cash');
  const [busy, setBusy] = useState(false);

  if (!(credit > 0)) return null;
  const given = amount === '' ? credit : rupees(parseFloat(amount));
  const valid = given > 0 && given <= credit;

  const give = async () => {
    if (busy || !valid) return;
    setBusy(true);
    try {
      const updated = await payBackCredit(invoiceId, given, method);
      const left = balanceLine(updated.balanceDue);
      toast({ title: 'Credit given back', description: `${pkr(given)} by ${method} to ${customerName || 'the customer'}. ${left.state === 'credit' ? `${pkr(left.amount)} credit left.` : 'No credit left.'}` });
      setOpen(false);
      setAmount('');
      onDone?.(updated);
    } catch (e) {
      toast({ title: 'Not given back', description: e instanceof Error ? e.message : 'Could not record it.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => { setAmount(''); setOpen(true); }}>
        <HandCoins className="mr-2 h-4 w-4" /> Give back {pkr(credit)}
      </Button>
      <AlertDialog open={open} onOpenChange={o => { if (!busy) setOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give back credit on {invoiceId}</AlertDialogTitle>
            <AlertDialogDescription>
              {customerName || 'The customer'} paid {pkr(credit)} more than this invoice came to. Hand it over and the credit comes off their hisaab. The sale itself is not refunded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="payback-amount">Amount (PKR)</Label>
              <AmountInput maxDecimals={0} id="payback-amount" inputMode="decimal" placeholder={String(credit)}
                value={amount} onValueChange={v => setAmount(v === undefined ? '' : String(v))} disabled={busy} />
              {amount !== '' && given > credit && <p className="text-xs font-medium text-destructive">Only {pkr(credit)} is held.</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Paid by</Label>
              <Select value={method} onValueChange={v => setMethod(v as PaymentType)}>
                <SelectTrigger aria-label="How the money is handed over"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void give(); }} disabled={busy || !valid}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
              Give back {pkr(valid ? given : credit)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
