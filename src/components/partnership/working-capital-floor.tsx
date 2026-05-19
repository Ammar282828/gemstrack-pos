"use client";

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, History, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  loadPartnershipSettings,
  saveWorkingCapitalFloor,
  isFloorStale,
  isMonthStart,
  type PartnershipSettings,
} from '@/lib/partnership-settings';

interface Props {
  /** Optional callback fired whenever the saved floor changes. */
  onFloorChange?: (value: number) => void;
  /** Identity of the person editing (display name or email). */
  setBy?: string;
}

const fmt = (n: number) => 'PKR ' + Math.round(n).toLocaleString();
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const WorkingCapitalFloor: React.FC<Props> = ({ onFloorChange, setBy }) => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<PartnershipSettings | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await loadPartnershipSettings();
      setSettings(s);
      setDraft(String(s.workingCapitalFloor));
      onFloorChange?.(s.workingCapitalFloor);
    })();
  }, [onFloorChange]);

  if (!settings) {
    return <p className="text-xs text-muted-foreground">Loading floor…</p>;
  }

  const parsedDraft = Math.max(0, Number(draft) || 0);
  const hasChange = parsedDraft !== settings.workingCapitalFloor;
  const stale = isFloorStale(settings);
  const showReviewBanner = stale && isMonthStart();

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await saveWorkingCapitalFloor(parsedDraft, setBy);
      setSettings(updated);
      onFloorChange?.(updated.workingCapitalFloor);
      toast({ title: 'Working capital floor saved', description: `${fmt(updated.workingCapitalFloor)} — recorded with timestamp.` });
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {showReviewBanner && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2.5 flex items-start gap-2 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">It&apos;s a new month — review the working-capital floor for {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}.</p>
            <p className="text-amber-700 dark:text-amber-300 mt-0.5">Last set: {fmtDate(settings.floorLastSetAt)}{settings.floorHistory[settings.floorHistory.length - 1]?.by ? ` by ${settings.floorHistory[settings.floorHistory.length - 1].by}` : ''}.</p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-sm">Working capital floor (PKR)</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            min={0}
            className={cn(hasChange && 'border-amber-400 focus-visible:ring-amber-400')}
          />
          <Button
            type="button"
            size="sm"
            variant={hasChange ? 'default' : 'outline'}
            onClick={handleSave}
            disabled={saving || !hasChange}
            className="flex-shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : hasChange ? <Save className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1 text-green-600" />}
            {saving ? '' : hasChange ? 'Save' : 'Saved'}
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Last reviewed: {fmtDate(settings.floorLastSetAt)}</span>
          <button
            type="button"
            onClick={() => setShowHistory(s => !s)}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <History className="w-3 h-3" />
            {settings.floorHistory.length} change{settings.floorHistory.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      {showHistory && settings.floorHistory.length > 0 && (
        <Card className="bg-muted/30">
          <CardContent className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
            {settings.floorHistory.slice().reverse().map((entry, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{fmtDate(entry.date)}{entry.by ? ` · ${entry.by}` : ''}</span>
                <span className="tabular-nums font-medium">{fmt(entry.value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
