"use client";

/**
 * Edit every attribute of a line on the estimate — not just its price.
 *
 * This is the dialog you reach after pulling an invoice back for editing, so
 * it has to cover anything that might have been wrong when the order was first
 * written up: the name, category, size, metal, weights, plating, and each of
 * the charge components. The running total updates as you type, using the same
 * calculateProductCosts the cart itself uses, so what you see here is what the
 * invoice will say.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Product, Settings, MetalType, KaratValue, calculateProductCosts,
  staticCategories, METAL_TYPES, KARAT_VALUES,
} from '@/lib/store';
import { metalLabel, karatLabel } from '@/lib/materials';
import { SizePicker } from '@/components/shared/size-picker';
import { PlatingFields } from '@/components/shared/plating-fields';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';

/** Everything the dialog edits, held as strings so inputs stay controlled. */
interface Draft {
  name: string;
  categoryId: string;
  size: string;
  metalType: MetalType;
  karat: string;
  metalWeightG: string;
  hasStones: boolean;
  stoneWeightG: string;
  wastagePercentage: string;
  makingCharges: string;
  hasDiamonds: boolean;
  diamondCharges: string;
  stoneCharges: string;
  miscCharges: string;
  stoneDetails: string;
  diamondDetails: string;
  description: string;
  platingType: string;
  platingNote: string;
  nickelFree: boolean;
  silverRatePerGram: string;
  isCustomPrice: boolean;
  customPrice: string;
}

const n = (v: string) => (v.trim() === '' ? 0 : Number(v)) || 0;

function toDraft(p: Product): Draft {
  return {
    name: p.name || '',
    categoryId: p.categoryId || '',
    size: p.size || '',
    metalType: p.metalType,
    karat: p.karat || '',
    metalWeightG: p.metalWeightG != null ? String(p.metalWeightG) : '',
    hasStones: !!p.hasStones,
    stoneWeightG: p.stoneWeightG != null ? String(p.stoneWeightG) : '',
    wastagePercentage: p.wastagePercentage != null ? String(p.wastagePercentage) : '',
    makingCharges: p.makingCharges != null ? String(p.makingCharges) : '',
    hasDiamonds: !!p.hasDiamonds,
    diamondCharges: p.diamondCharges != null ? String(p.diamondCharges) : '',
    stoneCharges: p.stoneCharges != null ? String(p.stoneCharges) : '',
    miscCharges: p.miscCharges != null ? String(p.miscCharges) : '',
    stoneDetails: p.stoneDetails || '',
    diamondDetails: p.diamondDetails || '',
    description: p.description || '',
    platingType: p.platingType || '',
    platingNote: p.platingNote || '',
    nickelFree: !!p.nickelFree,
    silverRatePerGram: p.silverRatePerGram != null ? String(p.silverRatePerGram) : '',
    isCustomPrice: !!p.isCustomPrice,
    customPrice: p.customPrice != null ? String(p.customPrice) : '',
  };
}

function toPatch(d: Draft): Partial<Product> {
  const isGold = d.metalType === 'gold';
  return {
    name: d.name.trim(),
    categoryId: d.categoryId,
    size: d.size.trim() || undefined,
    metalType: d.metalType,
    // Karat only means something on gold — a stray "21k" on silver was the
    // cause of the phantom karat that used to print on 925 pieces.
    karat: isGold && d.karat ? (d.karat as KaratValue) : undefined,
    metalWeightG: n(d.metalWeightG),
    hasStones: d.hasStones,
    stoneWeightG: n(d.stoneWeightG),
    wastagePercentage: n(d.wastagePercentage),
    makingCharges: n(d.makingCharges),
    hasDiamonds: d.hasDiamonds,
    diamondCharges: n(d.diamondCharges),
    stoneCharges: n(d.stoneCharges),
    miscCharges: n(d.miscCharges),
    stoneDetails: d.stoneDetails.trim() || undefined,
    diamondDetails: d.diamondDetails.trim() || undefined,
    description: d.description.trim() || undefined,
    platingType: d.metalType === 'silver' ? (d.platingType || undefined) : undefined,
    platingNote: d.metalType === 'silver' && d.platingType === 'Other' ? (d.platingNote.trim() || undefined) : undefined,
    nickelFree: d.metalType === 'silver' ? d.nickelFree : undefined,
    silverRatePerGram: d.metalType === 'silver' && d.silverRatePerGram ? n(d.silverRatePerGram) : undefined,
    isCustomPrice: d.isCustomPrice,
    customPrice: d.isCustomPrice ? n(d.customPrice) : undefined,
  };
}

const Num: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  step?: string; placeholder?: string; hint?: string;
}> = ({ label, value, onChange, step, placeholder, hint }) => (
  <div>
    <Label className="text-xs">{label}</Label>
    <Input type="number" step={step} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)} />
    {hint && <p className="text-2xs text-muted-foreground mt-0.5">{hint}</p>}
  </div>
);

