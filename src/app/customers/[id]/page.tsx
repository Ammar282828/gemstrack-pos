

"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Customer, Invoice, Order } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Edit3, Trash2, ArrowLeft, User, Phone, Mail, MapPin, Brain, AlertTriangle, Loader2, BookUser, ClipboardList, FileText } from 'lucide-react';
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
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const getStatusBadgeVariant = (status: Order['status']) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
      default: return 'secondary';
    }
};

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
  const allInvoices = useAppStore(state => state.generatedInvoices);
  const allOrders = useAppStore(state => state.orders);
  const deleteCustomerAction = useAppStore(state => state.deleteCustomer);

  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [customerTrends, setCustomerTrends] = useState<AnalyzeCustomerTrendsOutput | null>(null);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [trendsError, setTrendsError] = useState<string | null>(null);

  useEffect(() => {
    if (isHydrated && customerId) {
      if (allInvoices.length > 0) {
        const filteredInvoices = allInvoices.filter(invoice => invoice.customerId === customerId);
        setCustomerInvoices(filteredInvoices);
      }
      if (allOrders.length > 0) {
        const filteredOrders = allOrders.filter(order => order.customerId === customerId);
        setCustomerOrders(filteredOrders.sort((a,b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime()));
      }
    }
  }, [isHydrated, customerId, allInvoices, allOrders]);

  useEffect(() => {
    const fetchTrends = async () => {
      if (isHydrated && customer && customerInvoices.length > 0) {
        setIsLoadingTrends(true);
        setTrendsError(null);
        try {
          const flowInvoices = customerInvoices.map(inv => ({
            id: inv.id,
            createdAt: inv.createdAt,
            grandTotal: inv.grandTotal,
            items: inv.items.map(item => ({
              sku: item.sku,
              name: item.name,
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
        setCustomerTrends(null);
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
            <CardFooter className="flex-col gap-2">
               <Button asChild className="w-full">
                <Link href={`/hisaab/${customer.id}?type=customer`}>
                  <BookUser className="mr-2 h-4 w-4" /> View Hisaab
                </Link>
              </Button>
              <div className="flex space-x-2 w-full">
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
              </div>
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
              <CardTitle className="text-xl flex items-center"><FileText className="mr-2 h-5 w-5 text-primary" /> Ready Sales History</CardTitle>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">No sales history found for this customer.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center"><ClipboardList className="mr-2 h-5 w-5 text-primary" /> Custom Order History</CardTitle>
              <CardDescription>Past custom orders placed by {customer.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {customerOrders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Balance Due (PKR)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerOrders.map((order) => (
                      <TableRow key={order.id} className="cursor-pointer" onClick={() => router.push(`/orders/${order.id}`)}>
                        <TableCell className="font-medium text-primary hover:underline">
                          <Link href={`/orders/${order.id}`}>{order.id}</Link>
                        </TableCell>
                        <TableCell>{format(parseISO(order.createdAt), 'PP')}</TableCell>
                        <TableCell>
                            <Badge className={cn("border-transparent", getStatusBadgeVariant(order.status))}>
                                {order.status}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right">{order.grandTotal.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">No custom orders found for this customer.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
