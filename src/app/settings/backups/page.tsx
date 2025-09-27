

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArchiveRestore, ExternalLink, HelpCircle, Loader2, PlusCircle, Search, Trash } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppStore, Product } from '@/lib/store';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

const DangerZone: React.FC = () => {
    const { deleteLatestProducts } = useAppStore();
    const { toast } = useToast();
    const [deleteCount, setDeleteCount] = useState<number>(1);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (deleteCount <= 0) {
            toast({ title: "Invalid Number", description: "Please enter a positive number of products to delete.", variant: "destructive" });
            return;
        }
        setIsDeleting(true);
        try {
            const deletedCount = await deleteLatestProducts(deleteCount);
            toast({ title: "Success", description: `${deletedCount} latest products have been deleted.` });
        } catch (e: any) {
            toast({ title: "Error", description: `Failed to delete products: ${e.message}`, variant: "destructive" });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Card className="border-destructive">
            <CardHeader>
                <CardTitle className="text-xl flex items-center text-destructive">
                    <AlertTriangle className="mr-2 h-5 w-5" /> Danger Zone
                </CardTitle>
                <CardDescription>
                    These are destructive actions. Use them with extreme caution as they cannot be undone.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="delete-count">Delete Latest Products</Label>
                    <div className="flex items-center gap-2 mt-1">
                        <Input
                            id="delete-count"
                            type="number"
                            value={deleteCount}
                            onChange={(e) => setDeleteCount(parseInt(e.target.value, 10) || 1)}
                            min="1"
                            className="w-32"
                        />
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isDeleting}>
                                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
                                    Delete {deleteCount} Product(s)
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete the <strong>{deleteCount}</strong> most recently added products from your inventory.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                                        Yes, delete them
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                     <p className="text-xs text-muted-foreground mt-2">
                        This will remove the specified number of products based on the highest SKU numbers.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};


const SoldProductRecovery: React.FC = () => {
    const { soldProducts, isSoldProductsLoading, loadSoldProducts, reAddSoldProductToInventory } = useAppStore();
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [recoveringSku, setRecoveringSku] = useState<string | null>(null);

    useEffect(() => {
        loadSoldProducts();
    }, [loadSoldProducts]);

    const filteredSoldProducts = useMemo(() => {
        if (!searchTerm) return [];
        return soldProducts.filter(p => {
            if (!p) return false;
            const lowerCaseSearch = searchTerm.toLowerCase();
            const matchesSku = p.sku?.toLowerCase().includes(lowerCaseSearch);
            const matchesName = p.name && p.name.toLowerCase().includes(lowerCaseSearch);
            return matchesSku || matchesName;
        }).slice(0, 50); // Limit results for performance
    }, [soldProducts, searchTerm]);

    const handleReAdd = async (product: Product) => {
        setRecoveringSku(product.sku);
        try {
            await reAddSoldProductToInventory(product);
            toast({
                title: 'Product Restored',
                description: `Product ${product.name} has been re-added to inventory with a new SKU.`,
            });
        } catch (error: any) {
            toast({
                title: 'Error',
                description: `Failed to restore product: ${error.message}`,
                variant: 'destructive',
            });
        } finally {
            setRecoveringSku(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-xl flex items-center">
                    <ArchiveRestore className="mr-2 h-5 w-5" /> Sold Product Recovery
                </CardTitle>
                <CardDescription>
                    Search for a sold product by its original SKU or name to re-add it to your active inventory as a new item.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search SKU or Name of a sold item..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                {isSoldProductsLoading && searchTerm && (
                    <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                )}
                {filteredSoldProducts.length > 0 && (
                    <ScrollArea className="h-64 border rounded-md">
                        <div className="p-2 space-y-1">
                            {filteredSoldProducts.map(p => (
                                <div key={p.sku} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                    <div>
                                        <p className="font-semibold">{p.name}</p>
                                        <p className="text-sm text-muted-foreground">{p.sku}</p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleReAdd(p)}
                                        disabled={recoveringSku === p.sku}
                                    >
                                        {recoveringSku === p.sku ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <PlusCircle className="mr-2 h-4 w-4" />
                                        )}
                                        Re-Add to Inventory
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


export default function BackupRestorePage() {
  const projectId = useAppStore(state => state.settings.firebaseConfig?.projectId);
  const router = useRouter();

  const firestoreConsoleUrl = projectId 
    ? `https://console.cloud.google.com/firestore/databases/-default-/pitr?project=${projectId}`
    : 'https://console.cloud.google.com/';

  return (
    <div className="container mx-auto p-4 space-y-8">
      <header>
          <Button variant="outline" onClick={() => router.back()} className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
          </Button>
          <CardTitle className="text-2xl flex items-center">
              <ArchiveRestore className="mr-3 h-7 w-7 text-primary" />
              Data Recovery &amp; Management
          </CardTitle>
          <CardDescription>
              Advanced tools for restoring data and managing the database. Use these features with caution.
          </CardDescription>
      </header>
      
      <SoldProductRecovery />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
             <ExternalLink className="mr-2 h-5 w-5" /> Cloud Database Backups
          </CardTitle>
          <CardDescription>
            Manage database backups using Firestore's Point-in-Time Recovery (PITR). This feature must be enabled in your Google Cloud project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-secondary/30">
            <h3 className="font-semibold text-lg flex items-center mb-2">
              <HelpCircle className="mr-2 h-5 w-5" />
              What is Point-in-Time Recovery (PITR)?
            </h3>
            <p className="text-muted-foreground">
              PITR provides continuous backups of your database, protecting you from accidental deletions or data corruption. When enabled, Firestore retains historical versions of your data, allowing you to restore your database to any specific minute within the last 7 days.
            </p>
            <p className="text-muted-foreground mt-2">
              This is a powerful safety net for your business data. The restoration process is handled securely through the Google Cloud Console, not directly within this application.
            </p>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Important: Restoration is an Advanced Action</AlertTitle>
            <AlertDescription>
              Restoring your database will overwrite your current data with the data from the backup point. This action cannot be undone. Always be certain before initiating a restore. It's recommended to consult the official documentation or a technical expert if you are unsure.
            </AlertDescription>
          </Alert>
          
          <div className="text-center pt-4">
            <Button asChild size="lg">
              <a href={firestoreConsoleUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-5 w-5" />
                Manage Cloud Backups
              </a>
            </Button>
            {!projectId && (
                <p className="text-sm text-destructive mt-2">
                    Could not determine your Firebase Project ID. Please ensure it is set correctly in your environment variables.
                </p>
            )}
          </div>
        </CardContent>
      </Card>

      <DangerZone />
    </div>
  );
}

    