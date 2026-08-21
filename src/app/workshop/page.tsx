"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppStore, KarigarJobStatus, MetalType, KaratValue, staticCategories } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import {
  buildWorkshopJobs, groupByKarigar, formatJobListForShare,
  WorkshopJob, KarigarWorkload, UNASSIGNED_ID, WARN_DAYS, CRITICAL_DAYS,
} from '@/lib/workshop';
import { STORE_CONFIG } from '@/lib/store-config';
import { KarigarAssign } from '@/components/karigar/karigar-assign';
import { SampleImageInput } from '@/components/shared/sample-image-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Table as TableIcon, Flame, Pencil, Save, ImagePlus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

// ── small presentational helpers ────────────────────────────────────────────

const AgeBadge: React.FC<{ job: WorkshopJob }> = ({ job }) => {
  if (job.status === 'completed') {
    return <Badge variant="outline" className="text-green-700 border-green-600/40 bg-green-600/10">Done</Badge>;
  }
  const cls = job.urgency === 'critical'
    ? 'text-destructive border-destructive/40 bg-destructive/10'
    : job.urgency === 'warning'
      ? 'text-yellow-700 border-yellow-500/40 bg-yellow-500/10'
      : 'text-muted-foreground';
  return <Badge variant="outline" className={cn('tabular-nums', cls)}>{job.ageDays}d</Badge>;
};

