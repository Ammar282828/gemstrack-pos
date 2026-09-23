"use client";

/**
 * Repairs: a customer's own piece, in for mending.
 *
 * The life of one is four steps, each a single button on its row:
 *   In the shop → Being worked on → Ready → Collected
 * It is weighed in and weighed out, can go to a karigar, and gets a printed
 * receipt at both ends. Money taken — an advance at the counter, the balance
 * on collection — lands in Extra Revenue in the same write (see the store), so
 * the day's takings include it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO, addDays, differenceInCalendarDays, startOfMonth } from 'date-fns';
import QRCode from 'qrcode.react';
import {
  useAppStore, type Repair, type RepairStatus, type PaymentType, REPAIR_STATUS_LABELS, REPAIR_WORK,
  PAYMENT_TYPES, repairBalance, repairPaid, METAL_TYPES, KARAT_VALUES, metalLabel,
} from '@/lib/store';
import type { MetalType, KaratValue } from '@/lib/materials';
import { useAppReady } from '@/hooks/use-store';
import { useToast } from '@/hooks/use-toast';
import { STORE_CONFIG, storeLinksUrl } from '@/lib/store-config';
import { whatsAppLink } from '@/lib/whatsapp';
import { normalizePhoneNumber, cn } from '@/lib/utils';
import { saveRepairPdf } from '@/lib/repair-pdf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AmountInput } from '@/components/ui/amount-input';
import { PhoneField } from '@/components/ui/phone-field';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { KarigarPicker, UNASSIGNED_VALUE } from '@/components/karigar/karigar-picker';
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import { FilterBar } from '@/components/shared/filter-bar';
import { ListSkeleton } from '@/components/shared/skeletons';
import { Wrench, PlusCircle, Printer, Edit, Trash2, MessageCircle, Play, CheckCircle2, PackageCheck, Loader2, Lock } from 'lucide-react';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const day = (iso?: string) => { if (!iso) return ''; try { return format(parseISO(iso), 'd MMM yy'); } catch { return iso; } };
const OPEN: RepairStatus[] = ['received', 'in_progress', 'ready'];

type Tab = 'open' | 'ready' | 'collected' | 'cancelled' | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'ready', label: 'Ready' },
  { key: 'collected', label: 'Collected' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const STATUS_TONE: Record<RepairStatus, string> = {
  received: 'border-warning text-warning',
  in_progress: 'border-primary text-primary',
  ready: 'border-success text-success bg-success/10',
  collected: 'border-muted-foreground/40 text-muted-foreground',
  cancelled: 'border-destructive/50 text-destructive',
};

/** Promised and not yet ready: how many days late (0 = today), or null. */
function lateBy(r: Repair, today: Date): number | null {
  if (!r.promisedDate || !(r.status === 'received' || r.status === 'in_progress')) return null;
  const d = differenceInCalendarDays(today, parseISO(r.promisedDate));
  return d >= 0 ? d : null;
}

// ── The intake / edit form ──────────────────────────────────────────────────
type Draft = {
  customerName: string; customerId?: string; customerContact: string;
  item: string; metalType?: MetalType; karat?: KaratValue; weightInG?: number;
  work: string[]; details: string;
  estimate?: number; advance?: number; advanceMethod: PaymentType;
  promisedDate: string; karigarId: string; karigarCost?: number;
  takenBy?: string; internalNote: string;
};

const blankDraft = (): Draft => ({
  customerName: '', customerContact: '', item: '', metalType: STORE_CONFIG.defaultMetal, karat: STORE_CONFIG.defaultMetal === 'gold' ? '21k' : undefined,
  work: [], details: '', advanceMethod: 'Cash', promisedDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
  karigarId: '', internalNote: '',
});

const draftOf = (r: Repair): Draft => ({
  customerName: r.customerName || '', customerId: r.customerId, customerContact: r.customerContact || '',
  item: r.item, metalType: r.metalType, karat: r.karat, weightInG: r.weightInG,
  work: r.work || [], details: r.details || '', estimate: r.estimate, advanceMethod: 'Cash',
  promisedDate: r.promisedDate || '', karigarId: r.karigarId || '', karigarCost: r.karigarCost,
  takenBy: r.takenBy, internalNote: r.internalNote || '',
});

