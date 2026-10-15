"use client";

import { lacCrore } from '@/lib/money';
import { loadOrderPhoto } from '@/components/order/order-photo';
import { useLingering } from '@/hooks/use-lingering';
import React, { useEffect, useMemo, useState } from 'react';
import { FilterBar } from '@/components/shared/filter-bar';
import Link from 'next/link';
import { useAppStore, KarigarJobStatus, MetalType, KaratValue, staticCategories } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import {
  buildWorkshopJobs, groupByKarigar, formatJobListForShare, groupJobsByOrder,
  WorkshopJob, KarigarWorkload, UNASSIGNED_ID, WARN_DAYS, CRITICAL_DAYS,
} from '@/lib/workshop';
import { detailsTarget } from '@/lib/workshop-details';
import { STORE_CONFIG, STORE_WORKSHOP_START } from '@/lib/store-config';
import { KarigarAssign } from '@/components/karigar/karigar-assign';
import { KarigarGlance } from '@/components/karigar/karigar-glance';
import { AgeBadge, BoardJobCard, TakenByTag } from '@/components/karigar/job-card';
import { SampleImageInput } from '@/components/shared/sample-image-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Hammer, Users, AlertTriangle, Clock, PlusCircle, Share2, Copy, ExternalLink,
  Loader2, Search, CheckCircle2, CircleDot, Circle, Trash2, PackageOpen, LayoutGrid,
  Table as TableIcon, Flame, Pencil, Save, ImagePlus, Calendar, MessageSquareQuote,
  Gauge, ArrowLeft, Rows3, } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { openWhatsApp } from '@/lib/whatsapp';
import { format, parseISO } from 'date-fns';
import { KarigarPicker } from '@/components/karigar/karigar-picker';
import { CategoryPicker } from '@/components/shared/category-picker';
import { AmountInput } from '@/components/ui/amount-input';
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import type { TakenBy } from '@/lib/store';
import { useMineFilter } from '@/hooks/use-me';
import { PageShell } from '@/components/shared/page-shell';
import { Pill, ChipRow, FilterChip, Segmented, EmptyState, type Tone } from '@/components/ledger';
import { deleteErrorText } from '@/lib/delete-code';

// ── small presentational helpers ────────────────────────────────────────────

const StatusDot: React.FC<{ status: KarigarJobStatus }> = ({ status }) => (
  status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-tone-settled-ink" />
    : status === 'in-progress' ? <CircleDot className="h-4 w-4 text-tone-working-ink" />
    : <Circle className="h-4 w-4 text-muted-foreground" />
);

const STATUS_LABEL: Record<KarigarJobStatus, string> = {
  'pending': 'Pending',
  'in-progress': 'In Progress',
  'completed': 'Completed',
};

// ── one job line ────────────────────────────────────────────────────────────

