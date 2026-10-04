'use client';

/**
 * Who a saved sale was for, set on the invoice itself (2026-10-04). The audit found a quarter of
 * invoices re-saved after the sale, a quarter of those to change the customer — usually a walk-in
 * named once the bill was out (lib/walk-in.ts: bill first, name after). That took Edit invoice →
 * the whole sale form → Update, which re-priced every piece. This changes the name and moves the
 * sale's ledger line to them; nothing is re-priced (store.setInvoiceCustomer).
 */

import React, { useState } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import { useAppStore, type Invoice } from '@/lib/store';
import { isWalkInName } from '@/lib/walk-in';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { PhoneField } from '@/components/ui/phone-field';

export function SetCustomerDialog({ invoice, open, onOpenChange, onDone }: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (updated: Invoice) => void;
}) {
  const { toast } = useToast();
  const customers = useAppStore(s => s.customers);
  const setInvoiceCustomer = useAppStore(s => s.setInvoiceCustomer);
  const named = !!invoice.customerName && !isWalkInName(invoice.customerName);
  const [who, setWho] = useState<{ name: string; customerId?: string; phone?: string }>({ name: '' });
  const [busy, setBusy] = useState(false);
  const owes = (Number(invoice.balanceDue) || 0) > 0.5;

  const save = async () => {
    setBusy(true);
    try {
      const updated = await setInvoiceCustomer(invoice.id, who);
      if (updated) {
        onDone(updated);
        toast({ title: `${invoice.id} is ${updated.customerName}'s`, description: owes ? `The PKR ${Number(invoice.balanceDue).toLocaleString()} still owed is on their hisaab now.` : 'Nothing was re-priced.' });
        onOpenChange(false);
      }
    } catch (e) {
      toast({ title: 'Not changed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{named ? 'Change the customer' : 'Who was it for?'}</DialogTitle>
          <DialogDescription>
            {named ? `${invoice.id} is ${invoice.customerName}'s now.` : `${invoice.id} was saved as a walk-in.`} Pick them, or type a new name.
            {owes ? ' What is still owed moves to them.' : ''} The pieces and prices stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <CustomerAutocomplete customers={customers} value={who.name} onSelect={p => setWho({ name: p.name, customerId: p.customerId, phone: p.phone || who.phone })} placeholder="Name…" />
            <p className="text-[11px] text-muted-foreground">{who.customerId ? 'An existing customer.' : who.name.trim() ? 'A new customer will be made.' : ''}</p>
          </div>
          {!who.customerId && (
            <div className="space-y-1.5">
              <Label>Phone <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <PhoneField value={who.phone || ''} onChange={v => setWho(w => ({ ...w, phone: v || '' }))} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !who.name.trim() || isWalkInName(who.name)} onClick={save}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserCheck className="mr-1.5 h-4 w-4" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