const StatusDot: React.FC<{ status: KarigarJobStatus }> = ({ status }) => (
  status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-green-600" />
    : status === 'in-progress' ? <CircleDot className="h-4 w-4 text-blue-500" />
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
  onSetStatus: (job: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (job: WorkshopJob) => void;
  onEdit?: (job: WorkshopJob) => void;
  showKarigar?: boolean;
}> = ({ job, onToggleDone, onSetStatus, onDelete, onEdit, showKarigar }) => {
  const meta = [
    job.category,
    job.size ? `Size ${job.size}` : null,
    job.weightG ? `${job.weightG}g` : null,
    job.karat ? String(job.karat).toUpperCase() : null,
    job.referenceSku ? `Ref ${job.referenceSku}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={cn(
      'flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0',
      job.status === 'completed' && 'opacity-60',
    )}>
      <Checkbox
        className="mt-1 flex-shrink-0"
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
            ? <Badge variant="secondary" className="text-[10px] bg-violet-500/15 text-violet-700 dark:text-violet-300">Stock</Badge>
            : <Badge variant="outline" className="text-[10px]">Order</Badge>}
          {showKarigar && (
            <Badge variant="outline" className={cn('text-[10px]', job.karigarId === UNASSIGNED_ID && 'text-destructive border-destructive/40')}>
              {job.karigarName}
            </Badge>
          )}
          {meta && <span>{meta}</span>}
        </div>

        {job.specialNote && (
          <p className="text-xs mt-1 rounded border border-amber-300/70 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/25 px-2 py-1 text-amber-900 dark:text-amber-100 whitespace-pre-wrap">
            <span className="font-semibold">Note: </span>{job.specialNote}
          </p>
        )}

        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          {job.orderId && (
            <Link href={`/orders/${job.orderId}`} className="inline-flex items-center gap-1 min-w-0 hover:underline">
              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">{job.orderId}</Badge>
              {job.customerName && <span className="truncate">{job.customerName}</span>}
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-primary" />
            </Link>
          )}
          <span>given {format(parseISO(job.assignedDate), 'dd MMM yy')}</span>
        </div>

        {/* Controls sit under the content and wrap — keeps narrow cards readable */}
        {(job.source === 'manual' || (job.source === 'order' && job.status !== 'completed')) && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {onEdit && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(job)}>
                <Pencil className="h-3 w-3 mr-1.5" />Details
              </Button>
            )}
            {job.source === 'order' && job.orderId && job.itemIndex !== undefined && job.status !== 'completed' && (
              <KarigarAssign
                orderId={job.orderId}
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
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
      toast({ title: 'Missing info', description: 'Pick a karigar and describe the work.', variant: 'destructive' });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Hammer className="h-5 w-5 text-primary" />Assign Stock Work</DialogTitle>
          <DialogDescription>Pieces for your own inventory — not tied to a customer order. Also use this for repairs and samples.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Karigar *</Label>
            <Select value={karigarId} onValueChange={setKarigarId}>
              <SelectTrigger><SelectValue placeholder="Select karigar" /></SelectTrigger>
              <SelectContent>
                {karigars.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">What are they making? *</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. 4 stacked rings, moti set repair" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={itemCategory} onValueChange={setItemCategory}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {staticCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                </SelectContent>
              </Select>
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Weight (g)</Label>
              <Input type="number" step="0.001" value={weightG} onChange={e => setWeightG(e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <Label className="text-xs">Qty</Label>
              <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Making (PKR)</Label>
              <Input type="number" value={agreedCost} onChange={e => setAgreedCost(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Size</Label>
            <Input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 12, 2.4, 7.5&quot;" />
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instructions, stone details…" />
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


// ── edit the making details of a job (owner-side, Workshop only) ────────────

const EditDetailsDialog: React.FC<{ job: WorkshopJob | null; onClose: () => void }> = ({ job, onClose }) => {
  const updateOrderItemDetails = useAppStore(s => s.updateOrderItemDetails);
  const updateKarigarJob = useAppStore(s => s.updateKarigarJob);
  const { toast } = useToast();

  const [size, setSize] = useState('');
  const [weight, setWeight] = useState('');
  const [ref, setRef] = useState('');
  const [instructions, setInstructions] = useState('');
  const [special, setSpecial] = useState('');
  const [sample, setSample] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!job) return;
    setSize(job.size || '');
    setWeight(job.weightG ? String(job.weightG) : '');
    setRef(job.referenceSku || '');
    setInstructions(job.notes || '');
    setSpecial(job.specialNote || '');
    setSample(job.sampleImage || '');
  }, [job]);

  if (!job) return null;

  const save = async () => {
    setSaving(true);
    try {
      if (job.source === 'order' && job.orderId && job.itemIndex !== undefined) {
        await updateOrderItemDetails(job.orderId, job.itemIndex, {
          size, referenceSku: ref, stoneDetails: instructions, adminNote: special,
          sampleImageDataUri: sample,
          ...(weight !== '' && { estimatedWeightG: Number(weight) }),
        });
      } else {
        await updateKarigarJob(job.id.replace(/^job:/, ''), {
          size: size.trim() || undefined,
          notes: special.trim() || instructions.trim() || undefined,
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
    <Dialog open={!!job} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-primary" />Making details</DialogTitle>
          <DialogDescription>
            {job.description} — only the fields the karigar sees. Price, customer and quantity are unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Size</Label>
              <Input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div>
              <Label className="text-xs">Weight (g)</Label>
              <Input type="number" step="0.001" value={weight} onChange={e => setWeight(e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <Label className="text-xs">Ref SKU</Label>
              <Input value={ref} onChange={e => setRef(e.target.value)} placeholder="optional"
                disabled={job.source !== 'order'} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Instructions</Label>
            <Textarea rows={2} value={instructions} onChange={e => setInstructions(e.target.value)}
              placeholder="Stone / diamond details" disabled={job.source !== 'order'} />
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1.5"><ImagePlus className="h-3.5 w-3.5" />Sample picture</Label>
            <p className="text-[11px] text-muted-foreground mb-1.5">Shown to the karigar on their work list.</p>
            {job.source === 'order'
              ? <SampleImageInput key={job.id} value={sample} onChange={setSample} onRemove={() => setSample('')} compact />
              : <p className="text-xs text-muted-foreground">Available on order items.</p>}
          </div>

          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-3">
            <Label className="text-xs text-amber-800 dark:text-amber-200">Special note</Label>
            <Textarea rows={3} value={special} onChange={e => setSpecial(e.target.value)}
              placeholder="Making instructions for the karigar" className="mt-1" />
            <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">
              Shown to the karigar. Never printed on an estimate or invoice — keep prices and customer details out of it.
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
  onSetStatus: (j: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (j: WorkshopJob) => void;
  onEdit: (j: WorkshopJob) => void;
  onAssign: (karigarId: string) => void;
}> = ({ load, contact, onToggleDone, onSetStatus, onDelete, onEdit, onAssign }) => {
  const [showDone, setShowDone] = useState(false);
  const { toast } = useToast();
  const isUnassigned = load.karigarId === UNASSIGNED_ID;
  const visible = showDone ? load.jobs : load.jobs.filter(j => j.status !== 'completed');

  const share = async () => {
    const text = formatJobListForShare(load, STORE_CONFIG.name);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    const phone = (contact || '').replace(/\D/g, '');
    if (phone) {
      window.open(`https://wa.me/${phone.startsWith('92') ? phone : '92' + phone.replace(/^0/, '')}?text=${encodeURIComponent(text)}`, '_blank');
      toast({ title: 'Opening WhatsApp', description: 'Job list copied too.' });
    } else {
      toast({ title: 'Job list copied', description: 'No phone saved for this karigar — paste it anywhere.' });
    }
  };

  return (
    <Card className={cn(
      load.critical > 0 && 'border-destructive/40',
      isUnassigned && load.active > 0 && 'border-destructive/60 bg-destructive/5',
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              {isUnassigned ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <Hammer className="h-4 w-4 text-primary" />}
              {isUnassigned ? (
                <span className="text-destructive">Unassigned</span>
              ) : (
                <Link href={`/karigars/${load.karigarId}`} className="hover:underline">{load.karigarName}</Link>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {load.active} active · {load.inProgress} in progress
              {load.oldestActiveDays > 0 && ` · oldest ${load.oldestActiveDays}d`}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {load.critical > 0 && <Badge variant="destructive" className="text-[10px]"><Flame className="h-3 w-3 mr-1" />{load.critical}</Badge>}
            {load.overdue > load.critical && <Badge variant="outline" className="text-[10px] text-yellow-700 border-yellow-500/40 bg-yellow-500/10">{load.overdue - load.critical} late</Badge>}
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
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
            <span>{load.totalWeightG > 0 ? `${load.totalWeightG.toFixed(3)}g out` : ''}</span>
            <span>{load.totalValue > 0 ? `PKR ${load.totalValue.toLocaleString()}` : ''}</span>
          </div>
        )}
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">Nothing pending ✅</p>
        ) : (
          // Fixed height only once the list is long enough to need scrolling:
          // Radix ScrollArea needs a definite height, and a short list should
          // not reserve empty space.
          <ScrollArea className={visible.length > 5 ? 'h-[30rem]' : ''}>
            <div className="pr-2">
              {visible.map(j => (
                <JobRow key={j.id} job={j} onToggleDone={onToggleDone} onSetStatus={onSetStatus} onDelete={onDelete} onEdit={onEdit} />
              ))}
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
  onSetStatus: (j: WorkshopJob, s: KarigarJobStatus) => void;
  onDelete: (j: WorkshopJob) => void;
  onEdit: (j: WorkshopJob) => void;
  onAssign: (karigarId: string) => void;
  showCompleted: boolean;
}> = ({ load, contact, onToggleDone, onSetStatus, onDelete, onEdit, onAssign, showCompleted }) => {
  const { toast } = useToast();
  const isUnassigned = load.karigarId === UNASSIGNED_ID;

  const share = async () => {
    const text = formatJobListForShare(load, STORE_CONFIG.name);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    const phone = (contact || '').replace(/\D/g, '');
    if (phone) {
      window.open(`https://wa.me/${phone.startsWith('92') ? phone : '92' + phone.replace(/^0/, '')}?text=${encodeURIComponent(text)}`, '_blank');
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
        <div className="flex items-baseline gap-2 mb-1 mt-4 first:mt-0">
          <h3 className={cn(
            'text-sm font-semibold',
            tone === 'danger' && 'text-destructive',
            tone === 'warn' && 'text-yellow-700',
            tone === 'ok' && 'text-foreground',
            tone === 'muted' && 'text-muted-foreground',
          )}>{title}</h3>
          <Badge variant="secondary" className="text-[10px]">{jobs.length}</Badge>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        <Card><CardContent className="py-1 px-4">
          {jobs.map(j => (
            <JobRow key={j.id} job={j} onToggleDone={onToggleDone} onSetStatus={onSetStatus} onDelete={onDelete} onEdit={onEdit} />
          ))}
        </CardContent></Card>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card className={cn(load.critical > 0 && 'border-destructive/40', isUnassigned && 'border-destructive/60 bg-destructive/5')}>
        <CardContent className="pt-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                {isUnassigned ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <Hammer className="h-5 w-5 text-primary" />}
                {isUnassigned ? <span className="text-destructive">Unassigned work</span>
                  : <Link href={`/karigars/${load.karigarId}`} className="hover:underline">{load.karigarName}</Link>}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {load.active} active job{load.active === 1 ? '' : 's'}
                {orderCount > 0 && ` across ${orderCount} order${orderCount === 1 ? '' : 's'}`}
                {load.oldestActiveDays > 0 && ` · oldest ${load.oldestActiveDays} days`}
              </p>
            </div>
            {!isUnassigned && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={share}><Share2 className="h-4 w-4 mr-1.5" />Send list</Button>
                <Button size="sm" variant="outline" onClick={() => onAssign(load.karigarId)}><PlusCircle className="h-4 w-4 mr-1.5" />Add work</Button>
                <Button size="sm" variant="ghost" asChild><Link href={`/karigars/${load.karigarId}`}>Profile <ExternalLink className="h-3.5 w-3.5 ml-1.5" /></Link></Button>
              </div>
            )}
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">{load.active}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">In progress</p>
              <p className="text-2xl font-bold text-blue-600">{load.inProgress}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Late {WARN_DAYS}d+</p>
              <p className={cn('text-2xl font-bold', late.length ? 'text-yellow-600' : 'text-muted-foreground')}>{late.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Critical {CRITICAL_DAYS}d+</p>
              <p className={cn('text-2xl font-bold', load.critical ? 'text-destructive' : 'text-muted-foreground')}>{load.critical}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gold out</p>
              <p className="text-2xl font-bold">{load.totalWeightG > 0 ? load.totalWeightG.toFixed(1) : '—'}<span className="text-xs font-normal text-muted-foreground">{load.totalWeightG > 0 ? 'g' : ''}</span></p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Value</p>
              <p className="text-2xl font-bold">{load.totalValue > 0 ? `${Math.round(load.totalValue / 1000)}k` : '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {active.length === 0 && !showCompleted ? (
        <Card><CardContent className="py-12 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
          <p className="font-medium">Nothing pending</p>
          <p className="text-sm text-muted-foreground">All caught up.</p>
        </CardContent></Card>
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

// ── page ────────────────────────────────────────────────────────────────────

export default function WorkshopPage() {
  const isHydrated = useIsStoreHydrated();
  const orders = useAppStore(s => s.orders);
  const karigars = useAppStore(s => s.karigars);
  const karigarJobs = useAppStore(s => s.karigarJobs);
  const { loadOrders, loadKarigars, loadKarigarJobs, updateOrderItemStatus, setKarigarJobStatus, deleteKarigarJob } = useAppStore();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [presetKarigar, setPresetKarigar] = useState<string | undefined>();
  const [editJob, setEditJob] = useState<WorkshopJob | null>(null);
  const [search, setSearch] = useState('');
  const [karigarFilter, setKarigarFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [boardMode, setBoardMode] = useState<'karigar' | 'status'>('karigar');
  const [typeFilter, setTypeFilter] = useState<'all' | 'order' | 'stock'>('all');

  useEffect(() => {
    loadOrders(); loadKarigars(); loadKarigarJobs();
  }, [loadOrders, loadKarigars, loadKarigarJobs]);

  const allJobs = useMemo(
    () => buildWorkshopJobs(orders, karigarJobs, karigars),
    [orders, karigarJobs, karigars],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allJobs.filter(j => {
      if (statusFilter === 'active' && j.status === 'completed') return false;
      if (statusFilter !== 'all' && statusFilter !== 'active' && j.status !== statusFilter) return false;
      if (karigarFilter !== 'all' && j.karigarId !== karigarFilter) return false;
      if (typeFilter === 'order' && j.source !== 'order') return false;
      if (typeFilter === 'stock' && j.source !== 'manual') return false;
      if (!q) return true;
      return [j.description, j.karigarName, j.customerName, j.orderId, j.category]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [allJobs, search, karigarFilter, statusFilter, typeFilter]);

  const loads = useMemo(() => groupByKarigar(filtered), [filtered]);

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
    } else if (job.source === 'manual') {
      await setKarigarJobStatus(job.id.replace(/^job:/, ''), job.status === 'completed' ? 'pending' : 'completed');
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
    } catch {
      toast({ title: 'Error', description: 'Could not delete.', variant: 'destructive' });
    }
  };
  const openAssign = (karigarId: string) => { setPresetKarigar(karigarId); setAddOpen(true); };
  const openEdit = (job: WorkshopJob) => setEditJob(job);

  if (!isHydrated) {
    return <div className="container mx-auto p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading workshop…</div>;
  }

  const boardCols: { key: KarigarJobStatus; label: string; icon: React.ReactNode }[] = [
    { key: 'pending', label: 'Pending', icon: <Circle className="h-4 w-4" /> },
    { key: 'in-progress', label: 'In Progress', icon: <CircleDot className="h-4 w-4 text-blue-500" /> },
    { key: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-4 w-4 text-green-600" /> },
  ];
  const attention = filtered.filter(j => j.status !== 'completed' && (j.urgency !== 'ok' || j.karigarId === UNASSIGNED_ID));

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Hammer className="h-6 w-6 text-primary" />Workshop</h1>
          {/* Counts read as a sentence rather than five cards repeating each
              other. In progress only appears when it differs from active, and
              zero-value warnings are simply omitted. */}
          <p className="text-sm text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5">
            <span><span className="font-semibold text-foreground">{stats.active}</span> active</span>
            {stats.inProgress !== stats.active && <span>· {stats.inProgress} in progress</span>}
            {stats.overdue > 0 && (
              <span className="text-yellow-700 dark:text-yellow-500">· <span className="font-semibold">{stats.overdue}</span> late</span>
            )}
            {stats.critical > 0 && (
              <span className="text-destructive">· <span className="font-semibold">{stats.critical}</span> critical</span>
            )}
            {stats.unassigned > 0 && (
              <span className="text-destructive">· <span className="font-semibold">{stats.unassigned}</span> unassigned</span>
            )}
          </p>
        </div>
        <Button onClick={() => { setPresetKarigar(undefined); setAddOpen(true); }}>
          <PlusCircle className="h-4 w-4 mr-2" />Assign Work
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search item, karigar, customer, order…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as 'all' | 'order' | 'stock')}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All work</SelectItem>
            <SelectItem value="order">Customer orders</SelectItem>
            <SelectItem value="stock">Stock / inventory</SelectItem>
          </SelectContent>
        </Select>
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
      </div>

      {/* Quick-select karigars — click to focus one, click again to clear */}
      {(() => {
        const active = allJobs.filter(j => j.status !== 'completed');
        const counts = new Map<string, { name: string; n: number; crit: number }>();
        for (const j of active) {
          const e = counts.get(j.karigarId) || { name: j.karigarName, n: 0, crit: 0 };
          e.n++; if (j.urgency === 'critical') e.crit++;
          counts.set(j.karigarId, e);
        }
        const chips = [...counts.entries()].sort((a, b) => {
          if (a[0] === UNASSIGNED_ID) return -1;
          if (b[0] === UNASSIGNED_ID) return 1;
          return b[1].n - a[1].n;
        });
        if (chips.length === 0) return null;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant={karigarFilter === 'all' ? 'secondary' : 'outline'}
              className="h-7 text-xs" onClick={() => setKarigarFilter('all')}>
              Everyone <Badge variant="secondary" className="ml-1.5 text-[10px]">{active.length}</Badge>
            </Button>
            {chips.map(([id, c]) => {
              const on = karigarFilter === id;
              const unassigned = id === UNASSIGNED_ID;
              return (
                <Button key={id} size="sm" variant={on ? 'secondary' : 'outline'}
                  className={cn('h-7 text-xs', unassigned && !on && 'text-destructive border-destructive/40')}
                  onClick={() => setKarigarFilter(on ? 'all' : id)}>
                  {unassigned ? 'Unassigned' : c.name}
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">{c.n}</Badge>
                  {c.crit > 0 && <Flame className="h-3 w-3 ml-1 text-destructive" />}
                </Button>
              );
            })}
          </div>
        );
      })()}

      {/* Views */}
      <Tabs defaultValue="karigar">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="karigar" className="text-xs sm:text-sm"><Users className="h-4 w-4 mr-1.5 hidden sm:inline" />By Karigar</TabsTrigger>
          <TabsTrigger value="board" className="text-xs sm:text-sm"><LayoutGrid className="h-4 w-4 mr-1.5 hidden sm:inline" />Board</TabsTrigger>
          <TabsTrigger value="list" className="text-xs sm:text-sm"><TableIcon className="h-4 w-4 mr-1.5 hidden sm:inline" />All Jobs</TabsTrigger>
          <TabsTrigger value="attention" className="text-xs sm:text-sm">
            <AlertTriangle className="h-4 w-4 mr-1.5 hidden sm:inline" />Attention
            {attention.length > 0 && <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-[10px]">{attention.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* View 1 — By Karigar */}
        <TabsContent value="karigar" className="mt-4">
          {loads.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <PackageOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />No work matches these filters.
            </CardContent></Card>
          ) : karigarFilter !== 'all' ? (
            /* One karigar selected — give them a full-width, at-a-glance view
               instead of a cramped card in a 3-column grid. */
            <FocusedKarigarView
              load={loads[0]}
              contact={contactById.get(loads[0].karigarId)}
              onToggleDone={handleToggleDone}
              onSetStatus={handleSetStatus}
              onDelete={handleDelete}
              onEdit={openEdit}
              onAssign={openAssign}
              showCompleted={statusFilter === 'all' || statusFilter === 'completed'}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {loads.map(load => (
                <KarigarCard
                  key={load.karigarId}
                  load={load}
                  contact={contactById.get(load.karigarId)}
                  onToggleDone={handleToggleDone}
                  onSetStatus={handleSetStatus}
                  onDelete={handleDelete}
                  onEdit={openEdit}
                  onAssign={openAssign}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* View 2 — Board by status */}
        <TabsContent value="board" className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {boardMode === 'karigar'
                ? 'One column per karigar holding pieces. Idle karigars are hidden.'
                : 'Grouped by stage.'}
            </p>
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              <Button size="sm" variant={boardMode === 'karigar' ? 'secondary' : 'ghost'}
                className="h-7 text-xs" onClick={() => setBoardMode('karigar')}>By Karigar</Button>
              <Button size="sm" variant={boardMode === 'status' ? 'secondary' : 'ghost'}
                className="h-7 text-xs" onClick={() => setBoardMode('status')}>By Stage</Button>
            </div>
          </div>

          {boardMode === 'karigar' ? (
            /* One column per karigar that actually holds pieces — scrolls
               horizontally so workloads can be compared side by side. */
            loads.filter(l => l.active > 0).length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <PackageOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />Nobody is holding pieces right now.
              </CardContent></Card>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
                {loads.filter(l => l.active > 0).map(load => {
                  const items = load.jobs.filter(j => j.status !== 'completed');
                  const isUnassigned = load.karigarId === UNASSIGNED_ID;
                  return (
                    <Card key={load.karigarId} className={cn(
                      'w-[19rem] flex-shrink-0',
                      load.critical > 0 && 'border-destructive/40',
                      isUnassigned && 'border-destructive/60 bg-destructive/5',
                    )}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center justify-between gap-2">
                          <span className="truncate flex items-center gap-1.5">
                            {isUnassigned
                              ? <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                              : <Hammer className="h-4 w-4 text-primary flex-shrink-0" />}
                            {isUnassigned
                              ? <span className="text-destructive">Unassigned</span>
                              : <Link href={`/karigars/${load.karigarId}`} className="hover:underline truncate">{load.karigarName}</Link>}
                          </span>
                          <Badge variant="secondary" className="flex-shrink-0">{items.length}</Badge>
                        </CardTitle>
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          {items.filter(j => j.source === 'manual').length > 0 && (
                            <Badge variant="secondary" className="text-[10px] bg-violet-500/15 text-violet-700 dark:text-violet-300">
                              {items.filter(j => j.source === 'manual').length} stock
                            </Badge>
                          )}
                          {items.filter(j => j.source === 'order').length > 0 && (
                            <Badge variant="outline" className="text-[10px]">{items.filter(j => j.source === 'order').length} order</Badge>
                          )}
                          {load.critical > 0 && <Badge variant="destructive" className="text-[10px]"><Flame className="h-3 w-3 mr-1" />{load.critical}</Badge>}
                          {load.overdue > load.critical && (
                            <Badge variant="outline" className="text-[10px] text-yellow-700 border-yellow-500/40 bg-yellow-500/10">
                              {load.overdue - load.critical} late
                            </Badge>
                          )}
                          {load.totalWeightG > 0 && <span className="text-[10px] text-muted-foreground">{load.totalWeightG.toFixed(1)}g</span>}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className={items.length > 4 ? 'h-[32rem]' : ''}>
                          <div className="pr-2">
                            {items.map(j => (
                              <JobRow key={j.id} job={j} onEdit={openEdit}
                                onToggleDone={handleToggleDone} onSetStatus={handleSetStatus} onDelete={handleDelete} />
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {boardCols.map(col => {
                const items = filtered.filter(j => j.status === col.key);
                return (
                  <Card key={col.key}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span className="flex items-center gap-2">{col.icon}{col.label}</span>
                        <Badge variant="secondary">{items.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {items.length === 0
                        ? <p className="text-sm text-muted-foreground text-center py-6">Empty</p>
                        : (
                          <ScrollArea className={items.length > 5 ? 'h-[34rem]' : ''}>
                            <div className="pr-2">
                              {items.map(j => (
                                <JobRow key={j.id} job={j} showKarigar
                                  onToggleDone={handleToggleDone} onSetStatus={handleSetStatus} onDelete={handleDelete} />
                              ))}
                            </div>
                          </ScrollArea>
                        )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* View 3 — Table */}
        <TabsContent value="list" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Karigar</TableHead>
                    <TableHead className="hidden md:table-cell">Order / Customer</TableHead>
                    <TableHead className="hidden lg:table-cell">Given</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No jobs match.</TableCell></TableRow>
                  )}
                  {filtered.map(j => (
                    <TableRow key={j.id} className={cn(j.status === 'completed' && 'opacity-60')}>
                      <TableCell><StatusDot status={j.status} /></TableCell>
                      <TableCell>
                        <div className={cn('font-medium text-sm', j.status === 'completed' && 'line-through')}>{j.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {[j.category, j.weightG ? `${j.weightG}g` : null].filter(Boolean).join(' · ')}
                          {j.source === 'manual' && <Badge variant="secondary" className="ml-1.5 text-[10px] bg-violet-500/15 text-violet-700 dark:text-violet-300">Stock</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {j.source === 'order' && j.orderId && j.itemIndex !== undefined && j.status !== 'completed' ? (
                          <KarigarAssign
                            orderId={j.orderId}
                            itemIndex={j.itemIndex}
                            currentKarigarId={j.karigarId === UNASSIGNED_ID ? undefined : j.karigarId}
                            size="compact"
                          />
                        ) : j.karigarId === UNASSIGNED_ID
                          ? <Badge variant="outline" className="text-destructive border-destructive/40 text-xs">Unassigned</Badge>
                          : <Link href={`/karigars/${j.karigarId}`} className="text-sm text-primary hover:underline">{j.karigarName}</Link>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {j.orderId
                          ? <Link href={`/orders/${j.orderId}`} className="font-mono text-xs text-primary hover:underline">{j.orderId}</Link>
                          : <span className="text-muted-foreground">—</span>}
                        {j.customerName && <div className="text-xs text-muted-foreground">{j.customerName}</div>}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {format(parseISO(j.assignedDate), 'dd MMM yy')}
                      </TableCell>
                      <TableCell className="text-right"><AgeBadge job={j} /></TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-sm tabular-nums">
                        {j.value ? j.value.toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* View 4 — Needs attention */}
        <TabsContent value="attention" className="mt-4">
          {attention.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
              <p className="font-medium">Nothing needs attention</p>
              <p className="text-sm text-muted-foreground">No overdue or unassigned work.</p>
            </CardContent></Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  {attention.length} job{attention.length === 1 ? '' : 's'} need attention
                </CardTitle>
                <p className="text-xs text-muted-foreground">Unassigned work, or sitting {WARN_DAYS}+ days with a karigar. Oldest first.</p>
              </CardHeader>
              <CardContent>
                {attention
                  .slice()
                  .sort((a, b) => (b.karigarId === UNASSIGNED_ID ? 1 : 0) - (a.karigarId === UNASSIGNED_ID ? 1 : 0) || b.ageDays - a.ageDays)
                  .map(j => (
                    <JobRow key={j.id} job={j} showKarigar onEdit={openEdit}
                      onToggleDone={handleToggleDone} onSetStatus={handleSetStatus} onDelete={handleDelete} />
                  ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AddJobDialog open={addOpen} onOpenChange={setAddOpen} presetKarigarId={presetKarigar} />
      <EditDetailsDialog job={editJob} onClose={() => setEditJob(null)} />
    </div>
  );
}
