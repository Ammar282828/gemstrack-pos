"use client";

/**
 * Repairs: a customer's own pieces, left to be mended.
 *
 * Kept as simple as the counter needs. A ticket is a customer and a list of
 * pieces — what it is, what to do, its weight, its price — with a ready-by
 * date and an optional advance. Then two taps: Ready, and Hand back. A receipt
 * prints when the pieces come in. Money taken lands in Extra Revenue in the
 * same write (see the store), so the day's takings include it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns';
import QRCode from 'qrcode.react';
import {
  useAppStore, type Repair, type RepairPiece, type RepairStatus, type PaymentType,
  REPAIR_STATUS_LABELS, PAYMENT_TYPES, repairBalance, repairPaid, repairTotal, repairSummary,
} from '@/lib/store';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AmountInput } from '@/components/ui/amount-input';
import { PhoneField } from '@/components/ui/phone-field';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { KarigarPicker, UNASSIGNED_VALUE } from '@/components/karigar/karigar-picker';
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import { FilterBar } from '@/components/shared/filter-bar';
import { ListSkeleton } from '@/components/shared/skeletons';
import { Wrench, Plus, PlusCircle, Printer, Edit, Trash2, MessageCircle, CheckCircle2, PackageCheck, Loader2, X, ChevronDown } from 'lucide-react';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const day = (iso?: string) => { if (!iso) return ''; try { return format(parseISO(iso), 'd MMM'); } catch { return iso; } };
const emptyPiece = (): RepairPiece => ({ item: '', work: '' });
const READY_IN = [{ days: 3, label: '3 days' }, { days: 7, label: '1 week' }, { days: 14, label: '2 weeks' }];

type Tab = 'received' | 'ready' | 'done' | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'received', label: 'In the shop' },
  { key: 'ready', label: 'Ready' },
  { key: 'done', label: 'Collected' },
  { key: 'all', label: 'All' },
];

const STATUS_TONE: Record<RepairStatus, string> = {
  received: 'border-warning text-warning',
  ready: 'border-success text-success bg-success/10',
  collected: 'border-muted-foreground/40 text-muted-foreground',
  cancelled: 'border-destructive/50 text-destructive',
};

/** Still in the shop past its ready-by date: days late, else null. */
function daysLate(r: Repair, today: Date): number | null {
  if (r.status !== 'received' || !r.promisedDate) return null;
  const d = differenceInCalendarDays(today, parseISO(r.promisedDate));
  return d > 0 ? d : null;
}

// A method picker small enough to sit beside an amount.
function MethodChips({ value, onChange }: { value: PaymentType; onChange: (m: PaymentType) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PAYMENT_TYPES.map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} aria-pressed={value === m}
          className={cn('rounded-full border px-3 py-1 text-xs', value === m ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>
          {m}
        </button>
      ))}
    </div>
  );
}

