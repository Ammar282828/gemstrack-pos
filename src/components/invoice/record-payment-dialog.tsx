'use client';

/**
 * Take a payment on an invoice: the amount (the balance to start), how it was paid — which
 * must be chosen — and a reference. The same fields as the cart's "Record a payment".
 *
 * Invoices → "Mark Paid" used to record the whole balance at once, with no method and no
 * confirmation (the audit of 2026-10-01), so a misclick settled an invoice as cash that had
 * not been paid and nobody could tell a card payment from cash afterwards.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Banknote, Loader2 } from 'lucide-react';
import { useAppStore, PAYMENT_TYPES, type Invoice, type PaymentType } from '@/lib/store';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AmountInput } from '@/components/ui/amount-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { balanceLine, canHoldCredit } from '@/lib/invoice-credit';

export function RecordPaymentDialog({ invoice, open, onOpenChange }: {
  invoice: Pick<Invoice, 'id' | 'balanceDue' | 'customerName' | 'customerId'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateInvoicePayment = useAppStore(s => s.updateInvoicePayment);
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [method, setMethod] = useState<PaymentType | ''>('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  // A double tap must not record two payments (INV-000257 had two, 1.3 s apart).
  const lock = useRef(false);

  useEffect(() => {
    if (open && invoice) { setAmount(invoice.balanceDue); setMethod(''); setReference(''); }
  }, [open, invoice]);

  const balance = invoice?.balanceDue ?? 0;
  // Over the balance is credit for a named customer (lib/invoice-credit.ts); a walk-in's extra is change.
  const over = amount ? Math.round(amount - Math.max(0, balance)) : 0;
  const creditOk = canHoldCredit(invoice?.customerId);
  const problem = !amount || amount <= 0 ? 'Enter the amount received.'
    : over > 0 && !creditOk ? `More than the balance of PKR ${balance.toLocaleString()}. Credit needs a customer: name who this invoice is for first.`
    : !method ? 'Choose how it was paid.' : null;
  const creditNote = over > 0 && creditOk ? `PKR ${over.toLocaleString()} over the balance stays as credit on ${invoice?.customerName || 'the customer'}'s hisaab.` : null;

  const save = async () => {
    if (!invoice || problem || !method || !amount || lock.current) return;
    lock.current = true; setSaving(true);
    try {
      const updated = await updateInvoicePayment(invoice.id, amount, new Date().toISOString(), method, method === 'Cash' ? '' : reference);
      if (!updated) throw new Error();
      const after = balanceLine(updated.balanceDue);
      toast({ title: 'Payment recorded', description: `PKR ${amount.toLocaleString()} by ${method} on ${invoice.id}${after.state === 'due' ? `, PKR ${after.amount.toLocaleString()} still due` : after.state === 'credit' ? `, PKR ${after.amount.toLocaleString()} in credit` : ' — paid in full'}.` });
      onOpenChange(false);
    } catch {
      toast({ title: 'Payment not recorded', description: 'Check the connection and try again.', variant: 'destructive' });
    } finally { lock.current = false; setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment{invoice ? ` · ${invoice.id}` : ''}</DialogTitle>
          <DialogDescription>{invoice?.customerName ? `${invoice.customerName} · ` : ''}Balance PKR {balance.toLocaleString()}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount received (PKR)</Label>
            <AmountInput id="pay-amount" value={amount} emptyValue={undefined} onValueChange={setAmount} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Paid by</Label>
              <Select value={method} onValueChange={v => setMethod(v as PaymentType)}>
                <SelectTrigger aria-label="Payment method"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{PAYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{method === 'Cheque' ? 'Cheque no.' : method === 'Card' ? 'Last 4 digits' : method === 'Bank Transfer' ? 'Reference' : 'Note'}</Label>
              <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" disabled={method === 'Cash'} aria-label="Payment reference" />
            </div>
          </div>
          {problem && amount !== undefined && <p className="text-xs text-muted-foreground">{problem}</p>}
          {!problem && creditNote && <p className="text-xs font-medium text-success">{creditNote}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!!problem || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
