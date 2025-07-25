
"use client";

import React, { useMemo } from 'react';
import { useAppStore, HisaabEntry, useAppReady } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, BookUser, ArrowRight, User, Briefcase } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

type AccountSummary = {
  entityId: string;
  entityName: string;
  entityType: 'customer' | 'karigar';
  cashBalance: number; // Positive means they owe us, negative means we owe them
  goldBalance: number; // Positive means they owe us, negative means we owe them
};

export default function HisaabPage() {
  const appReady = useAppReady();
  const hisaabEntries = useAppStore(state => state.hisaabEntries);
  const isLoading = useAppStore(state => state.isHisaabLoading);

  const accountSummaries = useMemo((): AccountSummary[] => {
    if (!Array.isArray(hisaabEntries)) return [];

    const summaryMap: { [entityId: string]: AccountSummary } = {};

    hisaabEntries.forEach(entry => {
      if (!summaryMap[entry.entityId]) {
        summaryMap[entry.entityId] = {
          entityId: entry.entityId,
          entityName: entry.entityName,
          entityType: entry.entityType,
          cashBalance: 0,
          goldBalance: 0,
        };
      }

      summaryMap[entry.entityId].cashBalance += (entry.cashDebit - entry.cashCredit);
      summaryMap[entry.entityId].goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
    });

    return Object.values(summaryMap).filter(summary => summary.cashBalance !== 0 || summary.goldBalance !== 0)
      .sort((a,b) => a.entityName.localeCompare(b.entityName));

  }, [hisaabEntries]);

  if (!appReady || (isLoading && hisaabEntries.length === 0)) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Hisaab...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
       <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center"><BookUser className="mr-3 h-8 w-8"/>Hisaab / Ledger</h1>
        <p className="text-muted-foreground">Summary of all outstanding accounts for customers and karigars.</p>
      </header>

      <Card>
          <CardHeader>
              <CardTitle>Accounts Summary</CardTitle>
              <CardDescription>
                  This list shows all entities with a non-zero balance of either cash or gold.
              </CardDescription>
          </CardHeader>
          <CardContent>
              {accountSummaries.length > 0 ? (
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>Entity (Customer/Karigar)</TableHead>
                              <TableHead className="text-right text-destructive">You Will Get (Receivable)</TableHead>
                              <TableHead className="text-right text-green-600">You Will Give (Payable)</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {accountSummaries.map(summary => (
                              <TableRow key={summary.entityId}>
                                  <TableCell>
                                      <div className="flex items-center gap-2">
                                          {summary.entityType === 'customer' ? <User className="h-4 w-4 text-muted-foreground"/> : <Briefcase className="h-4 w-4 text-muted-foreground"/>}
                                          <span className="font-medium">{summary.entityName}</span>
                                      </div>
                                  </TableCell>
                                  {/* Receivable Column */}
                                  <TableCell className="text-right font-semibold text-destructive">
                                    {summary.cashBalance > 0 && <div>PKR {summary.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                                    {summary.goldBalance > 0 && <div>{summary.goldBalance.toLocaleString(undefined, { minimumFractionDigits: 3 })} g</div>}
                                  </TableCell>
                                  {/* Payable Column */}
                                  <TableCell className="text-right font-semibold text-green-600">
                                    {summary.cashBalance < 0 && <div>PKR {Math.abs(summary.cashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                                    {summary.goldBalance < 0 && <div>{Math.abs(summary.goldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g</div>}
                                  </TableCell>
                                   <TableCell className="text-right">
                                       <Button asChild size="sm" variant="outline">
                                           <Link href={`/hisaab/${summary.entityId}?type=${summary.entityType}`}>
                                               View Ledger <ArrowRight className="ml-2 h-4 w-4"/>
                                           </Link>
                                       </Button>
                                   </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              ) : (
                  <div className="text-center py-10">
                      <p className="text-muted-foreground">All accounts are settled. No outstanding balances found.</p>
                  </div>
              )}
          </CardContent>
      </Card>
    </div>
  );
}