// ── The form ────────────────────────────────────────────────────────────────
function RepairForm({ repair, onDone }: { repair?: Repair; onDone: (saved?: Repair) => void }) {
  const { toast } = useToast();
  const { customers, karigars, addRepair, updateRepair, loadCustomers, loadKarigars } = useAppStore();
  const [name, setName] = useState(repair?.customerName || '');
  const [customerId, setCustomerId] = useState(repair?.customerId);
  const [phone, setPhone] = useState(repair?.customerContact || '');
  const [pieces, setPieces] = useState<RepairPiece[]>(repair?.pieces?.length ? repair.pieces : [emptyPiece()]);
  const [readyBy, setReadyBy] = useState(repair ? repair.promisedDate || '' : format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [advance, setAdvance] = useState<number | undefined>();
  const [method, setMethod] = useState<PaymentType>('Cash');
  const [more, setMore] = useState(Boolean(repair?.karigarId || repair?.internalNote || repair?.takenBy));
  const [karigarId, setKarigarId] = useState(repair?.karigarId || '');
  const [takenBy, setTakenBy] = useState(repair?.takenBy);
  const [note, setNote] = useState(repair?.internalNote || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadCustomers(); loadKarigars(); }, [loadCustomers, loadKarigars]);

  const setPiece = (i: number, patch: Partial<RepairPiece>) => setPieces((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const total = repairTotal({ pieces });

  const save = async () => {
    const kept = pieces
      .map((p) => ({ item: p.item.trim(), work: p.work.trim(), ...(p.weightG ? { weightG: p.weightG } : {}), ...(p.price ? { price: p.price } : {}) }))
      .filter((p) => p.item || p.work);
    if (!kept.length) { toast({ title: 'Add a piece', description: 'What was brought in — "gold ring", "chain".', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const karigar = karigars.find((k) => k.id === karigarId);
      const fields = {
        customerName: name.trim(),
        customerId,
        customerContact: phone || undefined,
        pieces: kept.map((p) => ({ ...p, item: p.item || 'Piece' })),
        promisedDate: readyBy || undefined,
        karigarId: karigar?.id,
        karigarName: karigar?.name,
        takenBy,
        internalNote: note.trim() || undefined,
      };
      if (repair) {
        await updateRepair(repair.id, fields);
        toast({ title: `${repair.id} saved` });
        onDone();
      } else {
        const created = await addRepair({ ...fields, receivedAt: new Date().toISOString(), advance, advanceMethod: method });
        toast({ title: `Repair ${created.id}`, description: `${kept.length} ${kept.length === 1 ? 'piece' : 'pieces'} received. Printing the receipt.` });
        onDone(created);
      }
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pt-1">
      {/* Who */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Customer</Label>
          <CustomerAutocomplete
            customers={customers} value={name} className="mt-1" placeholder="Name"
            onSelect={({ name: n, customerId: id, phone: ph }) => { setName(n); setCustomerId(id); if (ph !== undefined) setPhone(normalizePhoneNumber(ph)); }}
          />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <div className="mt-1"><PhoneField value={phone || undefined} onChange={(v) => setPhone(v || '')} aria-label="Customer phone" /></div>
        </div>
      </div>

      {/* The pieces */}
      <div>
        <Label className="text-xs">Pieces</Label>
        <div className="mt-1.5 space-y-2">
          {pieces.map((p, i) => (
            <div key={i} className="rounded-lg border p-2.5 sm:p-2">
              <div className="flex items-start gap-2">
                <span className="mt-2.5 w-4 flex-shrink-0 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="grid flex-1 gap-2 sm:grid-cols-[1.1fr_1.4fr_90px_110px]">
                  <Input value={p.item} onChange={(e) => setPiece(i, { item: e.target.value })} placeholder="Piece — gold ring" aria-label={`Piece ${i + 1}`} autoFocus={!repair && i === pieces.length - 1 && i > 0} />
                  <Input value={p.work} onChange={(e) => setPiece(i, { work: e.target.value })} placeholder="What to do — resize to 14" aria-label={`Work on piece ${i + 1}`} />
                  <div className="grid grid-cols-2 gap-2 sm:contents">
                    <AmountInput value={p.weightG} maxDecimals={3} zeroAsEmpty placeholder="Weight g" aria-label={`Weight of piece ${i + 1}`}
                      onValueChange={(v) => setPiece(i, { weightG: v === undefined ? undefined : Number(v) })} />
                    <AmountInput value={p.price} zeroAsEmpty placeholder="Price" aria-label={`Price for piece ${i + 1}`}
                      onValueChange={(v) => setPiece(i, { price: v === undefined ? undefined : Number(v) })} />
                  </div>
                </div>
                {pieces.length > 1 && (
                  <button type="button" onClick={() => setPieces((ps) => ps.filter((_, j) => j !== i))} className="mt-1.5 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive" aria-label={`Remove piece ${i + 1}`}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setPieces((ps) => [...ps, emptyPiece()])}><Plus className="mr-1.5 h-4 w-4" />Add another piece</Button>
          {total > 0 && <p className="text-sm">Total <span className="font-semibold tabular-nums">{pkr(total)}</span></p>}
        </div>
      </div>

      {/* When */}
      <div>
        <Label className="text-xs">Ready by</Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {READY_IN.map((o) => {
            const d = format(addDays(new Date(), o.days), 'yyyy-MM-dd');
            return (
              <button key={o.days} type="button" onClick={() => setReadyBy(d)} aria-pressed={readyBy === d}
                className={cn('rounded-full border px-3 py-1.5 text-xs', readyBy === d ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                {o.label}
              </button>
            );
          })}
          <Input type="date" value={readyBy} onChange={(e) => setReadyBy(e.target.value)} className="h-8 w-[150px] text-xs" aria-label="Ready by date" />
        </div>
      </div>

      {/* Advance, at intake only */}
      {!repair && (
        <div>
          <Label className="text-xs">Advance taken now (optional)</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <div className="w-36"><AmountInput value={advance} zeroAsEmpty placeholder="PKR" aria-label="Advance" onValueChange={(v) => setAdvance(v === undefined ? undefined : Number(v))} /></div>
            {!!advance && <MethodChips value={method} onChange={setMethod} />}
          </div>
        </div>
      )}

      {repair && repair.payments?.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Paid so far: {repair.payments.map((p) => `${pkr(p.amount)} on ${day(p.date)}`).join(', ')}.
        </p>
      )}

      {/* Everything else, out of the way */}
      <div>
        <button type="button" onClick={() => setMore((m) => !m)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={more}>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', more && 'rotate-180')} /> Karigar, taken by, note for the shop
        </button>
        {more && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Karigar</Label>
              <div className="mt-1"><KarigarPicker value={karigarId || UNASSIGNED_VALUE} onChange={(v) => setKarigarId(v === UNASSIGNED_VALUE ? '' : v)} placeholder="Done in the shop" clearLabel="No karigar" /></div>
            </div>
            <div>
              <Label className="text-xs">Taken by</Label>
              <div className="mt-1"><TakenByPicker value={takenBy || ''} onChange={setTakenBy} aria-label="Taken by" /></div>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Note for the shop (never printed)</Label>
              <Textarea className="mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Already scratched on the band; wants it before Friday…" />
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{repair ? 'Save' : 'Save and print receipt'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Hand back: take the balance, done ───────────────────────────────────────
function HandBackDialog({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  const { setRepairStatus, recordRepairPayment } = useAppStore();
  const { toast } = useToast();
  const balance = repairBalance(repair);
  const [amount, setAmount] = useState<number | undefined>(balance || undefined);
  const [method, setMethod] = useState<PaymentType>('Cash');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (amount && amount > 0) await recordRepairPayment(repair.id, { amount, date: new Date().toISOString(), method, note: 'On collection' });
      await setRepairStatus(repair.id, 'collected');
      toast({ title: `${repair.id} handed back`, description: amount ? `${pkr(amount)} received.` : undefined });
      onClose();
    } catch (e) {
      toast({ title: 'Could not hand it back', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hand back</DialogTitle>
          <DialogDescription>{repairSummary(repair)} — {repair.customerName || 'walk-in'}</DialogDescription>
        </DialogHeader>
        {balance > 0 ? (
          <div className="space-y-3">
            <p className="text-sm">Balance due <span className="font-semibold tabular-nums">{pkr(balance)}</span></p>
            <div className="w-40"><AmountInput value={amount} zeroAsEmpty placeholder="Received" aria-label="Amount received" onValueChange={(v) => setAmount(v === undefined ? undefined : Number(v))} /></div>
            <MethodChips value={method} onChange={setMethod} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing is due{repairPaid(repair) > 0 ? ` — ${pkr(repairPaid(repair))} was paid` : ''}.</p>
        )}
        <DialogFooter><Button onClick={go} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Handed back</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
export default function RepairsPage() {
  const appReady = useAppReady();
  const { toast } = useToast();
  const { repairs, isRepairsLoading, loadRepairs, setRepairStatus, deleteRepair } = useAppStore();
  const [tab, setTab] = useState<Tab>('received');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Repair | 'new' | null>(null);
  const [handingBack, setHandingBack] = useState<Repair | null>(null);
  const [today] = useState(() => new Date());

  useEffect(() => { if (appReady) loadRepairs(); }, [appReady, loadRepairs]);

  const count = (s: RepairStatus) => repairs.filter((r) => r.status === s).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return repairs
      .filter((r) => tab === 'all' || (tab === 'done' ? r.status === 'collected' || r.status === 'cancelled' : r.status === tab))
      .filter((r) => !q || [r.id, r.customerName, r.customerContact, r.karigarName, ...(r.pieces || []).flatMap((p) => [p.item, p.work])]
        .some((v) => String(v || '').toLowerCase().includes(q)))
      // What is still in the shop, by when it was promised; the rest newest first.
      .sort((a, b) => (tab === 'received'
        ? (a.promisedDate || '9999').localeCompare(b.promisedDate || '9999')
        : (b.collectedAt || b.readyAt || b.receivedAt || '').localeCompare(a.collectedAt || a.readyAt || a.receivedAt || '')));
  }, [repairs, tab, search]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { toast({ title: label, description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };
  const print = (r: Repair) => run('Could not print the receipt', () => saveRepairPdf(r));
  const markReady = (r: Repair) => run('Could not update', async () => { await setRepairStatus(r.id, 'ready'); toast({ title: `${r.id} is ready`, description: r.customerContact ? 'Tap "Tell them" to message the customer.' : undefined }); });

  const readyMessage = (r: Repair) => {
    const bal = repairBalance(r);
    const what = r.pieces.length === 1 ? `your ${r.pieces[0].item.toLowerCase()} is` : `your ${r.pieces.length} pieces are`;
    return `Assalam o Alaikum${r.customerName ? ` ${r.customerName}` : ''}, ${what} ready for collection at ${STORE_CONFIG.name} (repair ${r.id}).${bal > 0 ? ` Balance: ${pkr(bal)}.` : ''} Please bring your receipt.`;
  };

  if (!appReady) return <div className="container mx-auto px-4 py-5 md:py-6 max-w-5xl"><ListSkeleton /></div>;

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-5xl space-y-4">
      {/* The QR codes the receipt footer draws from. */}
      <div style={{ display: 'none' }} aria-hidden="true">
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl || ' '} size={128} />
        <QRCode id="links-qr-code" value={storeLinksUrl() || ' '} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl || ' '} size={128} />
      </div>

      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5"><Wrench className="w-7 h-7 flex-shrink-0" />Repairs</h1>
        <Button onClick={() => setEditing('new')}><PlusCircle className="w-4 h-4 mr-2" />New repair</Button>
      </header>

      <FilterBar
        value={search}
        onChange={setSearch}
        placeholder="Search name, phone, piece or REP no."
        actions={
          <div className="inline-flex rounded-md border overflow-hidden flex-shrink-0" role="group" aria-label="Show">
            {TABS.map((t) => {
              const n = t.key === 'received' ? count('received') : t.key === 'ready' ? count('ready') : null;
              return (
                <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
                  className={cn('px-3 text-xs h-9 whitespace-nowrap transition-colors', tab === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                  {t.label}{n ? ` · ${n}` : ''}
                </button>
              );
            })}
          </div>
        }
      />

      {isRepairsLoading ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-lg border">
          <Wrench className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">{repairs.length ? 'Nothing here' : 'No repairs yet'}</p>
          {!repairs.length && <p className="text-sm text-muted-foreground mt-1">Tap <span className="font-medium">New repair</span> when a customer leaves pieces to be mended.</p>}
        </div>
      ) : (
        <div className="space-y-2.5">
          {shown.map((r) => {
            const late = daysLate(r, today);
            const bal = repairBalance(r);
            return (
              <Card key={r.id} className={cn(r.status === 'collected' || r.status === 'cancelled' ? 'opacity-70' : '')}>
                <CardContent className="p-3.5 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    {/* Who and what */}
                    <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold">{r.customerName || 'Walk-in'}</span>
                        {r.customerContact && <span className="text-xs text-muted-foreground tabular-nums">{r.customerContact}</span>}
                        <Badge variant="outline" className={cn('text-2xs', STATUS_TONE[r.status])}>{REPAIR_STATUS_LABELS[r.status]}</Badge>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-sm">
                        {(r.pieces || []).map((p, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-muted-foreground tabular-nums w-3.5 text-right">{i + 1}</span>
                            <span className="min-w-0"><span className="font-medium">{p.item}</span>{p.work ? <span className="text-muted-foreground"> — {p.work}</span> : null}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {r.id} · in {day(r.receivedAt)}
                        {r.status === 'received' && r.promisedDate && <span className={cn(late && 'text-destructive font-medium')}> · ready by {day(r.promisedDate)}{late ? ` (${late}d late)` : ''}</span>}
                        {r.karigarName && ` · with ${r.karigarName}`}
                      </p>
                    </button>

                    {/* Money and the next step */}
                    <div className="flex flex-col items-end gap-2">
                      <p className="text-sm tabular-nums">
                        {bal > 0 ? <><span className="text-muted-foreground text-xs">due </span><span className="font-semibold">{pkr(bal)}</span></> : repairTotal(r) > 0 ? <span className="text-muted-foreground text-xs">paid</span> : null}
                      </p>
                      <div className="flex items-center gap-1">
                        {r.status === 'received' && <Button size="sm" variant="outline" className="h-8 border-success text-success hover:bg-success/10" onClick={() => markReady(r)}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Ready</Button>}
                        {r.status === 'ready' && r.customerContact && (
                          <Button asChild size="sm" variant="outline" className="h-8 text-success border-success/60">
                            <a href={whatsAppLink(r.customerContact, readyMessage(r))} target="_blank" rel="noopener noreferrer" aria-label="Tell the customer on WhatsApp"><MessageCircle className="mr-1.5 h-3.5 w-3.5" />Tell them</a>
                          </Button>
                        )}
                        {r.status === 'ready' && <Button size="sm" className="h-8" onClick={() => setHandingBack(r)}><PackageCheck className="mr-1.5 h-3.5 w-3.5" />Hand back</Button>}
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
                                Cancel keeps the record (handed back unrepaired). Delete removes it for good
                                {repairPaid(r) ? `, and the ${pkr(repairPaid(r))} paid comes out of Extra Revenue with it` : ''}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep it</AlertDialogCancel>
                              {(r.status === 'received' || r.status === 'ready') && (
                                <AlertDialogAction className="bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={() => run('Could not cancel', () => setRepairStatus(r.id, 'cancelled'))}>Cancel repair</AlertDialogAction>
                              )}
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => run('Could not delete', () => deleteRepair(r.id))}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New repair' : editing ? `Repair ${editing.id}` : ''}</DialogTitle>
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

      {handingBack && <HandBackDialog repair={handingBack} onClose={() => setHandingBack(null)} />}
    </div>
  );
}
