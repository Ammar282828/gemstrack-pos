
"use client";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Order, OrderStatus, useIsStoreHydrated, ORDER_STATUSES, KaratValue } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, DollarSign, Calendar, Edit, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const getStatusBadgeVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
      default: return 'secondary';
    }
};

const DetailItem: React.FC<{ label: string; value?: string | number; children?: React.ReactNode; icon?: React.ReactNode }> = ({ label, value, children, icon }) => (
    <div className="flex items-start justify-between py-2">
      <div className="flex items-center text-sm text-muted-foreground">
        {icon && <div className="mr-2">{icon}</div>}
        <p>{label}</p>
      </div>
      {children || <p className="font-medium text-foreground">{value}</p>}
    </div>
);

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const orderId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const order = useAppStore(state => state.orders.find(o => o.id === orderId));
  const updateOrderStatus = useAppStore(state => state.updateOrderStatus);
  
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const handleStatusChange = async (newStatus: OrderStatus) => {
    if (!order) return;
    setIsUpdatingStatus(true);
    try {
        await updateOrderStatus(order.id, newStatus);
        toast({ title: "Status Updated", description: `Order ${order.id} status changed to "${newStatus}".` });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update order status.", variant: "destructive" });
    } finally {
        setIsUpdatingStatus(false);
    }
  };


  if (!isHydrated) {
    return (
        <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
          <p className="text-lg text-muted-foreground">Loading order details...</p>
        </div>
      );
  }

  if (!order) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Order not found</h2>
        <Link href="/orders" passHref>
          <Button variant="link" className="mt-4">Go back to orders dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Button variant="outline" onClick={() => router.back()} className="mb-0">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
      </Button>

        <Card>
            <CardHeader>
                <div className="flex flex-col md:flex-row justify-between md:items-start gap-4">
                    <div>
                        <CardTitle className="text-2xl">Order {order.id}</CardTitle>
                        <CardDescription>Details of the custom order.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={cn("text-base border-transparent", getStatusBadgeVariant(order.status))}>
                            {order.status}
                        </Badge>
                        <Select onValueChange={(val) => handleStatusChange(val as OrderStatus)} disabled={isUpdatingStatus}>
                            <SelectTrigger className="w-[180px] h-9" id="status-update">
                                <SelectValue placeholder="Update Status" />
                            </SelectTrigger>
                            <SelectContent>
                                {ORDER_STATUSES.map(status => (
                                    <SelectItem key={status} value={status}>{status}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <DetailItem label="Order Date" value={format(parseISO(order.createdAt), 'PPpp')} icon={<Calendar className="w-4 h-4"/>}/>
                    <DetailItem label="Customer" value={order.customerName || 'Walk-in'} icon={<User className="w-4 h-4"/>} />
                    <DetailItem label="Gold Rate Applied" value={`PKR ${order.goldRate.toLocaleString()}/gram (24k)`} icon={<DollarSign className="w-4 h-4"/>}/>
                </div>

                <Separator className="my-6" />

                <h3 className="text-lg font-semibold mb-4">Order Items</h3>
                <div className="space-y-4">
                    {order.items.map((item, index) => (
                        <div key={index} className="p-4 border rounded-lg flex flex-col md:flex-row gap-4 bg-muted/30">
                            {item.sampleImageDataUri && (
                                <div className="relative w-full md:w-24 h-24 flex-shrink-0">
                                    <Image src={item.sampleImageDataUri} alt={`Sample for ${item.description}`} fill className="object-contain rounded-md border bg-muted" />
                                </div>
                            )}
                            <div className="flex-grow">
                                <p className="font-bold">{item.description}</p>
                                <p className="text-sm text-muted-foreground">
                                    Est. Wt: {item.estimatedWeightG}g ({item.karat.toUpperCase()})
                                    {item.referenceSku && ` | Ref: ${item.referenceSku}`}
                                    {item.sampleGiven && ` | Sample Provided`}
                                </p>
                                <div className="text-sm mt-2 p-2 bg-background rounded-md">
                                    <div className="flex justify-between"><span>Metal Cost:</span> <span className="font-semibold">PKR {item.metalCost?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                    {item.makingCharges > 0 && <div className="flex justify-between"><span>+ Making Charges:</span> <span className="font-semibold">PKR {item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                    {item.diamondCharges > 0 && <div className="flex justify-between"><span>+ Diamond Charges:</span> <span className="font-semibold">PKR {item.diamondCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                    {item.stoneCharges > 0 && <div className="flex justify-between"><span>+ Other Stone Charges:</span> <span className="font-semibold">PKR {item.stoneCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                    <Separator className="my-1"/>
                                    <div className="flex justify-between font-bold"><span>Item Total:</span> <span>PKR {item.totalEstimate?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <Separator className="my-6" />

                 <div className="flex justify-end">
                    <div className="w-full max-w-sm space-y-2 p-4 text-lg">
                        <div className="flex justify-between"><span>Subtotal:</span> <span className="font-semibold">PKR {order.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between"><span>Advance Payment:</span> <span className="font-semibold text-destructive">- PKR {order.advancePayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                        {order.advanceGoldDetails && (
                            <div className="pt-2 text-sm">
                            <p className="font-semibold">Advance Gold Details:</p>
                            <p className="text-muted-foreground whitespace-pre-wrap">{order.advanceGoldDetails}</p>
                            </div>
                        )}
                        <Separator className="my-2 bg-muted-foreground/20"/>
                        <div className="flex justify-between font-bold text-xl"><span className="text-primary">Balance Due:</span> <span className="text-primary">PKR {order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    </div>
                </div>

            </CardContent>
        </Card>
    </div>
  );
}
