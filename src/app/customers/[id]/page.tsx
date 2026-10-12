

"use client";

import React, { useEffect, useState } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Customer, Invoice, Order } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Monogram, Pill, HeroAmount, ContactActions, LedgerSection, EmptyState, type Tone } from '@/components/ledger';
import { isOwing } from '@/lib/owed';
import { Edit3, Trash2, Phone, Mail, MapPin, BookUser, ClipboardList, FileText, Ruler, Cake, CalendarHeart, Heart, StickyNote } from 'lucide-react';
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
import { format, parseISO } from 'date-fns';
import { PageBack } from '@/components/shared/page-back';
import { deleteErrorText } from '@/lib/delete-code';

/** An order's stage in its one tone (a.2); owed is amber, never red. */
const STATUS_TONE: Record<Order['status'], Tone> = {
  Pending: 'owed', 'In Progress': 'working', Completed: 'settled', Cancelled: 'quiet', Refunded: 'quiet',
};

const DetailItem: React.FC<{ label: string; value: string | undefined; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-start gap-3 py-3">
    {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
    <div className="min-w-0">
      <p className="text-ios-foot text-muted-foreground">{label}</p>
      <p className="break-words text-ios-sub font-medium text-foreground">{value || '-'}</p>
    </div>
  </div>
);

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const customerId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const { customer, allInvoices, allOrders, deleteCustomerAction, loadCustomers, loadGeneratedInvoices, loadOrders } = useAppStore(state => ({
    customer: state.customers.find(c => c.id === customerId),
    allInvoices: state.generatedInvoices,
    allOrders: state.orders,
    deleteCustomerAction: state.deleteCustomer,
    loadCustomers: state.loadCustomers,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
    loadOrders: state.loadOrders,
  }));

  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (isHydrated) {
      loadCustomers();
      loadGeneratedInvoices();
      loadOrders();
    }
  }, [isHydrated, loadCustomers, loadGeneratedInvoices, loadOrders]);


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



  const handleDeleteCustomer = async () => {
    try {
      await deleteCustomerAction(customerId);
      toast({ title: "Customer Deleted", description: `Customer ${customer?.name} has been deleted.` });
      router.push('/customers');
    } catch (err) {
      console.error('Failed to delete customer:', err);
      toast({ title: "Delete Failed", description: deleteErrorText(err, "Could not delete the customer. Please try again."), variant: "destructive" });
    }
  };

  if (!isHydrated) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="container mx-auto py-8 px-4 flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] text-center">
        <h2 className="text-2xl font-semibold">Customer not found</h2>
        <Link href="/customers" passHref>
          <Button variant="link" className="mt-4">Go back to customers</Button>
        </Link>
      </div>
    );
  }

  /* One line rather than four empty rows — most customers have one size on file, not all four. */
  const sizes = [
    customer.ringSize && `Ring ${customer.ringSize}`,
    customer.bangleSize && `Bangle ${customer.bangleSize}`,
    customer.braceletSize && `Bracelet ${customer.braceletSize}`,
    customer.chainLength && `Chain ${customer.chainLength}`,
  ].filter(Boolean) as string[];

  // What they owe is the ERP's one rule (lib/owed.ts) over their own invoices; else what they have bought.
  const owedNow = customerInvoices.reduce((n, i) => n + (isOwing(i) ? i.balanceDue || 0 : 0), 0);
  const bought = customerInvoices.reduce((n, i) => n + (i.status === 'Refunded' ? 0 : i.grandTotal || 0), 0);

  const invoiceRows = customerInvoices.map(invoice => (
    <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-ios-sub font-semibold">{invoice.id}</p>
        <p className="text-ios-cap text-muted-foreground">{new Date(invoice.createdAt).toLocaleDateString()}</p>
      </div>
      <span className="font-serif text-ios-title3 font-semibold tabular-nums">PKR {invoice.grandTotal.toLocaleString()}</span>
    </Link>
  ));
  const orderRows = customerOrders.map(order => (
    <Link key={order.id} href={`/orders/${order.id}`} className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-ios-sub font-semibold">{order.id}</p>
        <p className="text-ios-cap text-muted-foreground">{format(parseISO(order.createdAt), 'PP')}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-serif text-ios-title3 font-semibold tabular-nums">PKR {order.grandTotal.toLocaleString()}</span>
        <Pill tone={STATUS_TONE[order.status] ?? 'quiet'}>{order.status}</Pill>
      </div>
    </Link>
  ));

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 space-y-4">
      <PageBack fallback="/customers" label="Back to customers" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-3">
                <Monogram name={customer.name} size={56} />
                <div className="min-w-0">
                  <h1 className="break-words text-ios-title2 font-semibold">{customer.name}</h1>
                  <p className="truncate font-mono text-ios-cap text-muted-foreground">Customer ID: {customer.id}</p>
                </div>
              </div>
              {(owedNow > 0 || bought > 0) && (
                <div>
                  <p className="text-ios-foot text-muted-foreground">{owedNow > 0 ? 'Owes you' : 'Lifetime sales'}</p>
                  <HeroAmount amount={owedNow > 0 ? owedNow : bought} lac={owedNow <= 0} tone={owedNow > 0 ? 'owed' : undefined} />
                </div>
              )}
              <ContactActions phone={customer.phone} className="max-w-sm" />
            </CardHeader>
            <CardContent className="divide-y divide-separator py-0">
              <DetailItem label="Phone" value={customer.phone} icon={<Phone className="w-4 h-4" />} />
              <DetailItem label="Email" value={customer.email} icon={<Mail className="w-4 h-4" />} />
              <DetailItem label="Address" value={[customer.address, customer.city, customer.country].filter(Boolean).join(', ')} icon={<MapPin className="w-4 h-4" />} />
              {customer.altPhone && <DetailItem label="Second number" value={customer.altPhone} icon={<Phone className="w-4 h-4" />} />}
              {sizes.length > 0 && <DetailItem label="Sizes" value={sizes.join(' · ')} icon={<Ruler className="w-4 h-4" />} />}
              {customer.birthday && <DetailItem label="Birthday" value={customer.birthday} icon={<Cake className="w-4 h-4" />} />}
              {customer.anniversary && <DetailItem label="Anniversary" value={customer.anniversary} icon={<CalendarHeart className="w-4 h-4" />} />}
              {customer.preference && <DetailItem label="Prefers" value={customer.preference} icon={<Heart className="w-4 h-4" />} />}
              {customer.notes && <DetailItem label="Notes" value={customer.notes} icon={<StickyNote className="w-4 h-4" />} />}
            </CardContent>
            <CardFooter className="flex-col gap-2 pt-4">
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
                    <Button variant="destructive" className="w-full"><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Remove {customer.name}?</AlertDialogTitle><AlertDialogDescription>This hides them from the book. Their hisaab, orders and invoices stay exactly where they are, and Settings &rarr; Recently removed puts them back.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteCustomer}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardFooter>
          </Card>

        </div>

        <div className="lg:col-span-2 space-y-5">
          {/* Below lg the app's rows; at lg the tables the counter works in. */}
          <div className="lg:hidden space-y-5">
            {customerInvoices.length > 0
              ? <LedgerSection title="Ready Sales History" count={customerInvoices.length}>{invoiceRows}</LedgerSection>
              : <EmptyState className="rounded-card bg-card" icon={<FileText />} title="No sales yet" description="No sales history found for this customer." />}
            {customerOrders.length > 0
              ? <LedgerSection title="Custom Order History" count={customerOrders.length}>{orderRows}</LedgerSection>
              : <EmptyState className="rounded-card bg-card" icon={<ClipboardList />} title="No custom orders" description="No custom orders found for this customer." />}
          </div>

          <Card className="hidden lg:block">
            <CardHeader>
              <h2 className="flex items-center font-serif text-ios-title3 font-semibold"><FileText className="mr-2 h-5 w-5 text-primary" /> Ready Sales History</h2>
              <p className="text-ios-sub text-muted-foreground">Past invoices for {customer.name}.</p>
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
                      <TableRow key={invoice.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${invoice.id}`)}>
                        <TableCell className="font-medium text-primary hover:underline">
                          <Link href={`/invoices/${invoice.id}`} onClick={e => e.stopPropagation()}>{invoice.id}</Link>
                        </TableCell>
                        <TableCell>{new Date(invoice.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{invoice.grandTotal.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">No sales history found for this customer.</p>
              )}
            </CardContent>
          </Card>

          <Card className="hidden lg:block">
            <CardHeader>
              <h2 className="flex items-center font-serif text-ios-title3 font-semibold"><ClipboardList className="mr-2 h-5 w-5 text-primary" /> Custom Order History</h2>
              <p className="text-ios-sub text-muted-foreground">Past custom orders placed by {customer.name}.</p>
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
                            <Pill tone={STATUS_TONE[order.status] ?? 'quiet'}>{order.status}</Pill>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{order.grandTotal.toLocaleString()}</TableCell>
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