function RepairForm({ repair, onDone }: { repair?: Repair; onDone: (saved?: Repair) => void }) {
  const { toast } = useToast();
  const { customers, karigars, addRepair, updateRepair, recordRepairPayment, loadCustomers, loadKarigars } = useAppStore();
  const [d, setD] = useState<Draft>(() => (repair ? draftOf(repair) : blankDraft()));
  const [saving, setSaving] = useState(false);
  const [pay, setPay] = useState<{ amount?: number; method: PaymentType }>({ method: 'Cash' });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => { loadCustomers(); loadKarigars(); }, [loadCustomers, loadKarigars]);

  const toggleWork = (w: string) => set('work', d.work.includes(w) ? d.work.filter((x) => x !== w) : [...d.work, w]);

  const save = async () => {
    if (!d.item.trim()) { toast({ title: 'Describe the piece', description: 'What was brought in — "gold ring with a ruby".', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const karigar = karigars.find((k) => k.id === d.karigarId);
      const fields = {
        customerName: d.customerName.trim(),
        customerId: d.customerId,
        customerContact: d.customerContact || undefined,
        item: d.item.trim(),
        metalType: d.metalType,
        karat: d.metalType === 'gold' ? d.karat : undefined,
        weightInG: d.weightInG || undefined,
        work: d.work,
        details: d.details.trim() || undefined,
        estimate: d.estimate || undefined,
        promisedDate: d.promisedDate || undefined,
        karigarId: karigar?.id,
        karigarName: karigar?.name,
        karigarCost: karigar ? d.karigarCost || undefined : undefined,
        takenBy: d.takenBy,
        internalNote: d.internalNote.trim() || undefined,
      };
      if (repair) {
        await updateRepair(repair.id, fields);
        toast({ title: 'Repair updated', description: repair.id });
        onDone();
      } else {
        const created = await addRepair({ ...fields, receivedAt: new Date().toISOString(), advance: d.advance, advanceMethod: d.advanceMethod });
        toast({ title: `Repair ${created.id} received`, description: 'Print the receipt for the customer.' });
        onDone(created);
      }
    } catch (e) {
      toast({ title: 'Could not save the repair', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const takePayment = async () => {
    if (!repair || !(pay.amount && pay.amount > 0)) return;
    setSaving(true);
    try {
      await recordRepairPayment(repair.id, { amount: pay.amount, date: new Date().toISOString(), method: pay.method });
      toast({ title: `${pkr(pay.amount)} received`, description: `Recorded against ${repair.id} and in Extra Revenue.` });
      setPay({ method: 'Cash' });
    } catch (e) {
      toast({ title: 'Could not record the payment', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pt-1">
      {/* Whose */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Customer</Label>
          <CustomerAutocomplete
            customers={customers}
            value={d.customerName}
            onSelect={({ name, customerId, phone }) => setD((x) => ({
              ...x, customerName: name, customerId,
              customerContact: phone !== undefined ? normalizePhoneNumber(phone) : x.customerContact,
            }))}
            placeholder="Name, or leave blank for walk-in"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <div className="mt-1"><PhoneField value={d.customerContact || undefined} onChange={(v) => set('customerContact', v || '')} aria-label="Customer phone" /></div>
        </div>
      </div>

      {/* What */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs" htmlFor="repair-item">The piece</Label>
          <Input id="repair-item" className="mt-1" value={d.item} onChange={(e) => set('item', e.target.value)} placeholder="e.g. Gold ring with a ruby, ladies' bangle" />
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Metal</Label>
            <Select value={d.metalType || ''} onValueChange={(v) => { if (v) set('metalType', v as MetalType); }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Metal" /></SelectTrigger>
              <SelectContent>{METAL_TYPES.map((m) => <SelectItem key={m} value={m}>{metalLabel(m)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {d.metalType === 'gold' && (
            <div>
              <Label className="text-xs">Karat</Label>
              <Select value={d.karat || ''} onValueChange={(v) => { if (v) set('karat', v as KaratValue); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Karat" /></SelectTrigger>
                <SelectContent>{KARAT_VALUES.map((k) => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Weight in (g)</Label>
            <AmountInput className="mt-1" value={d.weightInG} maxDecimals={3} zeroAsEmpty placeholder="Weigh it now"
              onValueChange={(v) => set('weightInG', v === undefined ? undefined : Number(v))} aria-label="Weight in grams" />
          </div>
        </div>
      </div>

      {/* The work */}
      <div>
        <Label className="text-xs">Work</Label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {REPAIR_WORK.map((w) => (
            <button key={w} type="button" onClick={() => toggleWork(w)} aria-pressed={d.work.includes(w)}
              className={cn('rounded-full border px-3 py-1.5 text-xs transition-colors',
                d.work.includes(w) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>
              {w}
            </button>
          ))}
        </div>
        <Textarea className="mt-2" rows={2} value={d.details} onChange={(e) => set('details', e.target.value)}
          placeholder="Exactly what — size 12 to 14, the left stone is missing, re-plate in rhodium…" />
      </div>

      {/* Money and time */}
      <div className="grid gap-3 grid-cols-2">
        <div>
          <Label className="text-xs">Estimate (PKR)</Label>
          <AmountInput className="mt-1" value={d.estimate} zeroAsEmpty placeholder="What the customer was told"
            onValueChange={(v) => set('estimate', v === undefined ? undefined : Number(v))} aria-label="Estimate" />
        </div>
        <div>
          <Label className="text-xs">Ready by</Label>
          <Input type="date" className="mt-1" value={d.promisedDate} onChange={(e) => set('promisedDate', e.target.value)} />
          <div className="mt-1.5 flex gap-1.5">
            {[3, 7, 14].map((n) => (
              <button key={n} type="button" onClick={() => set('promisedDate', format(addDays(new Date(), n), 'yyyy-MM-dd'))}
                className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">{n}d</button>
            ))}
          </div>
        </div>
      </div>

      {!repair && (
        <div className="grid gap-3 grid-cols-2 rounded-md border bg-muted/30 p-3">
          <div>
            <Label className="text-xs">Advance taken now (PKR)</Label>
            <AmountInput className="mt-1" value={d.advance} zeroAsEmpty placeholder="Nothing"
              onValueChange={(v) => set('advance', v === undefined ? undefined : Number(v))} aria-label="Advance" />
          </div>
          <div>
            <Label className="text-xs">Paid by</Label>
            <Select value={d.advanceMethod} onValueChange={(v) => { if (v) set('advanceMethod', v as PaymentType); }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="col-span-2 text-2xs text-muted-foreground">An advance is added to Extra Revenue straight away.</p>
        </div>
      )}

      {/* Who does it */}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_1fr]">
        <div>
          <Label className="text-xs">Karigar</Label>
          <div className="mt-1">
            <KarigarPicker value={d.karigarId || UNASSIGNED_VALUE} onChange={(v) => set('karigarId', v === UNASSIGNED_VALUE ? '' : v)} placeholder="Done in the shop" clearLabel="No karigar" />
          </div>
        </div>
        {d.karigarId && (
          <div>
            <Label className="text-xs">Karigar charge</Label>
            <AmountInput className="mt-1" value={d.karigarCost} zeroAsEmpty placeholder="PKR"
              onValueChange={(v) => set('karigarCost', v === undefined ? undefined : Number(v))} aria-label="Karigar charge" />
          </div>
        )}
        <div>
          <Label className="text-xs">Taken by</Label>
          <div className="mt-1"><TakenByPicker value={d.takenBy || ''} onChange={(v) => set('takenBy', v)} aria-label="Taken by" /></div>
        </div>
      </div>

      <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
        <Label className="text-xs flex items-center text-warning"><Lock className="mr-1.5 h-3.5 w-3.5" />For the shop (never printed)</Label>
        <Textarea className="mt-1.5 bg-background" rows={2} value={d.internalNote} onChange={(e) => set('internalNote', e.target.value)} placeholder="A scratch on the band already; customer wants it back before Friday…" />
      </div>

      {/* Payments on an existing repair */}
      {repair && (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-medium">Payments</p>
          {repair.payments?.length ? (
            <ul className="space-y-1 text-sm">
              {repair.payments.map((p, i) => (
                <li key={i} className="flex justify-between gap-3"><span className="text-muted-foreground">{day(p.date)}{p.method ? ` · ${p.method}` : ''}{p.note ? ` · ${p.note}` : ''}</span><span className="tabular-nums">{pkr(p.amount)}</span></li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Nothing paid yet.</p>}
          {!['collected', 'cancelled'].includes(repair.status) && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="w-32"><AmountInput value={pay.amount} zeroAsEmpty placeholder="Amount" onValueChange={(v) => setPay((p) => ({ ...p, amount: v === undefined ? undefined : Number(v) }))} aria-label="Payment amount" /></div>
              <Select value={pay.method} onValueChange={(v) => { if (v) setPay((p) => ({ ...p, method: v as PaymentType })); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" className="h-10" disabled={saving || !(pay.amount && pay.amount > 0)} onClick={takePayment}>Take payment</Button>
            </div>
          )}
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{repair ? 'Save changes' : 'Receive the piece'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── The two steps that ask something ────────────────────────────────────────
function ReadyDialog({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  const { setRepairStatus } = useAppStore();
  const { toast } = useToast();
  const [charge, setCharge] = useState<number | undefined>(repair.charge ?? repair.estimate);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await setRepairStatus(repair.id, 'ready', { charge: charge ?? 0 });
      toast({ title: `${repair.id} is ready`, description: repair.customerContact ? 'Send the customer a WhatsApp from its row.' : undefined });
      onClose();
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ready for collection</DialogTitle>
          <DialogDescription>{repair.item} — {repair.customerName || 'walk-in'}</DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Final charge (PKR)</Label>
          <AmountInput className="mt-1" value={charge} placeholder="0 for no charge" onValueChange={(v) => setCharge(v === undefined ? undefined : Number(v))} aria-label="Final charge" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {repair.estimate ? `Estimated at ${pkr(repair.estimate)}. ` : ''}{repairPaid(repair) > 0 ? `${pkr(repairPaid(repair))} already paid.` : ''}
          </p>
        </div>
        <DialogFooter><Button onClick={go} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark ready</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollectDialog({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  const { setRepairStatus, recordRepairPayment } = useAppStore();
  const { toast } = useToast();
  const balance = repairBalance(repair);
  const [weightOut, setWeightOut] = useState<number | undefined>(undefined);
  const [amount, setAmount] = useState<number | undefined>(balance || undefined);
  const [method, setMethod] = useState<PaymentType>('Cash');
  const [busy, setBusy] = useState(false);
  const diff = repair.weightInG && weightOut ? Math.round((weightOut - repair.weightInG) * 1000) / 1000 : null;
  const go = async () => {
    setBusy(true);
    try {
      if (amount && amount > 0) await recordRepairPayment(repair.id, { amount, date: new Date().toISOString(), method, note: 'On collection' });
      await setRepairStatus(repair.id, 'collected', weightOut ? { weightOutG: weightOut } : {});
      toast({ title: `${repair.id} handed back`, description: amount ? `${pkr(amount)} added to Extra Revenue.` : undefined });
      onClose();
    } catch (e) {
      toast({ title: 'Could not hand it over', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hand it back</DialogTitle>
          <DialogDescription>{repair.item} — {repair.customerName || 'walk-in'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Weight out (g)</Label>
            <AmountInput className="mt-1" value={weightOut} maxDecimals={3} zeroAsEmpty placeholder={repair.weightInG ? `In at ${repair.weightInG.toFixed(3)} g` : 'Weigh it'}
              onValueChange={(v) => setWeightOut(v === undefined ? undefined : Number(v))} aria-label="Weight out" />
            {diff !== null && diff !== 0 && (
              <p className={cn('mt-1 text-xs', diff < 0 ? 'text-warning' : 'text-muted-foreground')}>
                {diff > 0 ? '+' : ''}{diff.toFixed(3)} g against the weight it came in at{diff < 0 ? ' — worth mentioning to the customer.' : '.'}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Payment now</Label>
              <AmountInput className="mt-1" value={amount} zeroAsEmpty placeholder="Nothing" onValueChange={(v) => setAmount(v === undefined ? undefined : Number(v))} aria-label="Payment now" />
            </div>
            <div>
              <Label className="text-xs">Paid by</Label>
              <Select value={method} onValueChange={(v) => { if (v) setMethod(v as PaymentType); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Balance due: <span className="font-medium text-foreground">{pkr(balance)}</span></p>
        </div>
        <DialogFooter><Button onClick={go} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Collected</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
export default function RepairsPage() {
  const appReady = useAppReady();
  const { toast } = useToast();
  const { repairs, isRepairsLoading, loadRepairs, loadAdditionalRevenues, setRepairStatus, deleteRepair } = useAppStore();
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Repair | 'new' | null>(null);
  const [step, setStep] = useState<{ kind: 'ready' | 'collect'; repair: Repair } | null>(null);
  const [today] = useState(() => new Date());

  useEffect(() => { if (appReady) { loadRepairs(); loadAdditionalRevenues(); } }, [appReady, loadRepairs, loadAdditionalRevenues]);

  const counts = useMemo(() => {
    const monthStart = startOfMonth(today).toISOString();
    return {
      inShop: repairs.filter((r) => r.status === 'received' || r.status === 'in_progress').length,
      ready: repairs.filter((r) => r.status === 'ready'),
      late: repairs.filter((r) => lateBy(r, today) !== null && lateBy(r, today)! > 0).length,
      collectedThisMonth: repairs.filter((r) => r.status === 'collected' && (r.collectedAt || '') >= monthStart).length,
    };
  }, [repairs, today]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = repairs.filter((r) => {
      if (tab === 'open' && !OPEN.includes(r.status)) return false;
      if (tab === 'ready' && r.status !== 'ready') return false;
      if (tab === 'collected' && r.status !== 'collected') return false;
      if (tab === 'cancelled' && r.status !== 'cancelled') return false;
      if (!q) return true;
      return [r.id, r.customerName, r.customerContact, r.item, r.karigarName, r.details, ...(r.work || [])]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
    // Open work by when it was promised (late first); the rest newest first.
    return list.sort((a, b) => {
      if (OPEN.includes(a.status) && OPEN.includes(b.status)) {
        const pa = a.promisedDate || '9999', pb = b.promisedDate || '9999';
        if (pa !== pb) return pa.localeCompare(pb);
      }
      return (b.collectedAt || b.receivedAt || '').localeCompare(a.collectedAt || a.receivedAt || '');
    });
  }, [repairs, tab, search]);

  const print = async (r: Repair) => {
    try { await saveRepairPdf(r); }
    catch (e) { toast({ title: 'Could not create the receipt', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  const start = async (r: Repair) => {
    try { await setRepairStatus(r.id, 'in_progress'); toast({ title: `${r.id}: being worked on`, description: r.karigarName ? `With ${r.karigarName}.` : undefined }); }
    catch (e) { toast({ title: 'Could not update', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  const cancel = async (r: Repair) => {
    try { await setRepairStatus(r.id, 'cancelled'); toast({ title: `${r.id} cancelled` }); }
    catch (e) { toast({ title: 'Could not cancel', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  const remove = async (r: Repair) => {
    try { await deleteRepair(r.id); toast({ title: `${r.id} deleted`, description: repairPaid(r) ? 'Its payments were removed from Extra Revenue too.' : undefined }); }
    catch (e) { toast({ title: 'Could not delete', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  const readyMessage = (r: Repair) => {
    const bal = repairBalance(r);
    return `Assalam o Alaikum${r.customerName ? ` ${r.customerName}` : ''}, your ${r.item} is ready for collection at ${STORE_CONFIG.name}. Repair no. ${r.id}.${bal > 0 ? ` Balance: ${pkr(bal)}.` : ''} Please bring your receipt.`;
  };

  const stepButton = (r: Repair) => {
    if (r.status === 'received') return <Button size="sm" variant="outline" className="h-8" onClick={() => start(r)}><Play className="mr-1.5 h-3.5 w-3.5" />{r.karigarName ? 'To karigar' : 'Start'}</Button>;
    if (r.status === 'in_progress') return <Button size="sm" variant="outline" className="h-8 border-success text-success hover:bg-success/10" onClick={() => setStep({ kind: 'ready', repair: r })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Ready</Button>;
    if (r.status === 'ready') return <Button size="sm" className="h-8" onClick={() => setStep({ kind: 'collect', repair: r })}><PackageCheck className="mr-1.5 h-3.5 w-3.5" />Hand back</Button>;
    return null;
  };

  const rowActions = (r: Repair) => (
    <div className="flex items-center justify-end gap-1">
      {stepButton(r)}
      {r.status === 'ready' && r.customerContact && (
        <Button asChild size="icon" variant="ghost" className="h-8 w-8 text-success" aria-label="Tell the customer on WhatsApp">
          <a href={whatsAppLink(r.customerContact, readyMessage(r))} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /></a>
        </Button>
      )}
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Print the receipt" onClick={() => print(r)}><Printer className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit" onClick={() => setEditing(r)}><Edit className="h-4 w-4" /></Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" aria-label="Cancel or delete"><Trash2 className="h-4 w-4" /></Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{r.id}: cancel or delete?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling keeps the record — the piece was handed back unrepaired. Deleting removes it for good
              {repairPaid(r) ? `, and the ${pkr(repairPaid(r))} paid comes out of Extra Revenue with it` : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            {r.status !== 'cancelled' && r.status !== 'collected' && <AlertDialogAction className="bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={() => cancel(r)}>Cancel repair</AlertDialogAction>}
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove(r)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  const readyBy = (r: Repair) => {
    const late = lateBy(r, today);
    if (!r.promisedDate) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <span className={cn('text-xs tabular-nums', late === null ? 'text-muted-foreground' : late > 0 ? 'text-destructive font-medium' : 'text-warning font-medium')}>
        {day(r.promisedDate)}{late === null ? '' : late > 0 ? ` · ${late}d late` : ' · today'}
      </span>
    );
  };

  if (!appReady) {
    return <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>;
  }

  const readyBalance = counts.ready.reduce((s, r) => s + repairBalance(r), 0);

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl space-y-4">
      {/* The QR codes the receipt footer draws from. */}
      <div style={{ display: 'none' }} aria-hidden="true">
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl || ' '} size={128} />
        <QRCode id="links-qr-code" value={storeLinksUrl() || ' '} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl || ' '} size={128} />
      </div>

      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5"><Wrench className="w-7 h-7 flex-shrink-0" />Repairs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Customers&apos; own pieces in for mending — weighed in, weighed out, receipt at both ends.</p>
        </div>
        <Button size="sm" className="flex-shrink-0" onClick={() => setEditing('new')}><PlusCircle className="w-4 h-4 mr-2" />Receive a repair</Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide">In the shop</p><p className="text-2xl font-bold mt-1">{counts.inShop}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide">Ready to collect</p><p className="text-2xl font-bold mt-1 text-success">{counts.ready.length}</p>{readyBalance > 0 && <p className="text-xs text-muted-foreground mt-0.5">{pkr(readyBalance)} to take</p>}</CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide">Late</p><p className={cn('text-2xl font-bold mt-1', counts.late && 'text-destructive')}>{counts.late}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide">Collected this month</p><p className="text-2xl font-bold mt-1">{counts.collectedThisMonth}</p></CardContent></Card>
      </div>

      <FilterBar
        value={search}
        onChange={setSearch}
        placeholder="Search by repair no., customer, phone, piece or karigar…"
        activeCount={tab !== 'open' ? 1 : 0}
        actions={
          <div className="inline-flex rounded-md border overflow-hidden flex-shrink-0" role="group" aria-label="Show">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
                className={cn('px-3 text-xs h-9 transition-colors whitespace-nowrap', tab === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {isRepairsLoading ? (
        <ListSkeleton rows={5} />
      ) : shown.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-lg border">
          <Wrench className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="font-semibold">{repairs.length ? 'Nothing here' : 'No repairs yet'}</p>
          <p className="text-sm text-muted-foreground mt-1">{repairs.length ? 'Try another tab or search.' : 'When a customer leaves a piece to be mended, receive it here and print them a receipt.'}</p>
        </div>
      ) : (
        <>
          {/* Phone: cards */}
          <div className="md:hidden space-y-3">
            {shown.map((r) => (
              <Card key={r.id} className={cn(r.status === 'collected' || r.status === 'cancelled' ? 'opacity-70' : '')}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{r.item}</p>
                      <p className="text-xs text-muted-foreground">{r.id} · {r.customerName || 'Walk-in'}{r.weightInG ? ` · ${r.weightInG.toFixed(3)} g` : ''}</p>
                    </div>
                    <Badge variant="outline" className={cn('flex-shrink-0', STATUS_TONE[r.status])}>{REPAIR_STATUS_LABELS[r.status]}</Badge>
                  </div>
                  {r.work?.length > 0 && <p className="text-xs">{r.work.join(' · ')}</p>}
                  <div className="flex items-center justify-between gap-3 text-xs">
                    {readyBy(r)}
                    <span className="tabular-nums">{repairBalance(r) > 0 ? `${pkr(repairBalance(r))} due` : repairPaid(r) ? 'Paid' : ''}</span>
                  </div>
                  <div className="border-t pt-2">{rowActions(r)}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: a table */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repair</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>The piece and the work</TableHead>
                  <TableHead>Ready by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right w-[1%]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id} className={cn(r.status === 'collected' || r.status === 'cancelled' ? 'opacity-70 hover:opacity-100' : '')}>
                    <TableCell className="whitespace-nowrap">
                      <p className="font-medium">{r.id}</p>
                      <p className="text-xs text-muted-foreground">{day(r.receivedAt)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="truncate max-w-[180px]">{r.customerName || 'Walk-in'}</p>
                      {r.customerContact && <p className="text-xs text-muted-foreground tabular-nums">{r.customerContact}</p>}
                    </TableCell>
                    <TableCell>
                      <p className="truncate max-w-[280px]">{r.item}{r.weightInG ? <span className="text-muted-foreground"> · {r.weightInG.toFixed(3)} g</span> : null}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[280px]">{[r.work?.join(' · '), r.karigarName ? `with ${r.karigarName}` : ''].filter(Boolean).join(' — ')}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{readyBy(r)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_TONE[r.status]}>{REPAIR_STATUS_LABELS[r.status]}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {repairBalance(r) > 0 ? pkr(repairBalance(r)) : <span className="text-muted-foreground">{repairPaid(r) ? 'Paid' : '—'}</span>}
                    </TableCell>
                    <TableCell>{rowActions(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Receive a repair' : editing ? `Repair ${editing.id}` : ''}</DialogTitle>
            {editing === 'new' && <DialogDescription>Weigh the piece in front of the customer, then print their receipt.</DialogDescription>}
          </DialogHeader>
          {editing !== null && (
            <RepairForm
              key={editing === 'new' ? 'new' : editing.id}
              repair={editing === 'new' ? undefined : repairs.find((x) => x.id === editing.id) || editing}
              onDone={(saved) => { setEditing(null); if (saved) void print(saved); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {step?.kind === 'ready' && <ReadyDialog repair={step.repair} onClose={() => setStep(null)} />}
      {step?.kind === 'collect' && <CollectDialog repair={step.repair} onClose={() => setStep(null)} />}
    </div>
  );
}