export const EditCartItemDialog: React.FC<{
  item: Product | null;
  settings: Partial<Settings>;
  onClose: () => void;
  onSave: (sku: string, patch: Partial<Product>) => void;
}> = ({ item, settings, onClose, onSave }) => {
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => { setD(item ? toDraft(item) : null); }, [item]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD(prev => (prev ? { ...prev, [k]: v } : prev));

  // Live price, computed exactly the way the cart line does it.
  const preview = useMemo(() => {
    if (!item || !d) return 0;
    try {
      return calculateProductCosts({ ...item, ...toPatch(d) } as Product, settings).totalPrice;
    } catch { return 0; }
  }, [item, d, settings]);

  if (!item || !d) return null;

  const isGold = d.metalType === 'gold';
  const isSilver = d.metalType === 'silver';

  return (
    <Dialog open={!!item} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-2xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>
            {item.sku} — every detail on this line. Changes apply to this estimate only,
            not to the product in your inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── what it is ── */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Item name</Label>
              <Input value={d.name} onChange={e => set('name', e.target.value)} placeholder="What is being sold"  aria-label="Item name"/>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={d.categoryId} onValueChange={v => set('categoryId', v)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {staticCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Metal</Label>
                <Select value={d.metalType} onValueChange={v => set('metalType', v as MetalType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METAL_TYPES.map(m => <SelectItem key={m} value={m}>{metalLabel(m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Karat is gold-only, so it appears and disappears with the metal. */}
            {isGold && (
              <div className="sm:w-1/2">
                <Label className="text-xs">Karat</Label>
                <Select value={d.karat} onValueChange={v => set('karat', v)}>
                  <SelectTrigger><SelectValue placeholder="Select karat" /></SelectTrigger>
                  <SelectContent>
                    {KARAT_VALUES.map(k => <SelectItem key={k} value={k}>{karatLabel(k)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <SizePicker categoryId={d.categoryId} value={d.size} onChange={v => set('size', v)} alwaysShow />

            <PlatingFields
              metalType={d.metalType}
              value={{ platingType: d.platingType, platingNote: d.platingNote, nickelFree: d.nickelFree }}
              onChange={p => setD(prev => prev ? {
                ...prev,
                platingType: p.platingType ?? '',
                platingNote: p.platingNote ?? '',
                nickelFree: !!p.nickelFree,
              } : prev)}
            />
          </div>

          <Separator />

          {/* ── what it costs ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox id="manual-price" checked={d.isCustomPrice}
                onCheckedChange={c => set('isCustomPrice', c === true)} />
              <Label htmlFor="manual-price" className="cursor-pointer text-sm">
                Set the price by hand
              </Label>
            </div>

            {d.isCustomPrice ? (
              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <Num label="Price (PKR)" value={d.customPrice} onChange={v => set('customPrice', v)} placeholder="e.g. 5000" />
                {isSilver && (
                  <Num label="Reference rate per gram (optional)" value={d.silverRatePerGram}
                    onChange={v => set('silverRatePerGram', v)} placeholder="e.g. 150"
                    hint="Recorded for your reference — does not affect the price." />
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Num label="Metal weight (g)" value={d.metalWeightG} onChange={v => set('metalWeightG', v)} step="0.001" />
                  <Num label="Stone weight (g)" value={d.stoneWeightG} onChange={v => set('stoneWeightG', v)} step="0.001" />
                  {isSilver
                    ? <Num label="Rate per gram" value={d.silverRatePerGram} onChange={v => set('silverRatePerGram', v)} placeholder="e.g. 150" />
                    : <Num label="Wastage %" value={d.wastagePercentage} onChange={v => set('wastagePercentage', v)} step="0.01" />}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {isSilver && <Num label="Wastage %" value={d.wastagePercentage} onChange={v => set('wastagePercentage', v)} step="0.01" />}
                  <Num label="Making" value={d.makingCharges} onChange={v => set('makingCharges', v)} />
                  <Num label="Diamond" value={d.diamondCharges} onChange={v => set('diamondCharges', v)} />
                  <Num label="Stone" value={d.stoneCharges} onChange={v => set('stoneCharges', v)} />
                  {!isSilver && <Num label="Misc" value={d.miscCharges} onChange={v => set('miscCharges', v)} />}
                </div>
                {isSilver && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Num label="Misc" value={d.miscCharges} onChange={v => set('miscCharges', v)} />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox id="has-stones" checked={d.hasStones} onCheckedChange={c => set('hasStones', c === true)} />
                <Label htmlFor="has-stones" className="cursor-pointer text-sm font-normal">Has stones</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="has-diamonds" checked={d.hasDiamonds} onCheckedChange={c => set('hasDiamonds', c === true)} />
                <Label htmlFor="has-diamonds" className="cursor-pointer text-sm font-normal">Has diamonds</Label>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── the words that print ── */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Stone details</Label>
                <Input value={d.stoneDetails} onChange={e => set('stoneDetails', e.target.value)} placeholder="e.g. 4 rubies"  aria-label="Stone details"/>
              </div>
              <div>
                <Label className="text-xs">Diamond details</Label>
                <Input value={d.diamondDetails} onChange={e => set('diamondDetails', e.target.value)} placeholder="e.g. 0.5ct round"  aria-label="Diamond details"/>
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea rows={2} value={d.description} onChange={e => set('description', e.target.value)}
                placeholder="Anything else that should appear on the invoice"  aria-label="Description"/>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between items-stretch sm:items-center">
          <div className="text-sm">
            <span className="text-muted-foreground">Line total </span>
            <span className="font-semibold tabular-nums">
              PKR {preview.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 sm:flex-none" onClick={() => { onSave(item.sku, toPatch(d)); onClose(); }}>
              <Save className="h-4 w-4 mr-2" />Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
