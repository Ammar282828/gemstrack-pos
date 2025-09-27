
"use client";

import React, { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, FileUp, ListChecks, Check, X, Import, Loader2, User, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import Papa from 'papaparse';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRouter } from 'next/navigation';

type ParsedRow = {
  Name: string;
  Phone: string;
  Email: string;
  Address: string;
  isValid: boolean;
};

export default function ContactImportPage() {
  const { addCustomer } = useAppStore();
  const { toast } = useToast();
  const router = useRouter();
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          
          const requiredHeaders = ['Name', 'Phone', 'Email', 'Address'];
          const actualHeaders = results.meta.fields || [];
          const missingHeaders = requiredHeaders.filter(h => !actualHeaders.includes(h));

          if (missingHeaders.length > 0) {
            setError(`Missing required columns in CSV: ${missingHeaders.join(', ')}. Please ensure your file has the correct headers.`);
            return;
          }

          const parsedRows: ParsedRow[] = results.data.map(row => ({
              Name: row.Name || '',
              Phone: row.Phone || '',
              Email: row.Email || '',
              Address: row.Address || '',
              isValid: !!(row.Name || row.Phone), // A contact is valid if it has at least a name or a phone number
          }));
          setParsedData(parsedRows);
        },
      });
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0) {
      toast({ title: 'No Data', description: 'Please upload a valid file to import.', variant: 'destructive'});
      return;
    }

    const validRows = parsedData.filter(row => row.isValid);
    if (validRows.length === 0) {
      toast({ title: 'No Valid Data', description: 'No valid contacts found in the file. Each row needs at least a Name or Phone.', variant: 'destructive'});
      return;
    }

    setIsLoading(true);

    let successCount = 0;
    let errorCount = 0;

    for (const row of validRows) {
        try {
            await addCustomer({
                name: row.Name,
                phone: row.Phone,
                email: row.Email,
                address: row.Address,
            });
            successCount++;
        } catch(e) {
            errorCount++;
        }
    }

    setIsLoading(false);
    toast({
      title: 'Import Complete',
      description: `${successCount} customers imported successfully. ${errorCount} failed.`,
      variant: errorCount > 0 ? 'destructive' : 'default'
    });
    setFile(null);
    setParsedData([]);
  };

  return (
    <div className="container mx-auto p-4 space-y-8">
       <header>
            <Button variant="outline" onClick={() => router.back()} className="mb-4">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
            </Button>
            <CardTitle className="text-2xl flex items-center">
                <User className="mr-3 h-7 w-7 text-primary" />
                Import Customers from CSV
            </CardTitle>
            <CardDescription>
                Bulk-add customers to your database from a CSV file.
            </CardDescription>
        </header>

      <Card>
        <CardHeader>
             <Alert variant="default">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Instructions & Required Format</AlertTitle>
                <AlertDescription>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                    <li>Your CSV file must contain the following exact column headers: <strong className="font-mono">Name, Phone, Email, Address</strong>.</li>
                    <li>Each row represents one customer. At least a <strong className="font-mono">Name</strong> or <strong className="font-mono">Phone</strong> is required for each customer to be considered valid.</li>
                    <li>Columns can be in any order, but the names must match exactly.</li>
                </ul>
                </AlertDescription>
            </Alert>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            <div>
              <label htmlFor="file-upload" className="text-sm font-medium block mb-2">Upload CSV File</label>
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
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index} className={!row.isValid ? 'bg-destructive/10' : ''}>
                        <TableCell>
                          {row.isValid ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />}
                        </TableCell>
                        <TableCell>{row.Name}</TableCell>
                        <TableCell>{row.Phone}</TableCell>
                        <TableCell>{row.Email}</TableCell>
                        <TableCell>{row.Address}</TableCell>
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
            disabled={parsedData.length === 0 || isLoading || !!error}
            size="lg"
          >
            {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Import className="mr-2 h-5 w-5" />}
            {isLoading ? `Importing ${parsedData.filter(r => r.isValid).length} Customers...` : `Import ${parsedData.filter(r => r.isValid).length} Valid Customers`}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

