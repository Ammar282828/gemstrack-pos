
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Customer, Product, selectAllProductsWithCosts, Invoice, useIsStoreHydrated } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Edit3, Trash2, ArrowLeft, User, Phone, Mail, MapPin, Package, FileText, Brain, AlertTriangle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { analyzeCustomerTrends, AnalyzeCustomerTrendsOutput, AnalyzeCustomerTrendsInput } from '@/ai/flows/analyze-customer-trends-flow';

type ProductWithCosts = ReturnType<typeof selectAllProductsWithCosts>[0];

const DetailItem: React.FC<{ label: string; value: string | undefined; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-start py-2">
    {icon && <span className="mr-3 mt-1 text-muted-foreground">{icon}</span>}
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value || '-'}</p>
    </div>
  </div>
);

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const customerId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const customer = useAppStore(state => state.customers.find(c => c.id === customerId));
  const assignedProducts = useAppStore(state => 
    selectAllProductsWithCosts(state).filter(p => p.assignedCustomerId === customerId)
  );
  const allInvoices = useAppStore(state => state.generatedInvoices);
  const deleteCustomerAction = useAppStore(state => state.deleteCustomer);

  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [customerTrends, setCustomerTrends] = useState<AnalyzeCustomerTrendsOutput | null>(null);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [trendsError, setTrendsError] = useState<string | null>(null);

  useEffect(() => {
    if (isHydrated && customerId && allInvoices.length > 0) {
      const filteredInvoices = allInvoices.filter(invoice => invoice.customerId === customerId);
      setCustomerInvoices(filteredInvoices);
    }
  }, [isHydrated, customerId, allInvoices]);

  useEffect(() => {
    const fetchTrends = async () => {
      if (isHydrated && customer && customerInvoices.length > 0) {
        setIsLoadingTrends(true);
        setTrendsError(null);
        try {
          // Prepare invoices for the AI flow, ensuring item names and other relevant details are present
          const flowInvoices = customerInvoices.map(inv => ({
            id: inv.id,
            createdAt: inv.createdAt,
            grandTotal: inv.grandTotal,
            items: inv.items.map(item => ({
              sku: item.sku,
              name: item.name, // Product name should include category, e.g., "Rings - RIN-001"
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              itemTotal: item.itemTotal,
            })),
          }));

          const input: AnalyzeCustomerTrendsInput = {
            customerId: customer.id,
            customerName: customer.name,
            invoices: flowInvoices,
          };
          const trends = await analyzeCustomerTrends(input);
          setCustomerTrends(trends);
        } catch (error) {
          console.error("Error fetching customer trends:", error);
          setTrendsError("Failed to analyze customer trends. Please try again later.");
          toast({
            title: "AI Analysis Failed",
            description: "Could not retrieve customer purchasing trends.",
            variant: "destructive",
          });
        } finally {
          setIsLoadingTrends(false);
        }
      } else if (customer && customerInvoices.length === 0) {
        setCustomerTrends(null); // Clear trends if no invoices
      }
    };

    fetchTrends();
  }, [isHydrated, customer, customerInvoices, toast]);


  const handleDeleteCustomer = () => {
    deleteCustomerAction(customerId);
    toast({ title: "Customer Deleted", description: `Customer ${customer?.name} has been deleted.` });
    router.push('/customers');
  };

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading customer details...</p></div>;
  }

  if (!customer) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Customer not found</h2>
        <Link href="/customers" passHref>
          <Button variant="link" className="mt-4">Go back to customers</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Button variant="outline" onClick={() => router.back()} className="mb-0">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to List
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-2xl">{customer.name}</CardTitle>
                <User className="w-8 h-8 text-primary" />
              </div>
              <CardDescription>Customer ID: {customer.id}</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailItem label="Phone" value={customer.phone} icon={<Phone className="w-4 h-4" />} />
              <Separator className="my-1" />
              <DetailItem label="Email" value={customer.email} icon={<Mail className="w-4 h-4" />} />
              <Separator className="my-1" />
              <DetailItem label="Address" value={customer.address} icon={<MapPin className="w-4 h-4" />} />
            </CardContent>
            <CardFooter className="flex space-x-2">
              <Button asChild variant="outline" className="w-full">
                <Link href={`/customers/${customerId}/edit`}>
                  <Edit3 className="mr-2 h-4 w-4" /> Edit
                </Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete the customer and unassign them from any products.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteCustomer}>Delete</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>

           <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center">
                <Brain className="mr-2 h-5 w-5 text-primary" /> AI Customer Insights
              </CardTitle>
              <CardDescription>Purchasing trends and preferences for {customer.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingTrends && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
                  <p className="text-muted-foreground">Analyzing trends...</p>
                </div>
              )}
              {trendsError && !isLoadingTrends && (
                <div className="flex items-center text-destructive py-4">
                  <AlertTriangle className="mr-2 h-5 w-5" />
                  <p>{trendsError}</p>
                </div>
              )}
              {!isLoadingTrends && !trendsError && customerTrends && (
                <div className="space-y-3 text-sm">
                  <div><strong className="text-foreground">Summary:</strong> {customerTrends.summary}</div>
                  <div><strong className="text-foreground">Preferred Categories:</strong> {customerTrends.preferredCategories.join(', ') || 'N/A'}</div>
                  <div><strong className="text-foreground">Purchase Frequency:</strong> {customerTrends.purchaseFrequency || 'N/A'}</div>
                  <div><strong className="text-foreground">Average Spend:</strong> PKR {customerTrends.averageTransactionValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div><strong className="text-foreground">Next Purchase Suggestion:</strong> {customerTrends.potentialNextPurchase || 'N/A'}</div>
                </div>
              )}
              {!isLoadingTrends && !trendsError && !customerTrends && customerInvoices.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No transaction history available to analyze trends.</p>
              )}
               {!isLoadingTrends && !trendsError && !customerTrends && customerInvoices.length > 0 && (
                 <p className="text-muted-foreground text-center py-4">AI insights will appear here once generated.</p>
               )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Assigned Products</CardTitle>
              <CardDescription>Products currently assigned to {customer.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {assignedProducts.length > 0 ? (
                <ul className="space-y-3">
                  {assignedProducts.map((product: ProductWithCosts) => (
                    <li key={product.sku} className="p-3 border rounded-md hover:bg-muted/50 transition-colors">
                      <Link href={`/products/${product.sku}`} className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-primary">{product.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                        </div>
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-center py-4">No products assigned to this customer.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Transaction History</CardTitle>
              <CardDescription>Past invoices for {customer.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {customerInvoices.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total (PKR)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.id}</TableCell>
                        <TableCell>{new Date(invoice.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">{invoice.grandTotal.toLocaleString()}</TableCell>
                        {/* Future: Link to view full invoice details page */}
                        {/* <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => {
                             // TODO: Implement navigation to a full invoice view page if needed 
                             toast({title: "Coming Soon", description: "Full invoice view not yet implemented."})
                          }}>
                            <FileText className="h-4 w-4"/>
                          </Button>
                        </TableCell> */}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">No transaction history found for this customer.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
