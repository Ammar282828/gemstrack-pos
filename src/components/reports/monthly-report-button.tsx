'use client';

/**
 * Analytics' "Monthly PDF": any month's report (lib/reports), drawn by the server — the same
 * document the 1st-of-the-month WhatsApp report carries, so the two never differ.
 */

import React, { useMemo, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { auth as firebaseAuth } from '@/lib/firebase';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { addMonths, karachiMonth, monthKey, monthLabel } from '@/lib/reports/monthly';

/** savePDF takes a jsPDF; a PDF that arrived as bytes answers the two calls it makes. */
const blobDoc = (blob: Blob) => ({
  output: (type: string) => (type === 'blob' ? blob : URL.createObjectURL(blob)),
  save: (name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  },
});

export function MonthlyReportButton() {
  const { toast } = useToast();
  const months = useMemo(() => {
    const now = karachiMonth(new Date());
    return Array.from({ length: 24 }, (_, i) => addMonths(now, -i));
  }, []);
  // Last month by default: it is the one that is finished.
  const [key, setKey] = useState(() => monthKey(months[1]));
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    const iOSWin = openPDFWindowForIOS();
    try {
      let token = '';
      try { token = (await firebaseAuth?.currentUser?.getIdToken()) || ''; } catch { /* signed out */ }
      const res = await fetch(`/api/reports/monthly?month=${key}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `monthly-report-${key}.pdf`;
      await savePDF(blobDoc(blob), name, iOSWin, { title: name });
    } catch (e) {
      iOSWin?.close();
      toast({ title: 'Could not make the report', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={key} onValueChange={setKey} recentsKey={false}>
        <SelectTrigger className="h-9 w-[10.5rem] text-sm" aria-label="Month for the report">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((m, i) => (
            <SelectItem key={monthKey(m)} value={monthKey(m)}>{monthLabel(m)}{i === 0 ? ' (so far)' : ''}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" className="h-9" onClick={download} disabled={busy} title="Every sale of the month, with its figures, as a PDF">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        <span className="ml-1.5">Monthly PDF</span>
      </Button>
    </div>
  );
}