const JobRow: React.FC<{
  job: WorkshopJob;
  onToggleDone: (job: WorkshopJob) => void;
  onToggleGiven: (job: WorkshopJob) => void;
  onSetStatus: (job: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (job: WorkshopJob) => void;
  onEdit?: (job: WorkshopJob) => void;
  showKarigar?: boolean;
}> = ({ job, onToggleDone, onToggleGiven, onSetStatus, onDelete, onEdit, showKarigar }) => {
  const meta = [
    job.category,
    job.size ? `Size ${job.size}` : null,
    job.plating,
    job.weightG ? `${job.weightG}g` : null,
    job.karat ? String(job.karat).toUpperCase() : null,
    job.referenceSku ? `Ref ${job.referenceSku}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={cn(
      'flex items-start gap-3 py-3 border-b border-border/40 last:border-0',
      job.status === 'completed' && 'opacity-60',
      // Online sales are highlighted so they stand out from bench work
      // that came in through an order.
      job.isOnline && 'bg-tone-settled/[.06] -mx-3 px-3 rounded-control',
    )}>
      <Checkbox
        className="mt-0.5 h-5 w-5 sm:mt-1 sm:h-4 sm:w-4 flex-shrink-0"
        checked={job.status === 'completed'}
        onCheckedChange={() => onToggleDone(job)}
        aria-label="Mark done"
      />
      <div className="min-w-0 flex-1">
        {/* Title line — age badge stays inline so it never gets orphaned */}
        <div className="flex items-start justify-between gap-2">
          <span className={cn('font-medium text-sm break-words', job.status === 'completed' && 'line-through')}>
            {job.description}
          </span>
          <span className="flex-shrink-0"><AgeBadge job={job} /></span>
        </div>

        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          {job.source === 'manual'
            ? <Pill tone="working">Stock</Pill>
            : job.isOnline
              ? <Pill tone="settled">Online</Pill>
              : <Pill>Order</Pill>}
          {showKarigar && (
            <Pill tone={job.karigarId === UNASSIGNED_ID ? 'late' : 'quiet'}>{job.karigarName}</Pill>
          )}
          <TakenByTag job={job} />
          {meta && <span>{meta}</span>}
        </div>

        {job.notes && (
          <div className="mt-1.5 rounded-control bg-tone-owed/[.08] px-2.5 py-1.5">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground leading-none">Instructions</p>
            <p className="text-xs text-foreground/80 whitespace-pre-wrap mt-1">{job.notes}</p>
          </div>
        )}

        {/* This line used to read "given <date>" and the date was the write-up, not the
            handover -- the word was doing duty for both. Now it is a box that means what
            it says, greyed while nobody is assigned because there is no one to give it to. */}
        <label className={cn(
          'mt-1.5 inline-flex items-center gap-2 text-xs',
          job.karigarId === UNASSIGNED_ID ? 'opacity-50' : 'cursor-pointer',
        )} title={job.karigarId === UNASSIGNED_ID ? 'Assign a karigar first' : undefined}>
          <Checkbox className="h-4 w-4" checked={!!job.givenAt} disabled={job.karigarId === UNASSIGNED_ID}
            onCheckedChange={() => onToggleGiven(job)} aria-label="Given to karigar" />
          <span className={job.givenAt ? 'text-muted-foreground' : 'text-foreground'}>
            {job.givenAt ? `Given ${format(parseISO(job.givenAt), 'dd MMM yy')}` : 'Given to karigar'}
          </span>
        </label>

        {/* Controls sit under the content and wrap — keeps narrow cards readable */}
        {(job.source === 'manual' || job.status !== 'completed') && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {onEdit && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(job)}>
                <Pencil className="h-3 w-3 mr-1.5" />Details
              </Button>
            )}
            {job.source !== 'manual' && job.itemIndex !== undefined && job.status !== 'completed' && (
              <KarigarAssign
                orderId={job.orderId}
                invoiceId={job.invoiceId}
                itemIndex={job.itemIndex}
                currentKarigarId={job.karigarId === UNASSIGNED_ID ? undefined : job.karigarId}
                size="compact"
              />
            )}
            {job.source === 'manual' && (
              <>
                <Select value={job.status} onValueChange={v => onSetStatus(job, v as KarigarJobStatus)}>
                  <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-tone-late-ink" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                      <AlertDialogDescription>&ldquo;{job.description}&rdquo; will be removed. This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(job)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── add-job dialog ──────────────────────────────────────────────────────────

const AddJobDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; presetKarigarId?: string }> =
({ open, onOpenChange, presetKarigarId }) => {
  const karigars = useAppStore(s => s.karigars);
  const addKarigarJob = useAppStore(s => s.addKarigarJob);
  const { toast } = useToast();

  const [karigarId, setKarigarId] = useState(presetKarigarId || '');
  const [description, setDescription] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [metalType, setMetalType] = useState<string>('gold');
  const [karat, setKarat] = useState<string>('');
  const [weightG, setWeightG] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [size, setSize] = useState('');
  const [agreedCost, setAgreedCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setKarigarId(presetKarigarId || ''); }, [open, presetKarigarId]);

  const reset = () => {
    setKarigarId(presetKarigarId || ''); setDescription(''); setItemCategory('');
    setMetalType('gold'); setKarat(''); setWeightG(''); setQuantity('1'); setSize('');
    setAgreedCost(''); setNotes('');
  };

  const submit = async () => {
    if (!karigarId || !description.trim()) {
      toast({ title: 'Missing information', description: 'Select a karigar and describe the work.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const karigar = karigars.find(k => k.id === karigarId);
    const res = await addKarigarJob({
      karigarId,
      karigarName: karigar?.name || 'Karigar',
      description: description.trim(),
      status: 'pending',
      assignedDate: new Date().toISOString(),
      ...(itemCategory && { itemCategory }),
      ...(metalType && { metalType: metalType as MetalType }),
      ...(karat && { karat: karat as KaratValue }),
      ...(weightG && { weightG: Number(weightG) }),
      ...(quantity && { quantity: Number(quantity) }),
      ...(size.trim() && { size: size.trim() }),
      ...(agreedCost && { agreedCost: Number(agreedCost) }),
      ...(notes.trim() && { notes: notes.trim() }),
    });
    setSaving(false);
    if (res) {
      toast({ title: 'Job assigned', description: `${description.trim()} → ${karigar?.name}` });
      reset(); onOpenChange(false);
    } else {
      toast({ title: 'Error', description: 'Could not save the job.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Hammer className="h-5 w-5 text-primary" />Assign Stock Work</DialogTitle>
          <DialogDescription>Pieces for your own inventory — not tied to a customer order. Also use this for repairs and samples.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Karigar *</Label>
            <KarigarPicker
              value={karigarId}
              onChange={v => setKarigarId(v === 'none' ? '' : v)}
              placeholder="Select karigar"
              aria-label="Karigar"
            />
          </div>

          <div>
            <Label className="text-xs">What are they making? *</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. 4 stacked rings, moti set repair"  aria-label="What are they making?"/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <CategoryPicker
                categories={staticCategories}
                value={itemCategory || ''}
                onChange={setItemCategory}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label className="text-xs">Metal</Label>
              <Select value={metalType} onValueChange={setMetalType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                  <SelectItem value="platinum">Platinum</SelectItem>
                  <SelectItem value="palladium">Palladium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Weight (g)</Label>
              <AmountInput value={weightG} onValueChange={v => setWeightG(v === undefined ? '' : String(v))} placeholder="0.000"  aria-label="Weight (g)"/>
            </div>
            <div>
              <Label className="text-xs">Qty</Label>
              <AmountInput value={quantity} onValueChange={v => setQuantity(v === undefined ? '' : String(v))}  aria-label="Qty"/>
            </div>
            <div>
              <Label className="text-xs">Making (PKR)</Label>
              <AmountInput value={agreedCost} onValueChange={v => setAgreedCost(v === undefined ? '' : String(v))} placeholder="0"  aria-label="Making (PKR)"/>
            </div>
          </div>

          <div>
            <Label className="text-xs">Size</Label>
            <Input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 12, 2.4, 7.5&quot;"  aria-label="Size"/>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instructions, stone details…"  aria-label="Notes"/>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PlusCircle className="h-4 w-4 mr-2" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


/** Pieces grouped under their order — the same heading a karigar sees. */
const OrderGroupedJobs: React.FC<{
  jobs: WorkshopJob[];
  onToggleDone: (j: WorkshopJob) => void;
  onToggleGiven: (j: WorkshopJob) => void;
  onSetStatus: (j: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (j: WorkshopJob) => void;
  onEdit?: (j: WorkshopJob) => void;
  showKarigar?: boolean;
}> = ({ jobs, onToggleDone, onToggleGiven, onSetStatus, onDelete, onEdit, showKarigar }) => (
  <>
    {groupJobsByOrder(jobs).map(g => (
      <div key={g.key} className={cn(
        'rounded-control px-3 py-2.5 mb-3 last:mb-0',
        g.jobs[0]?.isOnline ? 'bg-tone-settled/[.07]' : 'bg-muted/50',
      )}>
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          {g.isStock
            ? <Pill tone="working">Stock piece</Pill>
            : g.invoiceId
              ? (
                <Link href={`/invoices/${g.invoiceId}`} className="inline-flex items-center gap-1 hover:underline">
                  <span className="font-mono font-bold text-sm text-tone-settled-ink">{g.invoiceId}</span>
                  <ExternalLink className="h-3 w-3 text-tone-settled-ink" />
                </Link>
              )
              : (
                <Link href={`/orders/${g.orderId}`} className="inline-flex items-center gap-1 hover:underline">
                  <span className="font-mono font-bold text-sm">{g.orderId}</span>
                  <ExternalLink className="h-3 w-3 text-primary" />
                </Link>
              )}
          {g.jobs[0]?.customerName && <span className="text-xs text-muted-foreground truncate">{g.jobs[0].customerName}</span>}
          {g.jobs.length > 1 && <Pill>{g.jobs.length} pieces</Pill>}
          {showKarigar && g.jobs[0] && (
            <Pill tone={g.jobs[0].karigarId === UNASSIGNED_ID ? 'late' : 'quiet'}>{g.jobs[0].karigarName}</Pill>
          )}
        </div>
        <div className="rounded-control bg-card px-3">
          {g.jobs.map(j => (
            <JobRow key={j.id} job={j} onEdit={onEdit}
              onToggleDone={onToggleDone} onToggleGiven={onToggleGiven} onSetStatus={onSetStatus} onDelete={onDelete} />
          ))}
        </div>
      </div>
    ))}
  </>
);

// ── edit the making details of a job (owner-side, Workshop only) ────────────

const EditDetailsDialog: React.FC<{ job: WorkshopJob | null; onClose: () => void }> = ({ job: jobNow, onClose }) => {
  // Shown as it was while the dialog closes (hooks/use-lingering.ts): it rendered nothing and vanished.
  const job = useLingering(jobNow);
  const updateOrderItemDetails = useAppStore(s => s.updateOrderItemDetails);
  const updateInvoiceItemDetails = useAppStore(s => s.updateInvoiceItemDetails);
  const updateKarigarJobDetails = useAppStore(s => s.updateKarigarJobDetails);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const [weight, setWeight] = useState('');
  const [ref, setRef] = useState('');
  const [instructions, setInstructions] = useState('');
  const [sample, setSample] = useState('');
  // Sent only when changed: an unchanged photo is not uploaded again with the other details.
  const [sampleChanged, setSampleChanged] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!job) return;
    setName(job.description || '');
    setSize(job.size || '');
    setWeight(job.weightG ? String(job.weightG) : '');
    setRef(job.referenceSku || '');
    setInstructions(job.notes || '');
    setSample(job.sampleImage || '');
    setSampleChanged(false);
    // A photo kept in its own document (lib/order-photos.ts) is read for the editor.
    let live = true;
    if (!job.sampleImage && job.samplePhotoId) void loadOrderPhoto(job.samplePhotoId).then(v => { if (live && v) setSample(v); });
    return () => { live = false; };
  }, [jobNow]); // eslint-disable-line react-hooks/exhaustive-deps -- each opening starts from the job

  if (!job) return null;

  const save = async () => {
    if (!name.trim()) {
      toast({ title: 'Name required', description: 'An item needs a name.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const target = detailsTarget(job);
      if (!target) throw new Error('Unknown job');
      if (target.kind === 'order') {
        await updateOrderItemDetails(target.orderId, target.itemIndex, {
          description: name, size, referenceSku: ref,
          // Instructions are consolidated into adminNote; the legacy
          // stone/diamond fields are cleared so nothing renders twice.
          adminNote: instructions, stoneDetails: '', diamondDetails: '',
          ...(sampleChanged && { sampleImageDataUri: sample }),
          ...(weight !== '' && { estimatedWeightG: Number(weight) }),
        });
      } else if (target.kind === 'invoice') {
        // Its weight is what the bill was priced from, so it is not changed from here.
        await updateInvoiceItemDetails(target.invoiceId, target.itemIndex, {
          name, size, adminNote: instructions, stoneDetails: '', diamondDetails: '',
        });
      } else {
        await updateKarigarJobDetails(target.jobId, {
          description: name, size, notes: instructions,
          ...(weight !== '' && { weightG: Number(weight) }),
        });
      }
      toast({ title: 'Details updated', description: job.description });
      onClose();
    } catch {
      toast({ title: 'Could not save', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!jobNow} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-primary" />Making details</DialogTitle>
          <DialogDescription>
            {job.description} — only the fields the karigar sees. Price, customer and quantity are unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Item name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="What is being made"  aria-label="Item name"/>
            <p className="text-2xs text-muted-foreground mt-1">
              Also prints on the customer&apos;s estimate and invoice.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Size</Label>
              <Input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 12"  aria-label="Size"/>
            </div>
            <div>
              <Label className="text-xs">Weight (g)</Label>
              <AmountInput value={weight} onValueChange={v => setWeight(v === undefined ? '' : String(v))} placeholder="0.000"
                disabled={job.source === 'invoice'}  aria-label="Weight (g)"/>
            </div>
            <div>
              <Label className="text-xs">Ref SKU</Label>
              <Input value={ref} onChange={e => setRef(e.target.value)} placeholder="optional"
                disabled={job.source !== 'order'}  aria-label="Ref SKU"/>
            </div>
          </div>



          <div>
            <Label className="text-xs flex items-center gap-1.5"><ImagePlus className="h-3.5 w-3.5" />Sample picture</Label>
            <p className="text-2xs text-muted-foreground mb-1.5">Shown to the karigar on their work list.</p>
            {job.source === 'order'
              ? <SampleImageInput key={job.id} value={sample} onChange={v => { setSample(v); setSampleChanged(true); }} onRemove={() => { setSample(''); setSampleChanged(true); }} compact />
              : <p className="text-xs text-muted-foreground">Available on order items.</p>}
          </div>

          <div className="rounded-control bg-tone-owed/10 p-3">
            <Label className="text-xs text-tone-owed-ink">Instructions</Label>
            <Textarea rows={4} value={instructions} onChange={e => setInstructions(e.target.value)}
              placeholder="Stones, plating, sizing, or other specifications" className="mt-1"  aria-label="Instructions"/>
            <p className="text-2xs text-tone-owed-ink mt-1">
              Shown to the karigar and on the workshop slip. Never printed on a customer estimate or
              invoice — keep prices and customer details out of it.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── karigar workload card ───────────────────────────────────────────────────

const KarigarCard: React.FC<{
  load: KarigarWorkload;
  contact?: string;
  onToggleDone: (j: WorkshopJob) => void;
  onToggleGiven: (j: WorkshopJob) => void;
  onSetStatus: (j: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (j: WorkshopJob) => void;
  onEdit: (j: WorkshopJob) => void;
  onAssign: (karigarId: string) => void;
}> = ({ load, contact, onToggleDone, onToggleGiven, onSetStatus, onDelete, onEdit, onAssign }) => {
  const [showDone, setShowDone] = useState(false);
  const { toast } = useToast();
  const isUnassigned = load.karigarId === UNASSIGNED_ID;
  const visible = showDone ? load.jobs : load.jobs.filter(j => j.status !== 'completed');

  const share = async () => {
    const text = formatJobListForShare(load, STORE_CONFIG.name);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    if (openWhatsApp(contact, text)) {
      toast({ title: 'Opening WhatsApp', description: 'Job list copied too.' });
    } else {
      toast({ title: 'Job list copied', description: 'No phone saved for this karigar — paste it anywhere.' });
    }
  };

  return (
    <Card className={cn(isUnassigned && load.active > 0 && 'bg-tone-late/[.06]')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-ios-headline flex items-center gap-2">
              {isUnassigned ? <AlertTriangle className="h-4 w-4 text-tone-late-ink" /> : <Hammer className="h-4 w-4 text-primary" />}
              {isUnassigned ? (
                <span className="text-tone-late-ink">Unassigned</span>
              ) : (
                <Link href={`/karigars/${load.karigarId}`} className="hover:underline">{load.karigarName}</Link>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {load.active} active
              {load.inProgress !== load.active && ` · ${load.inProgress} in progress`}
              {load.oldestActiveDays > 0 && ` · oldest ${load.oldestActiveDays}d`}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {load.critical > 0 && <Pill tone="late" icon={<Flame />}>{load.critical}</Pill>}
            {load.overdue > load.critical && <Pill tone="owed">{load.overdue - load.critical} late</Pill>}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          {!isUnassigned && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={share}>
                <Share2 className="h-3.5 w-3.5 mr-1.5" />Send list
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAssign(load.karigarId)}>
                <PlusCircle className="h-3.5 w-3.5 mr-1.5" />Add
              </Button>
            </>
          )}
          {load.completed > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto text-muted-foreground"
              onClick={() => setShowDone(v => !v)}>
              {showDone ? 'Hide' : 'Show'} {load.completed} done
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {load.active > 0 && (
          <div className="flex items-center justify-between text-2xs text-muted-foreground mb-2">
            <span>{load.totalWeightG > 0 ? `${load.totalWeightG.toFixed(3)}g out` : ''}</span>
            <span>{load.totalValue > 0 ? `PKR ${load.totalValue.toLocaleString()}` : ''}</span>
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState title="No pending work" className="py-6" />
        ) : (
          // Fixed height only once the list is long enough to need scrolling:
          // Radix ScrollArea needs a definite height, and a short list should
          // not reserve empty space.
          <ScrollArea className={visible.length > 5 ? 'h-[65vh] lg:h-[30rem]' : ''}>
            <div className="pr-2">
              <OrderGroupedJobs jobs={visible} onToggleDone={onToggleDone} onToggleGiven={onToggleGiven} onSetStatus={onSetStatus} onDelete={onDelete} onEdit={onEdit} />
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

// ── focused view for a single selected karigar ──────────────────────────────

const FocusedKarigarView: React.FC<{
  load: KarigarWorkload;
  contact?: string;
  onToggleDone: (j: WorkshopJob) => void;
  onToggleGiven: (j: WorkshopJob) => void;
  onSetStatus: (j: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (j: WorkshopJob) => void;
  onEdit: (j: WorkshopJob) => void;
  onAssign: (karigarId: string) => void;
  showCompleted: boolean;
  onBack?: () => void;
}> = ({ load, contact, onToggleDone, onToggleGiven, onSetStatus, onDelete, onEdit, onAssign, showCompleted, onBack }) => {
  const { toast } = useToast();
  const isUnassigned = load.karigarId === UNASSIGNED_ID;

  const share = async () => {
    const text = formatJobListForShare(load, STORE_CONFIG.name);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    if (openWhatsApp(contact, text)) {
      toast({ title: 'Opening WhatsApp', description: 'Job list copied too.' });
    } else {
      toast({ title: 'Job list copied', description: 'No phone saved for this karigar — paste it anywhere.' });
    }
  };

  const active = load.jobs.filter(j => j.status !== 'completed');
  const critical = active.filter(j => j.urgency === 'critical').sort((a, b) => b.ageDays - a.ageDays);
  const late = active.filter(j => j.urgency === 'warning').sort((a, b) => b.ageDays - a.ageDays);
  const onTrack = active.filter(j => j.urgency === 'ok').sort((a, b) => b.ageDays - a.ageDays);
  const done = load.jobs.filter(j => j.status === 'completed');
  const orderCount = new Set(active.map(j => j.orderId).filter(Boolean)).size;

  const Section: React.FC<{ title: string; jobs: WorkshopJob[]; tone: 'danger' | 'warn' | 'ok' | 'muted'; hint?: string }> =
  ({ title, jobs, tone, hint }) => {
    if (!jobs.length) return null;
    return (
      <div>
        <div className="flex items-baseline gap-2 mb-2 mt-6 first:mt-0">
          <h3 className={cn(
            'text-sm font-semibold',
            tone === 'danger' && 'text-tone-late-ink',
            tone === 'warn' && 'text-tone-owed-ink',
            tone === 'ok' && 'text-foreground',
            tone === 'muted' && 'text-muted-foreground',
          )}>{title}</h3>
          <span className="text-ios-sub tabular-nums text-muted-foreground">{jobs.length}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        <Card><CardContent className="p-2 sm:p-3">
          <OrderGroupedJobs jobs={jobs} onToggleDone={onToggleDone} onToggleGiven={onToggleGiven} onSetStatus={onSetStatus} onDelete={onDelete} onEdit={onEdit} />
        </CardContent></Card>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card className={cn(isUnassigned && 'bg-tone-late/[.06]')}>
        <CardContent className="p-4 sm:p-6 sm:pt-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-serif text-ios-title2 font-semibold flex items-center gap-2">
                {isUnassigned ? <AlertTriangle className="h-5 w-5 text-tone-late-ink" /> : <Hammer className="h-5 w-5 text-primary" />}
                {isUnassigned ? <span className="text-tone-late-ink">Unassigned work</span>
                  : <Link href={`/karigars/${load.karigarId}`} className="hover:underline">{load.karigarName}</Link>}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {load.active} active job{load.active === 1 ? '' : 's'}
                {orderCount > 0 && ` across ${orderCount} order${orderCount === 1 ? '' : 's'}`}
                {load.oldestActiveDays > 0 && ` · oldest ${load.oldestActiveDays} days`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {onBack && (
                <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" onClick={onBack}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />All karigars
                </Button>
              )}
              {!isUnassigned && (
                <>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={share}><Share2 className="h-4 w-4 mr-1.5" />Send list</Button>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => onAssign(load.karigarId)}><PlusCircle className="h-4 w-4 mr-1.5" />Add work</Button>
                  <Button size="sm" variant="ghost" className="hidden sm:inline-flex" asChild><Link href={`/karigars/${load.karigarId}`}>Profile <ExternalLink className="h-3.5 w-3.5 ml-1.5" /></Link></Button>
                </>
              )}
            </div>
          </div>

          <Separator className="my-3" />

          {/* Only the cells that say something: in-progress is dropped when it
              equals active (it did — 16 and 16), and zero counts are omitted
              rather than printed as a muted 0. */}
          {(() => {
            const cells: { label: string; value: string; tone?: string }[] = [
              { label: 'Active', value: String(load.active) },
            ];
            if (load.inProgress !== load.active) cells.push({ label: 'In progress', value: String(load.inProgress), tone: 'text-tone-working-ink' });
            if (late.length) cells.push({ label: `Late ${WARN_DAYS}d+`, value: String(late.length), tone: 'text-tone-owed-ink' });
            if (load.critical) cells.push({ label: `Critical ${CRITICAL_DAYS}d+`, value: String(load.critical), tone: 'text-tone-late-ink' });
            if (load.totalWeightG > 0) cells.push({ label: 'Gold out', value: `${load.totalWeightG.toFixed(1)}g` });
            if (load.totalValue > 0) cells.push({ label: 'Value', value: lacCrore(load.totalValue) });
            return (
              <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-x-4 sm:gap-x-8 gap-y-3">
                {cells.map(c => (
                  <div key={c.label} className="min-w-0">
                    <p className="text-2xs font-semibold uppercase tracking-[.6px] text-muted-foreground truncate">{c.label}</p>
                    <p className={cn('font-serif text-ios-title2 font-semibold leading-tight tabular-nums', c.tone)}>{c.value}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {active.length === 0 && !showCompleted ? (
        <EmptyState icon={<CheckCircle2 />} title="No pending work" />
      ) : (
        <>
          <Section title="Critical" jobs={critical} tone="danger" hint={`sitting ${CRITICAL_DAYS}+ days`} />
          <Section title="Late" jobs={late} tone="warn" hint={`${WARN_DAYS}–${CRITICAL_DAYS} days`} />
          <Section title="On track" jobs={onTrack} tone="ok" />
          {showCompleted && <Section title="Completed" jobs={done} tone="muted" />}
        </>
      )}
    </div>
  );
};

/** Phone and tablet rendering of a job — a seven-column table is unusable at
 *  375px and still cramped at an iPad's 768px portrait width, so below lg the
 *  All Jobs view switches to these cards (same pattern the Orders list uses). */
const JobCardMobile: React.FC<{
  job: WorkshopJob;
  onToggleDone: (j: WorkshopJob) => void;
  onToggleGiven: (j: WorkshopJob) => void;
  onEdit: (j: WorkshopJob) => void;
}> = ({ job, onToggleDone, onToggleGiven, onEdit }) => {
  const spec = [
    job.size ? `Size ${job.size}` : null,
    job.weightG ? `${job.weightG}g` : null,
    job.plating,
    job.category,
  ].filter(Boolean).join(' · ');

  return (
    <Card className={cn(
      'mb-2',
      job.status === 'completed' && 'opacity-60',
      job.isOnline && 'bg-tone-settled/[.06]',
    )}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Checkbox className="mt-1 h-5 w-5 flex-shrink-0" checked={job.status === 'completed'}
            onCheckedChange={() => onToggleDone(job)} aria-label="Mark done" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className={cn('text-ios-headline font-semibold leading-snug break-words', job.status === 'completed' && 'line-through')}>
                {job.description}
              </p>
              <span className="flex-shrink-0"><AgeBadge job={job} /></span>
            </div>
            {spec && <p className="text-xs text-muted-foreground mt-1">{spec}</p>}

            <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-muted-foreground">
              {job.invoiceId
                ? <Link href={`/invoices/${job.invoiceId}`} className="font-mono text-tone-settled-ink hover:underline">{job.invoiceId}</Link>
                : job.orderId
                  ? <Link href={`/orders/${job.orderId}`} className="font-mono text-foreground hover:underline">{job.orderId}</Link>
                  : <Pill tone="working">Stock</Pill>}
              {job.customerName && <span className="truncate">{job.customerName}</span>}
              <TakenByTag job={job} />
              <span>· {format(parseISO(job.assignedDate), 'dd MMM yy')}</span>
            </div>

            {/* Labelled, because the box on the left already means "done" and a second
                unlabelled one beside it would be a coin toss. */}
            {job.status !== 'completed' && (
              <label className={cn(
                'mt-2 inline-flex items-center gap-2 text-xs',
                job.karigarId === UNASSIGNED_ID ? 'opacity-50' : 'cursor-pointer',
              )}>
                <Checkbox className="h-4 w-4" checked={!!job.givenAt} disabled={job.karigarId === UNASSIGNED_ID}
                  onCheckedChange={() => onToggleGiven(job)} aria-label="Given to karigar" />
                <span className={job.givenAt ? 'text-muted-foreground' : 'text-foreground'}>
                  {job.givenAt ? `Given ${format(parseISO(job.givenAt), 'dd MMM')}` : 'Given to karigar'}
                </span>
              </label>
            )}

            {job.notes && (
              <div className="mt-2 rounded-control bg-tone-owed/[.08] px-2.5 py-1.5">
                <p className="text-xs text-foreground/80 whitespace-pre-wrap">{job.notes}</p>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              {job.source !== 'manual' && job.itemIndex !== undefined && job.status !== 'completed' && (
                <KarigarAssign orderId={job.orderId} invoiceId={job.invoiceId} itemIndex={job.itemIndex}
                  currentKarigarId={job.karigarId === UNASSIGNED_ID ? undefined : job.karigarId} size="compact" />
              )}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(job)}>
                <Pencil className="h-3 w-3 mr-1.5" />Details
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ── page ────────────────────────────────────────────────────────────────────

export default function WorkshopPage() {
  const isHydrated = useIsStoreHydrated();
  const orders = useAppStore(s => s.orders);
  const karigars = useAppStore(s => s.karigars);
  const karigarJobs = useAppStore(s => s.karigarJobs);
  const invoices = useAppStore(s => s.generatedInvoices);
  const { loadOrders, loadKarigars, loadKarigarJobs, loadGeneratedInvoices, updateOrderItemStatus, updateInvoiceItemStatus, setKarigarJobStatus, deleteKarigarJob, updateOrderItemGiven, updateInvoiceItemGiven, setKarigarJobGiven } = useAppStore();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [presetKarigar, setPresetKarigar] = useState<string | undefined>();
  const [editJob, setEditJob] = useState<WorkshopJob | null>(null);
  const [search, setSearch] = useState('');
  // `?karigar=<id>` (the karigar page's "On his bench") opens on his whole bench.
  const [karigarParam] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('karigar'));
  const [karigarFilter, setKarigarFilter] = useState(() => karigarParam || 'all');
  const [statusFilter, setStatusFilter] = useState('active');
  /**
   * Two axes that used to be one tab strip.
   *
   * `focus` is *what* you are looking at, `view` is *how* it is shaped. They
   * were five tabs — All Jobs / By Karigar / Board / Unassigned / Attention —
   * which mixed the two, so unassigned work could only ever be seen as cards
   * and overdue work only ever as a list. Split apart, every combination
   * works: unassigned on the board, one karigar's overdue pieces, and so on.
   */
  const [focus, setFocus] = useState<'all' | 'unassigned' | 'attention' | 'notgiven'>('all');
  const [view, setView] = useState<'list' | 'board' | 'karigar'>('list');
  const [boardMode, setBoardMode] = useState<'karigar' | 'status' | 'none'>('karigar');
  const [typeFilter, setTypeFilter] = useState<'all' | 'order' | 'stock'>('all');
  // Starts on whoever is signed in (lib/people.ts); Anyone is one tap away.
  const [takenByFilter, setTakenByFilter] = useMineFilter('workshop', { startOnAnyone: !!karigarParam, startOnMe: STORE_WORKSHOP_START !== 'anyone' });
  // Inside "By Karigar": the whole-bench summary, or the per-karigar cards.
  const [karigarView, setKarigarView] = useState<'glance' | 'cards'>('glance');

  useEffect(() => {
    loadOrders(); loadKarigars(); loadKarigarJobs(); loadGeneratedInvoices();
  }, [loadOrders, loadKarigars, loadKarigarJobs, loadGeneratedInvoices]);

  const allJobs = useMemo(
    () => buildWorkshopJobs(orders, karigarJobs, karigars, { invoices }),
    [orders, karigarJobs, karigars, invoices],
  );

  // Everything except the karigar filter — the at-a-glance view must keep
  // showing the whole bench even while one karigar is focused.
  const benchJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allJobs.filter(j => {
      if (statusFilter === 'active' && j.status === 'completed') return false;
      if (statusFilter !== 'all' && statusFilter !== 'active' && j.status !== statusFilter) return false;
      if (takenByFilter && j.takenBy !== takenByFilter) return false;
      if (typeFilter === 'order' && j.source !== 'order') return false;
      if (typeFilter === 'stock' && j.source !== 'manual') return false;
      if (!q) return true;
      return [j.description, j.karigarName, j.customerName, j.orderId, j.category]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [allJobs, search, statusFilter, typeFilter, takenByFilter]);

  const filtered = useMemo(
    () => karigarFilter === 'all' ? benchJobs : benchJobs.filter(j => j.karigarId === karigarFilter),
    [benchJobs, karigarFilter],
  );

  const benchLoads = useMemo(() => groupByKarigar(benchJobs), [benchJobs]);
  // While a search or type filter is narrowing the list, an idle karigar means
  // "no match", not "empty bench" — so don't pad the glance with all of them.
  const narrowed = search.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'active' || Boolean(takenByFilter);

  const stats = useMemo(() => {
    const active = allJobs.filter(j => j.status !== 'completed');
    return {
      active: active.length,
      inProgress: active.filter(j => j.status === 'in-progress').length,
      overdue: active.filter(j => j.urgency !== 'ok').length,
      critical: active.filter(j => j.urgency === 'critical').length,
      unassigned: active.filter(j => j.karigarId === UNASSIGNED_ID).length,
      workers: new Set(active.filter(j => j.karigarId !== UNASSIGNED_ID).map(j => j.karigarId)).size,
    };
  }, [allJobs]);

  const contactById = useMemo(
    () => new Map(karigars.map(k => [k.id, k.contact || ''])),
    [karigars],
  );

  // ── actions ──
  const handleToggleDone = async (job: WorkshopJob) => {
    if (job.source === 'order' && job.orderId && job.itemIndex !== undefined) {
      await updateOrderItemStatus(job.orderId, job.itemIndex, job.status !== 'completed');
    } else if (job.source === 'invoice' && job.invoiceId && job.itemIndex !== undefined) {
      await updateInvoiceItemStatus(job.invoiceId, job.itemIndex, job.status !== 'completed');
    } else if (job.source === 'manual') {
      await setKarigarJobStatus(job.id.replace(/^job:/, ''), job.status === 'completed' ? 'pending' : 'completed');
    }
  };
  /**
   * The piece has gone to the karigar — or it has not, after all.
   *
   * Assignment and handover are two different moments. A job is assigned the second
   * somebody picks a name in the app; it is given when the gold actually leaves the
   * shop, and that can be hours or days later, or never, if the karigar does not turn
   * up. Until now the Workshop could only show the first, so "assigned" was doing duty
   * for both and nobody could tell from the list what was still in the safe.
   *
   * Refused when nobody is assigned: there is no one to have given it to.
   */
  const handleToggleGiven = async (job: WorkshopJob) => {
    if (job.karigarId === UNASSIGNED_ID) {
      toast({ title: 'Assign a karigar first', description: 'Nobody is on this piece yet, so there is no one to have given it to.' });
      return;
    }
    const givenAt = job.givenAt ? null : new Date().toISOString();
    try {
      if (job.source === 'order' && job.orderId && job.itemIndex !== undefined) {
        await updateOrderItemGiven(job.orderId, job.itemIndex, givenAt);
      } else if (job.source === 'invoice' && job.invoiceId && job.itemIndex !== undefined) {
        await updateInvoiceItemGiven(job.invoiceId, job.itemIndex, givenAt);
      } else if (job.source === 'manual') {
        await setKarigarJobGiven(job.id.replace(/^job:/, ''), givenAt);
      }
    } catch {
      toast({ title: 'Could not save', description: 'The given mark did not save. Try again.', variant: 'destructive' });
    }
  };

  const handleSetStatus = async (job: WorkshopJob, s: KarigarJobStatus) => {
    if (job.source === 'manual') await setKarigarJobStatus(job.id.replace(/^job:/, ''), s);
  };
  const handleDelete = async (job: WorkshopJob) => {
    if (job.source !== 'manual') return;
    try {
      await deleteKarigarJob(job.id.replace(/^job:/, ''));
      toast({ title: 'Job deleted' });
    } catch (e) {
      toast({ title: 'Error', description: deleteErrorText(e, 'Could not delete.'), variant: 'destructive' });
    }
  };
  const openAssign = (karigarId: string) => { setPresetKarigar(karigarId); setAddOpen(true); };
  const openEdit = (job: WorkshopJob) => setEditJob(job);

  if (!isHydrated) {
    return <div className="container mx-auto p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading workshop…</div>;
  }

  const boardCols: { key: KarigarJobStatus; label: string; icon: React.ReactNode }[] = [
    { key: 'pending', label: 'Pending', icon: <Circle className="h-4 w-4" /> },
    { key: 'in-progress', label: 'In Progress', icon: <CircleDot className="h-4 w-4 text-tone-working-ink" /> },
    { key: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-4 w-4 text-tone-settled-ink" /> },
  ];
  const attention = filtered.filter(j => j.status !== 'completed' && (j.urgency !== 'ok' || j.karigarId === UNASSIGNED_ID));
  // Deliberately ignores the karigar filter: "show me work with nobody on it"
  // is the whole point, and filtering it by karigar would always empty it.
  const unassignedJobs = benchJobs
    .filter(j => j.status !== 'completed' && j.karigarId === UNASSIGNED_ID)
    .sort((a, b) => b.ageDays - a.ageDays);

  // What the views actually render. Focusing unassigned work deliberately
  // drops the karigar filter, since "nobody is on it" and "Uzair is on it"
  // cannot both be true — narrowing by karigar would always empty the list.
  // Assigned to somebody, not done, and not yet handed over -- still in the safe.
  const notGiven = filtered.filter(j => j.status !== 'completed' && j.karigarId !== UNASSIGNED_ID && !j.givenAt);
  const focused = focus === 'unassigned' ? unassignedJobs
    : focus === 'attention' ? attention
    : focus === 'notgiven' ? notGiven
    : filtered;
  const focusIgnoresKarigar = focus === 'unassigned' && karigarFilter !== 'all';
  // The By-karigar view groups whatever is in focus, not the raw filter.
  const focusedLoads = groupByKarigar(focused);

  return (
    <PageShell
      subtitle={<span className="flex items-center gap-x-2 gap-y-0.5 flex-wrap">{/* Counts read as a sentence rather than five cards repeating each other. */}
            <span><span className="font-semibold text-foreground">{stats.active}</span> active</span>
            {stats.inProgress !== stats.active && <span>· {stats.inProgress} in progress</span>}
            {stats.overdue > 0 && (
              <span className="text-tone-owed-ink">· <span className="font-semibold">{stats.overdue}</span> late</span>
            )}
            {stats.critical > 0 && (
              <span className="text-tone-late-ink">· <span className="font-semibold">{stats.critical}</span> critical</span>
            )}
            {stats.unassigned > 0 && (
              <span className="text-tone-late-ink">· <span className="font-semibold">{stats.unassigned}</span> unassigned</span>
            )}
      </span>}
      action={
        <Button className="w-full sm:w-auto sm:flex-shrink-0"
          onClick={() => { setPresetKarigar(undefined); setAddOpen(true); }}>
          <PlusCircle className="h-4 w-4 mr-2" />Assign work
        </Button>
      }
    >
      <FilterBar
        value={search}
        onChange={setSearch}
        placeholder="Search work, karigars, orders"
        activeCount={(statusFilter !== 'active' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) + (takenByFilter ? 1 : 0)}
      >
        <TakenByPicker value={takenByFilter} onChange={setTakenByFilter} allowAny anyLabel="Anyone"
          aria-label="Taken by" className="w-full sm:w-[150px]" />
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as 'all' | 'order' | 'stock')}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All work</SelectItem>
            <SelectItem value="order">Customer orders</SelectItem>
            <SelectItem value="stock">Stock / inventory</SelectItem>
          </SelectContent>
        </Select>
        <KarigarPicker
          value={karigarFilter === 'all' ? '' : karigarFilter}
          onChange={v => setKarigarFilter(!v || v === 'none' ? 'all' : v)}
          placeholder="Everyone"
          clearLabel="Everyone"
          className="w-full sm:w-[170px]"
          aria-label="Filter by karigar"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {/* Views */}
      {/* Focus is what you are looking at; view is how it is shaped. Two
          controls, one row, instead of five tabs that mixed the two. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <ChipRow label="Focus" className="min-w-0 sm:mx-0 sm:px-0">
          {([
            { id: 'all', label: 'All work', n: filtered.filter(j => j.status !== 'completed').length },
            { id: 'unassigned', label: 'Unassigned', n: unassignedJobs.length },
            { id: 'attention', label: 'Requires attention', n: attention.length },
            { id: 'notgiven', label: 'Not yet given', n: notGiven.length },
          ] as const).map(f => (
            <FilterChip key={f.id} title={f.label} count={f.n > 0 ? f.n : undefined}
              chosen={focus === f.id} onClick={() => setFocus(f.id)} />
          ))}
        </ChipRow>

        <Segmented<'list' | 'board' | 'karigar'> label="View" value={view} onChange={setView}
          className="sm:ml-auto flex-shrink-0 [&_button]:flex [&_button]:items-center [&_button]:justify-center [&_button]:gap-1.5"
          options={[
            { value: 'list', label: <><TableIcon className="h-4 w-4" aria-hidden /><span className="sr-only md:not-sr-only md:whitespace-nowrap">List</span></> },
            { value: 'board', label: <><LayoutGrid className="h-4 w-4" aria-hidden /><span className="sr-only md:not-sr-only md:whitespace-nowrap">Board</span></> },
            { value: 'karigar', label: <><Users className="h-4 w-4" aria-hidden /><span className="sr-only md:not-sr-only md:whitespace-nowrap">By karigar</span></> },
          ]} />
      </div>

      {focus !== 'all' && (
        <p className="text-xs text-muted-foreground">
          {focus === 'unassigned'
            ? <>Unassigned pieces, oldest first. Online sales are added automatically. Select a karigar on any row to assign it.{focusIgnoresKarigar && ' The karigar filter does not apply to unassigned work.'}</>
            : <>Unassigned work, or sitting {WARN_DAYS}+ days with a karigar.</>}
        </p>
      )}

      {focus !== 'all' && focused.length === 0 && (
        <EmptyState icon={<CheckCircle2 />}
          title={focus === 'unassigned' ? 'All work is assigned' : focus === 'attention' ? 'No work requires attention' : 'Everything assigned has been given'}
          description={focus === 'unassigned' ? 'No work is awaiting assignment.' : focus === 'attention' ? 'No overdue or unassigned work.' : 'Every assigned piece has gone to its karigar.'}
          action={<Button variant="outline" size="sm" onClick={() => setFocus('all')}>Back to all work</Button>} />
      )}

      {!(focus !== 'all' && focused.length === 0) && (
        <>
        {view === 'karigar' && (
        <div className="mt-4 space-y-3">
          {karigarFilter !== 'all' && focusedLoads.length === 0 ? (
            <EmptyState icon={<PackageOpen />} title="No work matches these filters for this karigar."
              action={<Button variant="outline" size="sm" onClick={() => setKarigarFilter('all')}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />Back to all karigars
              </Button>} />
          ) : karigarFilter !== 'all' ? (
            /* One karigar selected — full width, sectioned by urgency. */
            <FocusedKarigarView
              load={focusedLoads[0]}
              contact={contactById.get(focusedLoads[0].karigarId)}
              onToggleDone={handleToggleDone} onToggleGiven={handleToggleGiven}
              onSetStatus={handleSetStatus}
              onDelete={handleDelete}
              onEdit={openEdit}
              onAssign={openAssign}
              onBack={() => setKarigarFilter('all')}
              showCompleted={statusFilter === 'all' || statusFilter === 'completed'}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  {karigarView === 'glance'
                    ? 'Every karigar on one screen — idle benches included. Tap one to open their jobs.'
                    : 'Each karigar with their pieces listed underneath.'}
                </p>
                <Segmented<'glance' | 'cards'> label="Karigar layout" value={karigarView} onChange={setKarigarView}
                  options={[{ value: 'glance', label: 'At a glance' }, { value: 'cards', label: 'Job lists' }]} />
              </div>

              {karigarView === 'glance' ? (
                <KarigarGlance
                  loads={benchLoads}
                  karigars={narrowed ? [] : karigars}
                  contactById={contactById}
                  onFocus={setKarigarFilter}
                  onAssign={openAssign}
                />
              ) : focusedLoads.length === 0 ? (
                <EmptyState icon={<PackageOpen />} title="No work matches these filters" />
              ) : (
                /* Single column until lg — two of these side by side on an
                   iPad's 768px portrait leaves each one unreadably narrow. */
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {focusedLoads.map(load => (
                    <KarigarCard
                      key={load.karigarId}
                      load={load}
                      contact={contactById.get(load.karigarId)}
                      onToggleDone={handleToggleDone} onToggleGiven={handleToggleGiven}
                      onSetStatus={handleSetStatus}
                      onDelete={handleDelete}
                      onEdit={openEdit}
                      onAssign={openAssign}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        )}

        {/* View 2 — Board: every piece as a card, grouped how you choose */}
        {view === 'board' && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {boardMode === 'karigar'
                ? 'All active work, grouped by assigned karigar.'
                : boardMode === 'status'
                  ? 'Every piece grouped by the stage it is at.'
                  : 'Every piece, oldest first.'}
            </p>
            <Segmented<'karigar' | 'status' | 'none'> label="Group by" value={boardMode} onChange={setBoardMode}
              options={[{ value: 'karigar', label: 'Karigar' }, { value: 'status', label: 'Stage' }, { value: 'none', label: 'All' }]} />
          </div>

          {(() => {
            const grid = 'grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

            if (boardMode === 'none') {
              return focused.length === 0 ? (
                <EmptyState icon={<PackageOpen />} title="Nothing is on the bench" description="No pieces match these filters." />
              ) : (
                <div className={grid}>
                  {focused.map(j => (
                    <BoardJobCard key={j.id} job={j} showKarigar
                      onToggleDone={handleToggleDone} onToggleGiven={handleToggleGiven} onEdit={openEdit} />
                  ))}
                </div>
              );
            }

            // Section headings carry the group's counts so the grid below can
            // stay purely visual.
            const sections = boardMode === 'karigar'
              ? focusedLoads.filter(l => l.jobs.length > 0).map(l => ({
                  key: l.karigarId,
                  title: l.karigarId === UNASSIGNED_ID ? 'Unassigned' : l.karigarName,
                  danger: l.karigarId === UNASSIGNED_ID,
                  icon: l.karigarId === UNASSIGNED_ID
                    ? <AlertTriangle className="h-4 w-4 text-tone-late-ink" />
                    : <Hammer className="h-4 w-4 text-primary" />,
                  critical: l.critical,
                  late: l.overdue - l.critical,
                  weightG: l.totalWeightG,
                  jobs: l.jobs,
                }))
              : boardCols.map(col => {
                  const jobs = focused.filter(j => j.status === col.key);
                  return {
                    key: col.key, title: col.label, danger: false, icon: col.icon,
                    critical: jobs.filter(j => j.urgency === 'critical').length,
                    late: jobs.filter(j => j.urgency === 'warning').length,
                    weightG: 0,
                    jobs,
                  };
                }).filter(sec => sec.jobs.length > 0);

            if (sections.length === 0) {
              return (
                <EmptyState icon={<PackageOpen />} title="Nothing is on the bench" description="No pieces match these filters." />
              );
            }

            return (
              <div className="space-y-6">
                {sections.map(sec => (
                  <section key={sec.key}>
                    <div className="flex items-center gap-2 flex-wrap mb-2 px-1">
                      {sec.icon}
                      <h3 className={cn('font-serif text-ios-title3 font-semibold', sec.danger ? 'text-tone-late-ink' : 'text-foreground')}>{sec.title}</h3>
                      <span className="text-ios-sub tabular-nums text-muted-foreground">{sec.jobs.length}</span>
                      {sec.critical > 0 && <Pill tone="late" icon={<Flame />}>{sec.critical}</Pill>}
                      {sec.late > 0 && <Pill tone="owed">{sec.late} late</Pill>}
                      {sec.weightG > 0 && (
                        <span className="text-2xs text-muted-foreground ml-auto tabular-nums">{sec.weightG.toFixed(1)}g out</span>
                      )}
                    </div>
                    <div className={grid}>
                      {sec.jobs.map(j => (
                        <BoardJobCard key={j.id} job={j} showKarigar={boardMode === 'status'}
                          onToggleDone={handleToggleDone} onToggleGiven={handleToggleGiven} onEdit={openEdit} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            );
          })()}
        </div>
        )}

        {/* View 3 — Table */}
        {view === 'list' && (
        <div className="mt-4">
          <div className="lg:hidden">
            {focused.length === 0
              ? <EmptyState icon={<PackageOpen />} title="No jobs match" />
              : focused.map(j => (
                  <JobCardMobile key={j.id} job={j} onToggleDone={handleToggleDone} onToggleGiven={handleToggleGiven} onEdit={openEdit} />
                ))}
          </div>

          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Job Details</TableHead>
                    <TableHead className="hidden md:table-cell">Given</TableHead>
                    <TableHead>Order / Customer / Taken by</TableHead>
                    <TableHead>Karigar</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {focused.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No jobs match.</TableCell></TableRow>
                  )}
                  {focused.map(j => {
                    const spec = [
                      j.size ? `Size ${j.size}` : null,
                      j.weightG ? `${j.weightG}g` : null,
                      j.plating,
                      j.category,
                    ].filter(Boolean).join(' · ');
                    return (
                      <TableRow key={j.id} className={cn(
                        j.status === 'completed' && 'opacity-60',
                        j.isOnline && 'bg-tone-settled/[.06] hover:bg-tone-settled/10',
                      )}>
                        <TableCell className="align-middle">
                          <Checkbox checked={j.status === 'completed'}
                            onCheckedChange={() => handleToggleDone(j)} aria-label="Mark done" />
                        </TableCell>

                        {/* Name, spec, and the instruction line — mirrors the
                            Orders table's "detail under the title" pattern. */}
                        <TableCell className="align-middle py-3">
                          <div className={cn('font-medium', j.status === 'completed' && 'line-through')}>
                            {j.description}
                          </div>
                          {spec && <div className="text-xs text-muted-foreground mt-0.5">{spec}</div>}
                          {j.notes && (
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1.5 max-w-sm" title={j.notes}>
                              <MessageSquareQuote className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              <span className="min-w-0 truncate">{j.notes.replace(/\n/g, ' · ')}</span>
                            </div>
                          )}
                          {j.source === 'manual' && (
                            <Pill tone="working" className="mt-1">Stock</Pill>
                          )}
                          {j.isOnline && (
                            <Pill tone="settled" className="mt-1">Online</Pill>
                          )}
                        </TableCell>

                        <TableCell className="hidden md:table-cell align-middle">
                          {/* Ticked when the gold has actually left the shop. The date under
                              it is the handover, not the write-up -- that one is on the
                              order. Greyed with nobody assigned: there is no one to give it to. */}
                          <label className={cn(
                            'inline-flex items-center gap-2 text-sm whitespace-nowrap',
                            j.karigarId === UNASSIGNED_ID ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                          )} title={j.karigarId === UNASSIGNED_ID ? 'Assign a karigar first' : (j.givenAt ? 'Given to the karigar -- untick to take it back' : 'Tick when the piece has gone to the karigar')}>
                            <Checkbox checked={!!j.givenAt} disabled={j.karigarId === UNASSIGNED_ID}
                              onCheckedChange={() => handleToggleGiven(j)} aria-label="Given to karigar" />
                            {j.givenAt
                              ? <span className="text-xs text-muted-foreground tabular-nums">{format(parseISO(j.givenAt), 'dd MMM')}</span>
                              : <span className="text-xs text-muted-foreground">Not yet</span>}
                          </label>
                        </TableCell>

                        <TableCell className="align-middle">
                          {j.invoiceId
                            ? <Link href={`/invoices/${j.invoiceId}`} className="font-mono text-sm text-tone-settled-ink hover:underline">{j.invoiceId}</Link>
                            : j.orderId
                              ? <Link href={`/orders/${j.orderId}`} className="font-mono text-sm text-foreground hover:underline">{j.orderId}</Link>
                              : <span className="text-sm text-muted-foreground">—</span>}
                          {j.customerName && <div className="text-xs text-muted-foreground truncate max-w-[11rem]">{j.customerName}</div>}
                          <div className="text-xs text-muted-foreground mt-0.5"><TakenByTag job={j} /></div>
                        </TableCell>

                        <TableCell className="align-middle">
                          {j.source !== 'manual' && j.itemIndex !== undefined && j.status !== 'completed' ? (
                            <KarigarAssign orderId={j.orderId} invoiceId={j.invoiceId} itemIndex={j.itemIndex}
                              currentKarigarId={j.karigarId === UNASSIGNED_ID ? undefined : j.karigarId} size="compact" />
                          ) : j.karigarId === UNASSIGNED_ID
                            ? <Pill tone="late">Unassigned</Pill>
                            : <Link href={`/karigars/${j.karigarId}`} className="text-sm text-primary hover:underline">{j.karigarName}</Link>}
                        </TableCell>

                        <TableCell className="text-right align-middle"><AgeBadge job={j} /></TableCell>

                        <TableCell className="text-right align-middle">
                          <Button variant="outline" size="sm" className="h-8" onClick={() => openEdit(j)}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" />Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
        )}
        </>
      )}

      <AddJobDialog open={addOpen} onOpenChange={setAddOpen} presetKarigarId={presetKarigar} />
      <EditDetailsDialog job={editJob} onClose={() => setEditJob(null)} />
    </PageShell>
  );
}
