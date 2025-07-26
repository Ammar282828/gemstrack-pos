
"use client";

import React, { useMemo, useState } from 'react';
import { useAppStore, useAppReady } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, BookUser, ArrowRight, User, Briefcase, ArrowDown, ArrowUp, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  const [searchTerm, setSearchTerm] = useState('');

  const { accountSummaries, totalReceivable, totalPayable, totalReceivableGold, totalPayableGold } = useMemo(() => {
    if (!Array.isArray(hisaabEntries)) {
      return { accountSummaries: [], totalReceivable: 0, totalPayable: 0, totalReceivableGold: 0, totalPayableGold: 0 };
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
        .filter(summary => Math.abs(summary.cashBalance) > 0.001 || Math.abs(summary.goldBalance) > 0.001)
        .sort((a,b) => a.entityName.localeCompare(b.entityName));

    const totalReceivable = summaries.reduce((acc, s) => acc + Math.max(0, s.cashBalance), 0);
    const totalPayable = summaries.reduce((acc, s) => acc + Math.abs(Math.min(0, s.cashBalance)), 0);
    const totalReceivableGold = summaries.reduce((acc, s) => acc + Math.max(0, s.goldBalance), 0);
    const totalPayableGold = summaries.reduce((acc, s) => acc + Math.abs(Math.min(0, s.goldBalance)), 0);


    return { accountSummaries: summaries, totalReceivable, totalPayable, totalReceivableGold, totalPayableGold };

  }, [hisaabEntries]);
  
  const filteredSummaries = useMemo(() => {
    if (!searchTerm) {
      return accountSummaries;
    }
    return accountSummaries.filter(summary =>
      summary.entityName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [accountSummaries, searchTerm]);


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
        <Card className="bg-destructive/10 border-destructive/20">
          <CardHeader>
            <CardTitle className="flex items-center text-destructive">
              <ArrowDown className="mr-2 h-5 w-5"/>
              Total Receivable
            </CardTitle>
            <CardDescription>Total amount you will get from all accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">PKR {totalReceivable.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            {totalReceivableGold > 0 && <p className="text-lg font-semibold text-destructive/90">{totalReceivableGold.toLocaleString(undefined, {minimumFractionDigits: 3})}g Gold</p>}
          </CardContent>
        </Card>
        <Card className="bg-green-600/10 border-green-600/20">
          <CardHeader>
            <CardTitle className="flex items-center text-green-700 dark:text-green-500">
                <ArrowUp className="mr-2 h-5 w-5"/>
                Total Payable
            </CardTitle>
            <CardDescription>Total amount you will give to all accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-700 dark:text-green-500">PKR {totalPayable.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            {totalPayableGold > 0 && <p className="text-lg font-semibold text-green-600/90 dark:text-green-400/90">{totalPayableGold.toLocaleString(undefined, {minimumFractionDigits: 3})}g Gold</p>}
          </CardContent>
        </Card>
      </div>

      <div>
          <h2 className="text-xl font-semibold mb-4">All Accounts</h2>
          <div className="mb-6 relative">
            <Input
              type="search"
              placeholder="Search by name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>

          {filteredSummaries.length > 0 ? (
              <div className="space-y-4">
                  {filteredSummaries.map(summary => (
                      <Card key={summary.entityId} className="shadow-sm hover:shadow-md transition-shadow">
                          <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="flex-grow">
                                  <div className="flex items-center gap-2 mb-2">
                                      {summary.entityType === 'customer' ? <User className="h-5 w-5 text-muted-foreground"/> : <Briefcase className="h-5 w-5 text-muted-foreground"/>}
                                      <h3 className="font-bold text-lg text-primary">{summary.entityName}</h3>
                                  </div>
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-4 text-sm">
                                    {summary.cashBalance > 0 && (
                                        <div className="text-destructive">
                                            <p className="font-semibold">You'll Get (Cash)</p>
                                            <p>PKR {summary.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                    )}
                                    {summary.goldBalance > 0 && (
                                        <div className="text-destructive">
                                            <p className="font-semibold">You'll Get (Gold)</p>
                                            <p>{summary.goldBalance.toLocaleString(undefined, { minimumFractionDigits: 3 })} g</p>
                                        </div>
                                    )}
                                     {summary.cashBalance < 0 && (
                                        <div className="text-green-600">
                                            <p className="font-semibold">You'll Give (Cash)</p>
                                            <p>PKR {Math.abs(summary.cashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                    )}
                                     {summary.goldBalance < 0 && (
                                        <div className="text-green-600">
                                            <p className="font-semibold">You'll Give (Gold)</p>
                                            <p>{Math.abs(summary.goldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g</p>
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
                    <p className="text-muted-foreground">{searchTerm ? 'No accounts match your search.' : 'All accounts are settled. No outstanding balances found.'}</p>
                </CardContent>
              </Card>
          )}
      </div>
    </div>
  );
}
