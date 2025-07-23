
"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAppStore, Order, useAppReady, ORDER_STATUSES, OrderStatus } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, PlusCircle, Eye, ClipboardList, Loader2, Filter } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const getStatusBadgeVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pending':
        return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress':
        return 'bg-blue-500/80 text-blue-50';
      case 'Completed':
        return 'bg-green-500/80 text-green-50';
      case 'Cancelled':
        return 'bg-red-500/80 text-red-50';
      default:
        return 'secondary';
    }
  };

const OrderRow: React.FC<{ order: Order }> = ({ order }) => {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
          {order.id}
        </Link>
      </TableCell>
      <TableCell>{format(parseISO(order.createdAt), 'MMM dd, yyyy')}</TableCell>
      <TableCell>
        <p>{order.customerName || 'Walk-in'}</p>
        {order.customerContact && <p className="text-xs text-muted-foreground">{order.customerContact}</p>}
      </TableCell>
       <TableCell>
         <Badge className={cn("border-transparent", getStatusBadgeVariant(order.status))}>{order.status}</Badge>
      </TableCell>
      <TableCell className="text-right">
        PKR {order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right">
        <Button asChild size="sm" variant="outline">
            <Link href={`/orders/${order.id}`}>
              <Eye className="w-4 h-4 mr-1 md:mr-2" />
              <span className="hidden md:inline">View</span>
            </Link>
          </Button>
      </TableCell>
    </TableRow>
  );
};


export default function OrdersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  
  const appReady = useAppReady();
  const orders = useAppStore(state => state.orders);
  const isOrdersLoading = useAppStore(state => state.isOrdersLoading);
  
  const filteredOrders = useMemo(() => {
    if (!appReady) return [];
    return orders.filter(order =>
        (statusFilter === 'All' || order.status === statusFilter) &&
        (
            order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (order.customerName && order.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (order.customerContact && order.customerContact.includes(searchTerm))
        )
    );
  }, [orders, searchTerm, appReady, statusFilter]);

  if (!appReady || isOrdersLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading orders...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><ClipboardList className="w-8 h-8 mr-3"/>Manage Custom Orders</h1>
          <p className="text-muted-foreground">Track and manage all your custom jewelry orders.</p>
        </div>
        <Link href="/orders/add" passHref>
          <Button size="lg">
            <PlusCircle className="w-5 h-5 mr-2" />
            Create New Order
          </Button>
        </Link>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-4">
          <div className="relative flex-grow w-full">
            <Input
              type="search"
              placeholder="Search by Order ID, Customer Name, or Contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
           <div className="flex flex-wrap gap-2 items-center">
             <span className="text-sm font-medium text-muted-foreground mr-2 flex items-center"><Filter className="w-4 h-4 mr-1"/>Status:</span>
            <Button
              variant={statusFilter === 'All' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('All')}
            >
              All
            </Button>
            {ORDER_STATUSES.map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isOrdersLoading && appReady ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing order list...</p>
         </div>
      ) : filteredOrders.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total (PKR)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <ClipboardList className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Orders Found</h3>
          <p className="text-muted-foreground">
            {searchTerm || statusFilter !== 'All' ? "Try adjusting your search or filter." : "Create a custom order to get started!"}
          </p>
        </div>
      )}
    </div>
  );
}
