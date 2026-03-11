

"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArchiveRestore, Download, Upload, ExternalLink, HelpCircle, Loader2, PlusCircle, Search, Trash, FileJson, Clock, RotateCcw, CheckSquare, Square } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppStore, Product } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';

const LAST_EXPORT_KEY = 'gemstrack-last-export';

const EXPORTABLE_COLLECTIONS: { id: string; label: string; description: string }[] = [
  { id: 'products',           label: 'Products',           description: 'Active inventory items' },
  { id: 'customers',          label: 'Customers',          description: 'Customer contact details' },
  { id: 'karigars',           label: 'Karigars',           description: 'Artisan/supplier records' },
  { id: 'orders',             label: 'Orders',             description: 'Custom order records' },
  { id: 'invoices',           label: 'Invoices',           description: 'Generated sale invoices' },
  { id: 'hisaab',             label: 'Hisaab / Ledger',   description: 'Outstanding balance ledger' },
  { id: 'expenses',           label: 'Expenses',           description: 'Expense records' },
  { id: 'additional_revenue', label: 'Additional Revenue', description: 'Extra income entries' },
  { id: 'karigar_batches',    label: 'Karigar Batches',    description: 'Karigar work batches' },
  { id: 'given_items',        label: 'Given Items',        description: 'Items given out' },
  { id: 'categories',         label: 'Categories',         description: 'Product category definitions' },
  { id: 'sold_products',      label: 'Sold Products',      description: 'Historical sold product archive' },
];

