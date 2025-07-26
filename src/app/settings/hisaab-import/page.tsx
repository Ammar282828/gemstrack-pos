
"use client";

import React, { useState, useMemo } from 'react';
import { useAppStore, Customer, Karigar, HisaabEntry } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, FileUp, ListChecks, Check, X, Import, Loader2, User, Briefcase } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import Papa from 'papaparse';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parse, isValid } from 'date-fns';

type ParsedRow = {
  date: string;
  description: string;
  cashIn: number;
  cashOut: number;
  isValidDate: boolean;
};

type ImportableHisaabEntry = Omit<HisaabEntry, 'id'>;

export default function HisaabImportPage() {
  const { customers, karigars, addHisaabEntry, addCustomer, addKarigar } = useAppStore();
  const { toast } = useToast();
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entities = useMemo(() => {
    const customerEntities = customers.map(c => ({ id: c.id, name: c.name, type: 'customer' as const }));
    const karigarEntities = karigars.map(k => ({ id: k.id, name: k.name, type: 'karigar' as const }));
    return [...customerEntities, ...karigarEntities].sort((a,b) => a.name.localeCompare(b.name));
  }, [customers, karigars]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setParsedData([]);
      
      Papa.parse<any>(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length) {
            setError(`Error parsing CSV: ${results.errors[0].message}`);
            return;
          }
          
          const requiredHeaders = ['Date', 'Details', 'Cash IN', 'Cash OUT'];
          const actualHeaders = results.meta.fields || [];
          const missingHeaders = requiredHeaders.filter(h => !actualHeaders.includes(h));

          if (missingHeaders.length > 0) {
            setError(`Missing required columns in CSV: ${missingHeaders.join(', ')}. Please ensure your file has the correct headers.`);
            return;
          }

          const parsedRows: ParsedRow[] = results.data.map(row => {
            const dateStr = row.Date?.trim();
            // Try parsing multiple common date formats
            const possibleFormats = ["dd-MMM-yy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd", "dd-MM-yyyy"];
            let parsedDate: Date | null = null;
            for (const format of possibleFormats) {
                const date = parse(dateStr, format, new Date());
                if (isValid(date)) {
                    parsedDate = date;
                    break;
                }
            }

            return {
              date: parsedDate ? parsedDate.toISOString() : 'Invalid Date',
              isValidDate: !!parsedDate,
              description: row.Details || '',
              cashIn: parseFloat(row['Cash IN']?.replace(/,/g, '')) || 0,
              cashOut: parseFloat(row['Cash OUT']?.replace(/,/g, '')) || 0,
            };
          });
          setParsedData(parsedRows);
        },
      });
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0 || !selectedEntityId) {
      toast({ title: 'Missing Information', description: 'Please upload a valid file and select a person.', variant: 'destructive'});
      return;
    }

    const selectedEntity = entities.find(e => e.id === selectedEntityId);
    if (!selectedEntity) {
      toast({ title: 'Invalid Person', description: 'The selected person could not be found.', variant: 'destructive'});
      return;
    }
    
    const invalidRows = parsedData.filter(row => !row.isValidDate || (!row.cashIn && !row.cashOut));
    if (invalidRows.length > 0) {
      toast({ title: 'Invalid Data', description: `There are ${invalidRows.length} rows with invalid dates or zero amounts. Please correct the file and re-upload.`, variant: 'destructive'});
      return;
    }

    setIsLoading(true);

    const entriesToImport: ImportableHisaabEntry[] = parsedData.map(row => ({
      entityId: selectedEntity.id,
      entityType: selectedEntity.type,
      entityName: selectedEntity.name,
      date: row.date,
      description: row.description,
      cashCredit: row.cashIn, // Cash IN for us is a credit from the customer
      cashDebit: row.cashOut, // Cash OUT from us is a debit for the customer
      goldCreditGrams: 0, // CSV doesn't support gold import
      goldDebitGrams: 0,
    }));
    
    let successCount = 0;
    let errorCount = 0;

    for (const entry of entriesToImport) {
        try {
            await addHisaabEntry(entry);
            successCount++;
        } catch(e) {
            errorCount++;
        }
    }

    setIsLoading(false);
    toast({
      title: 'Import Complete',
      description: `${successCount} transactions imported successfully. ${errorCount} failed.`,
      variant: errorCount > 0 ? 'destructive' : 'default'
    });
    setFile(null);
    setParsedData([]);
    setSelectedEntityId('');
  };

  return (
    <div className="container mx-auto p-4 space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl flex items-center">
            <Import className="mr-3 h-7 w-7 text-primary" />
            Import Hisaab Ledger
          </CardTitle>
          <CardDescription>
            Import historical transactions for a customer or karigar from a CSV file (e.g., exported from Easy Khata).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert variant="default">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Instructions & Required Format</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Your CSV file must contain the following exact column headers: <strong className="font-mono">Date, Details, Cash IN, Cash OUT</strong>.</li>
                <li>The date format should be one of `dd-MMM-yy`, `dd/MM/yyyy`, or `yyyy-MM-dd`.</li>
                <li>'Cash IN' represents money you received from the person.</li>
                <li>'Cash OUT' represents money you gave to the person.</li>
                <li>This tool does not support importing gold transactions. They must be added manually.</li>
                <li>You can only import data for one person at a time. Upload a separate file for each person.</li>
              </ul>
            </AlertDescription>
          </Alert>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            <div>
              <label htmlFor="file-upload" className="text-sm font-medium block mb-2">1. Upload CSV File</label>
              <div className="flex items-center gap-2">
                 <Button asChild variant="outline" className="relative">
                    <div>
                        <FileUp className="mr-2 h-4 w-4" />
                        {file ? 'Change File' : 'Choose File'}
                        <input id="file-upload" type="file" accept=".csv" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    </div>
                </Button>
                {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
              </div>
            </div>
            <div>
              <label htmlFor="entity-select" className="text-sm font-medium block mb-2">2. Select Person to Import For</label>
              <Select onValueChange={setSelectedEntityId} value={selectedEntityId}>
                <SelectTrigger id="entity-select">
                  <SelectValue placeholder="Select a customer or karigar..." />
                </SelectTrigger>
                <SelectContent>
                    {entities.map(e => (
                        <SelectItem key={e.id} value={e.id}>
                            <div className="flex items-center gap-2">
                                {e.type === 'customer' ? <User className="h-4 w-4 text-muted-foreground"/> : <Briefcase className="h-4 w-4 text-muted-foreground"/>}
                                {e.name}
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error Reading File</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

          {parsedData.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center"><ListChecks className="mr-2 h-5 w-5"/>Preview Data ({parsedData.length} rows)</h3>
              <ScrollArea className="h-72 border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="text-right">Cash IN</TableHead>
                      <TableHead className="text-right">Cash OUT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index} className={!row.isValidDate ? 'bg-destructive/10' : ''}>
                        <TableCell>
                          {row.isValidDate ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />}
                        </TableCell>
                        <TableCell>{row.isValidDate ? new Date(row.date).toLocaleDateString() : 'Invalid Date'}</TableCell>
                        <TableCell>{row.description}</TableCell>
                        <TableCell className="text-right">{row.cashIn.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{row.cashOut.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}

        </CardContent>
        <CardFooter>
          <Button 
            onClick={handleImport} 
            disabled={parsedData.length === 0 || !selectedEntityId || isLoading || !!error}
            size="lg"
          >
            {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Import className="mr-2 h-5 w-5" />}
            {isLoading ? `Importing ${parsedData.length} Transactions...` : `Import for ${entities.find(e => e.id === selectedEntityId)?.name || '...'}`}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
