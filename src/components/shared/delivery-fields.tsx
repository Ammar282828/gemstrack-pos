"use client";

/**
 * "Is this being delivered?" — off by default, because most pieces are
 * collected from the shop.
 *
 * The address dropdown is not just the customer's saved address: it also
 * offers every address that customer has been delivered to before, which is
 * what you actually reach for on a repeat order. Picking "New address" drops
 * you into a free-text box.
 */

import React, { useMemo } from 'react';
import { DeliveryInfo } from '@/lib/store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

const NEW_ADDRESS = '__new__';

export const EMPTY_DELIVERY: DeliveryInfo = { required: false, address: '' };

export const DeliveryFields: React.FC<{
  value: DeliveryInfo;
  onChange: (next: DeliveryInfo) => void;
  /** Saved address plus anywhere this customer has been delivered before. */
  knownAddresses?: string[];
  className?: string;
}> = ({ value, onChange, knownAddresses = [], className }) => {
  const set = <K extends keyof DeliveryInfo>(k: K, v: DeliveryInfo[K]) =>
    onChange({ ...value, [k]: v });

  const options = useMemo(() => {
    const seen = new Set<string>();
    return knownAddresses
      .map(a => (a || '').trim())
      .filter(a => {
        const k = a.toLowerCase();
        if (!a || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [knownAddresses]);

  // A typed address that matches nothing on file means the picker sits on "new".
  const matched = options.find(o => o === value.address);

  return (
    <div className={cn('rounded-md border p-3 space-y-3', value.required && 'border-primary/40 bg-primary/[0.03]', className)}>
      <div className="flex items-center gap-2">
        <Checkbox id="needs-delivery" checked={value.required}
          onCheckedChange={c => onChange({ ...value, required: c === true })} />
        <Label htmlFor="needs-delivery" className="cursor-pointer flex items-center gap-1.5 font-medium">
          <Truck className="h-4 w-4 text-muted-foreground" />Deliver this
        </Label>
      </div>

      {value.required && (
        <div className="space-y-3 pt-1">
          {options.length > 0 && (
            <div>
              <Label className="text-xs">Address on file</Label>
              <Select
                value={matched ? matched : NEW_ADDRESS}
                onValueChange={v => set('address', v === NEW_ADDRESS ? '' : v)}
              >
                <SelectTrigger aria-label="Address on file">
                  <SelectValue placeholder="Pick an address" />
                </SelectTrigger>
                <SelectContent>
                  {options.map(a => (
                    <SelectItem key={a} value={a}>
                      <span className="line-clamp-1">{a}</span>
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_ADDRESS}>New address…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs">Delivery address</Label>
            <Textarea rows={2} value={value.address}
              onChange={e => set('address', e.target.value)}
              placeholder="House / flat, street, area" aria-label="Delivery address" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">City</Label>
              <Input value={value.city || ''} onChange={e => set('city', e.target.value)}
                placeholder="Karachi" aria-label="City" />
            </div>
            <div>
              <Label className="text-xs">Expected date</Label>
              <Input type="date" value={value.expectedDate || ''}
                onChange={e => set('expectedDate', e.target.value)} aria-label="Expected date" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Receiver name <span className="text-muted-foreground font-normal">(if not the customer)</span></Label>
              <Input value={value.contactName || ''} onChange={e => set('contactName', e.target.value)}
                placeholder="Optional" aria-label="Receiver name" />
            </div>
            <div>
              <Label className="text-xs">Receiver phone</Label>
              <Input value={value.contactPhone || ''} onChange={e => set('contactPhone', e.target.value)}
                placeholder="Optional" aria-label="Receiver phone" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Delivery charge (PKR)</Label>
              <Input type="number" value={value.charge ?? ''}
                onChange={e => set('charge', e.target.value === '' ? undefined : Number(e.target.value))}
                placeholder="0 if free" aria-label="Delivery charge (PKR)" />
            </div>
            <div>
              <Label className="text-xs">Instructions</Label>
              <Input value={value.notes || ''} onChange={e => set('notes', e.target.value)}
                placeholder="Landmark, timing, gate code" aria-label="Delivery instructions" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Every address this customer has been sent to before, newest first. */
export function knownAddressesFor(
  customerId: string | undefined,
  customerAddress: string | undefined,
  history: { customerId?: string; createdAt?: string; delivery?: DeliveryInfo }[],
): string[] {
  const past = history
    .filter(r => customerId && r.customerId === customerId && r.delivery?.address?.trim())
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .map(r => r.delivery!.address.trim());
  return [...past, ...(customerAddress?.trim() ? [customerAddress.trim()] : [])];
}