// --- Export ---
const ExportCard: React.FC = () => {
  const { toast } = useToast();
  const shopName = useAppStore(state => state.settings.shopName);
  const [selected, setSelected]       = useState<Set<string>>(new Set(EXPORTABLE_COLLECTIONS.map(c => c.id)));
  const [counts, setCounts]           = useState<Record<string, number | null>>({});
  const [countLoading, setCountLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress]       = useState(0);
  const [lastExport, setLastExport]   = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(LAST_EXPORT_KEY);
    if (saved) setLastExport(saved);
  }, []);

  const fetchCounts = useCallback(async () => {
    setCountLoading(true);
    const results: Record<string, number> = {};
    await Promise.all(
      EXPORTABLE_COLLECTIONS.map(async col => {
        try {
          const snap = await getDocs(collection(db, col.id));
          results[col.id] = snap.size;
        } catch {
          results[col.id] = -1;
        }
      })
    );
    setCounts(results);
    setCountLoading(false);
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  const toggleAll = () => {
    if (selected.size === EXPORTABLE_COLLECTIONS.length) setSelected(new Set());
    else setSelected(new Set(EXPORTABLE_COLLECTIONS.map(c => c.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalDocs = useMemo(
    () => [...selected].reduce((sum, id) => sum + (counts[id] ?? 0), 0),
    [selected, counts]
  );

  const handleExport = async () => {
    if (selected.size === 0) {
      toast({ title: 'Nothing selected', description: 'Select at least one collection.', variant: 'destructive' });
      return;
    }
    setIsExporting(true);
    setProgress(0);
    const backup: Record<string, Record<string, any>> = {};
    const cols = [...selected];
    try {
      for (let i = 0; i < cols.length; i++) {
        const snap = await getDocs(collection(db, cols[i]));
        backup[cols[i]] = {};
        snap.forEach(d => { backup[cols[i]][d.id] = d.data(); });
        setProgress(Math.round(((i + 1) / cols.length) * 100));
      }
      const blob = new Blob(
        [JSON.stringify({ exportedAt: new Date().toISOString(), collections: cols, data: backup }, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${(shopName || 'gemstrack').replace(/\s+/g, '-')}-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const now = new Date().toLocaleString();
      localStorage.setItem(LAST_EXPORT_KEY, now);
      setLastExport(now);
      toast({ title: 'Backup Downloaded', description: `${totalDocs.toLocaleString()} records across ${cols.length} collections.` });
    } catch (e: any) {
      toast({ title: 'Export Failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl flex items-center"><Download className="mr-2 h-5 w-5" /> Export Backup</CardTitle>
            <CardDescription className="mt-1">Download all your data as a JSON file you can store locally or import later.</CardDescription>
          </div>
          {lastExport && (
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end"><Clock className="h-3 w-3" /> Last export</p>
              <p className="text-xs font-medium">{lastExport}</p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={toggleAll} className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors">
            {selected.size === EXPORTABLE_COLLECTIONS.length
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <Square className="h-4 w-4 text-muted-foreground" />}
            {selected.size === EXPORTABLE_COLLECTIONS.length ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-sm text-muted-foreground">
            {countLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : `${totalDocs.toLocaleString()} records selected`}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EXPORTABLE_COLLECTIONS.map(col => {
            const count = counts[col.id];
            const isSelected = selected.has(col.id);
            return (
              <label key={col.id} className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${isSelected ? 'bg-primary/5 border-primary/30' : 'border-border hover:bg-muted/50'}`}>
                <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(col.id)} className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-none">{col.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{col.description}</p>
                </div>
                <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                  {countLoading ? '…' : count === -1 ? 'err' : (count?.toLocaleString() ?? '…')}
                </span>
              </label>
            );
          })}
        </div>
        {isExporting && <Progress value={progress} className="h-2" />}
      </CardContent>
      <CardFooter>
        <Button onClick={handleExport} disabled={isExporting || selected.size === 0} size="lg" className="w-full sm:w-auto">
          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileJson className="mr-2 h-4 w-4" />}
          {isExporting ? `Exporting… ${progress}%` : 'Download Backup'}
        </Button>
      </CardFooter>
    </Card>
  );
};

// --- Import ---
const ImportCard: React.FC = () => {
  const { toast } = useToast();
  const [file, setFile]               = useState<File | null>(null);
  const [preview, setPreview]         = useState<{ collections: string[]; totalDocs: number; exportedAt: string } | null>(null);
  const [parseError, setParseError]   = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress]       = useState(0);
  const [parsedData, setParsedData]   = useState<Record<string, Record<string, any>> | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setParseError(null); setPreview(null); setParsedData(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        if (!json.data || typeof json.data !== 'object') throw new Error('Invalid backup format — missing data field.');
        const cols     = Object.keys(json.data);
        const totalDocs = cols.reduce((sum, c) => sum + Object.keys(json.data[c]).length, 0);
        setPreview({ collections: cols, totalDocs, exportedAt: json.exportedAt || 'Unknown' });
        setParsedData(json.data);
      } catch (e: any) { setParseError(e.message); }
    };
    reader.readAsText(f);
  };

  const handleImport = async () => {
    if (!parsedData) return;
    setIsImporting(true); setProgress(0);
    const cols = Object.keys(parsedData);
    let written = 0;
    const total = cols.reduce((sum, c) => sum + Object.keys(parsedData[c]).length, 0);
    try {
      for (const colId of cols) {
        const ids = Object.keys(parsedData[colId]);
        for (let i = 0; i < ids.length; i += 400) {
          const batch = writeBatch(db);
          ids.slice(i, i + 400).forEach(id => {
            batch.set(doc(db, colId, id), parsedData[colId][id], { merge: true });
          });
          await batch.commit();
          written += Math.min(400, ids.length - i);
          setProgress(Math.round((written / Math.max(total, 1)) * 100));
        }
      }
      toast({ title: 'Import Complete', description: `${written.toLocaleString()} records restored. Refresh the app to see the data.` });
      setFile(null); setPreview(null); setParsedData(null);
    } catch (e: any) {
      toast({ title: 'Import Failed', description: e.message, variant: 'destructive' });
    } finally { setIsImporting(false); setProgress(0); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center"><Upload className="mr-2 h-5 w-5" /> Restore from Backup</CardTitle>
        <CardDescription>Upload a previously exported JSON backup. Documents are merged — existing records are updated, nothing is deleted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="backup-file" className="text-sm font-medium">Choose backup file (.json)</Label>
          <Input id="backup-file" type="file" accept=".json,application/json" className="mt-1.5 cursor-pointer" onChange={handleFileChange} disabled={isImporting} />
        </div>
        {parseError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Invalid File</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}
        {preview && (
          <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
            <p className="text-sm font-semibold">Backup preview</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Exported at</p>
                <p className="font-medium">{preview.exportedAt !== 'Unknown' ? new Date(preview.exportedAt).toLocaleString() : 'Unknown'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total records</p>
                <p className="font-medium">{preview.totalDocs.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {preview.collections.map(c => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
            </div>
            {isImporting && <Progress value={progress} className="h-2" />}
          </div>
        )}
      </CardContent>
      {preview && (
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isImporting} size="lg" className="w-full sm:w-auto">
                {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                {isImporting ? `Restoring… ${progress}%` : `Restore ${preview.totalDocs.toLocaleString()} Records`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Restore</AlertDialogTitle>
                <AlertDialogDescription>
                  This will merge <strong>{preview.totalDocs.toLocaleString()}</strong> records from the backup into your live database across <strong>{preview.collections.length}</strong> collections. Existing records with matching IDs will be overwritten. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleImport}>Yes, Restore</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      )}
    </Card>
  );
};

// --- Sold Product Recovery ---
const SoldProductRecovery: React.FC = () => {
  const { soldProducts, isSoldProductsLoading, loadSoldProducts, reAddSoldProductToInventory } = useAppStore();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm]       = useState('');
  const [recoveringSku, setRecoveringSku] = useState<string | null>(null);

  useEffect(() => { loadSoldProducts(); }, [loadSoldProducts]);

  const filteredSoldProducts = useMemo(() => {
    if (!searchTerm) return [];
    const lower = searchTerm.toLowerCase();
    return soldProducts
      .filter(p => p && (p.sku?.toLowerCase().includes(lower) || p.name?.toLowerCase().includes(lower)))
      .slice(0, 50);
  }, [soldProducts, searchTerm]);

  const handleReAdd = async (product: Product) => {
    setRecoveringSku(product.sku);
    try {
      await reAddSoldProductToInventory(product);
      toast({ title: 'Product Restored', description: `${product.name} has been re-added to inventory with a new SKU.` });
    } catch (error: any) {
      toast({ title: 'Error', description: `Failed to restore product: ${error.message}`, variant: 'destructive' });
    } finally { setRecoveringSku(null); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center"><ArchiveRestore className="mr-2 h-5 w-5" /> Sold Product Recovery</CardTitle>
        <CardDescription>Search for a sold product by its original SKU or name to re-add it to active inventory.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search SKU or name of a sold item…" className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        {isSoldProductsLoading && searchTerm && <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
        {filteredSoldProducts.length > 0 && (
          <ScrollArea className="h-64 border rounded-md">
            <div className="p-2 space-y-1">
              {filteredSoldProducts.map(p => (
                <div key={p.sku} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.sku}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleReAdd(p)} disabled={recoveringSku === p.sku}>
                    {recoveringSku === p.sku ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                    Re-Add
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        {searchTerm && !isSoldProductsLoading && filteredSoldProducts.length === 0 && (
          <p className="text-center text-sm text-muted-foreground p-4">No sold products found matching your search.</p>
        )}
      </CardContent>
    </Card>
  );
};

// --- Danger Zone ---
const DangerZone: React.FC = () => {
  const { deleteLatestProducts } = useAppStore();
  const { toast } = useToast();
  const [deleteCount, setDeleteCount] = useState<number>(1);
  const [isDeleting, setIsDeleting]   = useState(false);

  const handleDelete = async () => {
    if (deleteCount <= 0) {
      toast({ title: 'Invalid Number', description: 'Please enter a positive number.', variant: 'destructive' });
      return;
    }
    setIsDeleting(true);
    try {
      const deleted = await deleteLatestProducts(deleteCount);
      toast({ title: 'Success', description: `${deleted} latest products deleted.` });
    } catch (e: any) {
      toast({ title: 'Error', description: `Failed: ${e.message}`, variant: 'destructive' });
    } finally { setIsDeleting(false); }
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-xl flex items-center text-destructive"><AlertTriangle className="mr-2 h-5 w-5" /> Danger Zone</CardTitle>
        <CardDescription>Destructive actions that cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="delete-count">Delete Latest N Products (by highest SKU)</Label>
        <div className="flex items-center gap-2 mt-1.5">
          <Input id="delete-count" type="number" value={deleteCount} onChange={e => setDeleteCount(parseInt(e.target.value, 10) || 1)} min="1" className="w-28" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isDeleting}>
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
                Delete {deleteCount} Product{deleteCount !== 1 ? 's' : ''}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the <strong>{deleteCount}</strong> most recently added products. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Yes, delete them</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};

// --- Page ---
export default function BackupRestorePage() {
  const projectId = useAppStore(state => state.settings.firebaseConfig?.projectId);
  const router = useRouter();
  const firestoreConsoleUrl = projectId
    ? `https://console.cloud.google.com/firestore/databases/-default-/pitr?project=${projectId}`
    : 'https://console.cloud.google.com/';

  return (
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4 space-y-6">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="flex-shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary flex items-center gap-2">
            <ArchiveRestore className="h-6 w-6" /> Backup &amp; Recovery
          </h1>
          <p className="text-sm text-muted-foreground">Export, restore, and manage your store data.</p>
        </div>
      </header>

      <ExportCard />
      <ImportCard />
      <SoldProductRecovery />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center"><ExternalLink className="mr-2 h-5 w-5" /> Cloud Database Backups (PITR)</CardTitle>
          <CardDescription>Firestore's Point-in-Time Recovery lets you restore to any minute in the last 7 days via the Google Cloud Console.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <HelpCircle className="h-4 w-4" />
            <AlertTitle>Managed by Google Cloud</AlertTitle>
            <AlertDescription>PITR must be enabled in your Firebase project. Restoration overwrites your current data — consult a developer before using it.</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <a href={firestoreConsoleUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Open Firestore Console
            </a>
          </Button>
        </CardContent>
      </Card>

      <DangerZone />
    </div>
  );
}
