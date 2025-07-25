
"use client";

import React, { useMemo } from 'react';
import { useAppStore, HisaabEntry, useAppReady } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, BookUser, ArrowRight, User, Briefcase, ArrowDown, ArrowUp } from 'lucide-react';
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

  const { accountSummaries, totalReceivable, totalPayable } = useMemo(() => {
    if (!Array.isArray(hisaabEntries)) {
      return { accountSummaries: [], totalReceivable: 0, totalPayable: 0 };
    }

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

    const summaries = Object.values(summaryMap)
        .filter(summary => summary.cashBalance !== 0 || summary.goldBalance !== 0)
        .sort((a,b) => a.entityName.localeCompare(b.entityName));

    const totalReceivable = summaries.reduce((acc, s) => acc + Math.max(0, s.cashBalance), 0);
    const totalPayable = summaries.reduce((acc, s) => acc + Math.abs(Math.min(0, s.cashBalance)), 0);

    return { accountSummaries: summaries, totalReceivable, totalPayable };

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
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Card className="bg-red-500/10 border-red-500/20">
          <CardHeader>
            <CardTitle className="flex items-center text-destructive">
              <ArrowDown className="mr-2 h-5 w-5"/>
              Total Receivable
            </CardTitle>
            <CardDescription>Total amount you will get from all accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">PKR {totalReceivable.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-500/10 border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center text-green-700 dark:text-green-400">
                <ArrowUp className="mr-2 h-5 w-5"/>
                Total Payable
            </CardTitle>
            <CardDescription>Total amount you will give to all accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-700 dark:text-green-400">PKR {totalPayable.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </CardContent>
        </Card>
      </div>

      <div>
          <h2 className="text-xl font-semibold mb-4">All Accounts</h2>
          {accountSummaries.length > 0 ? (
              <div className="space-y-4">
                  {accountSummaries.map(summary => (
                      <Card key={summary.entityId} className="shadow-sm hover:shadow-md transition-shadow">
                          <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="flex-grow">
                                  <div className="flex items-center gap-2 mb-2">
                                      {summary.entityType === 'customer' ? <User className="h-5 w-5 text-muted-foreground"/> : <Briefcase className="h-5 w-5 text-muted-foreground"/>}
                                      <h3 className="font-bold text-lg text-primary">{summary.entityName}</h3>
                                  </div>
                                  <div className="flex flex-wrap gap-4 text-sm">
                                    {(summary.cashBalance > 0 || summary.goldBalance > 0) && (
                                        <div className="text-destructive">
                                            <p className="font-semibold">You'll Get</p>
                                            {summary.cashBalance > 0 && <p>PKR {summary.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>}
                                            {summary.goldBalance > 0 && <p>{summary.goldBalance.toLocaleString(undefined, { minimumFractionDigits: 3 })} g</p>}
                                        </div>
                                    )}
                                     {(summary.cashBalance < 0 || summary.goldBalance < 0) && (
                                        <div className="text-green-600">
                                            <p className="font-semibold">You'll Give</p>
                                            {summary.cashBalance < 0 && <p>PKR {Math.abs(summary.cashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>}
                                            {summary.goldBalance < 0 && <p>{Math.abs(summary.goldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g</p>}
                                        </div>
                                    )}
                                  </div>
                              </div>
                              <div className="flex-shrink-0 w-full md:w-auto">
                                   <Button asChild variant="outline" className="w-full">
                                       <Link href={`/hisaab/${summary.entityId}?type=${summary.entityType}`}>
                                           View Ledger <ArrowRight className="ml-2 h-4 w-4"/>
                                       </Link>
                                   </Button>
                              </div>
                          </CardContent>
                      </Card>
                  ))}
              </div>
          ) : (
              <Card>
                <CardContent className="text-center py-10">
                    <p className="text-muted-foreground">All accounts are settled. No outstanding balances found.</p>
                </CardContent>
              </Card>
          )}
      </div>
    </div>
  );
}
