'use client';

/**
 * The shop's rate, on every page (the audit of 2026-10-01: "the one daily action is buried" —
 * the rates sat in Settings → Rates, behind the Shop tab).
 *
 *   RateChip         the top bar's `21K 26,250 · 9:40 Ammar`; amber when it wasn't set today (Karachi)
 *   RateSheet        the full rate form and the gold.pk button, opened by the chip or openRateSheet()
 *   RatesForm        that form, also used where a page wants it inline
 *   RateStaleNotice  one line in the cart when the rate is not from today — it never blocks a sale
 *
 * Saving goes through updateSettings, which stamps ratesUpdatedAt/By and logs `rates.update`
 * (lib/rates.ts, store.ts); only the rates that moved are written.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2, Save, TriangleAlert } from 'lucide-react';
import { useAppStore, type Settings } from '@/lib/store';
import { STORE_CONFIG } from '@/lib/store-config';
import { mainRate, ratesSetToday, whenSet, RATE_KEYS, type RateKey } from '@/lib/rates';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { AmountInput } from '@/components/ui/amount-input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const OPEN_EVENT = 'rate-sheet:open';
/** Open the rate sheet from anywhere (the chip, the cart's notice, /settings?tab=rates). */
export function openRateSheet(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}

const MAIN = mainRate(STORE_CONFIG.defaultMetal);
const pkr = (n: number | undefined) => (n ? Math.round(n).toLocaleString('en-PK') : '—');

/** The rate groups, the house's own metal first: a silver house files silver under Silver, not "Other metals". */
function groups(): { title: string; fields: { key: RateKey; label: string }[]; note?: string }[] {
  const gold = { title: 'Gold', fields: [
    { key: 'goldRatePerGram24k' as const, label: '24K' }, { key: 'goldRatePerGram22k' as const, label: '22K' },
    { key: 'goldRatePerGram21k' as const, label: '21K' }, { key: 'goldRatePerGram18k' as const, label: '18K' },
  ] };
  const palladium = { title: 'Palladium', fields: [
    { key: 'palladiumRatePerGram18k' as const, label: '18K' }, { key: 'palladiumRatePerGram12k' as const, label: '12K' },
    { key: 'palladiumRatePerGram' as const, label: 'Flat' },
  ], note: 'Left at zero, 18K and 12K palladium are priced from the flat rate.' };
  if (STORE_CONFIG.defaultMetal === 'silver') {
    return [{ title: 'Silver', fields: [{ key: 'silverRatePerGram', label: 'Per gram' }] }, gold, palladium,
      { title: 'Other metals', fields: [{ key: 'platinumRatePerGram', label: 'Platinum' }] }];
  }
  return [gold, palladium, { title: 'Other metals', fields: [
    { key: 'silverRatePerGram', label: 'Silver' }, { key: 'platinumRatePerGram', label: 'Platinum' },
  ] }];
}

/** The full rate form. Writes only what changed; the store stamps when and who. */
export function RatesForm({ onSaved }: { onSaved?: () => void }) {
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);
  const { toast } = useToast();
  const [values, setValues] = useState<Partial<Record<RateKey, number | undefined>>>({});
  const [fromGoldPk, setFromGoldPk] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  // Start from the stored rates; again whenever they move and nothing is being typed.
  const stored = useMemo(() => Object.fromEntries(RATE_KEYS.map(k => [k, (settings[k] as number) || 0])) as Record<RateKey, number>, [settings]);
  const changed = RATE_KEYS.filter(k => values[k] !== undefined && Math.abs((values[k] ?? 0) - stored[k]) >= 0.005);
  useEffect(() => { if (!changed.length) setValues({}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stored]);

  const shown = (k: RateKey) => (values[k] !== undefined ? values[k] : stored[k]);

  const fetchGoldPk = async () => {
    setFetching(true);
    try {
      const res = await fetch('/api/gold-rates');
      if (!res.ok) throw new Error();
      const d = await res.json() as Partial<Settings>;
      setValues(v => ({ ...v, goldRatePerGram24k: d.goldRatePerGram24k, goldRatePerGram22k: d.goldRatePerGram22k, goldRatePerGram21k: d.goldRatePerGram21k, goldRatePerGram18k: d.goldRatePerGram18k }));
      setFromGoldPk(true);
      toast({ title: 'gold.pk’s rates filled in', description: `21K ${pkr(d.goldRatePerGram21k)}/g. Check them, then save.` });
    } catch {
      toast({ title: 'gold.pk did not answer', description: 'Type the rate in instead.', variant: 'destructive' });
    } finally { setFetching(false); }
  };

  const confirmRates = useAppStore(s => s.confirmRates);
  // Nothing moved since the last setting: one tap says so, and the website keeps selling (36-hour rule).
  const confirmSame = async () => {
    setSaving(true);
    try {
      await confirmRates();
      toast({ title: 'Rate confirmed', description: `${MAIN.label} ${pkr(stored[MAIN.key])} is today's rate — new sales and the website.` });
      onSaved?.();
    } catch (e) {
      toast({ title: 'Not confirmed', description: e instanceof Error ? e.message : 'Check the connection and try again.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const save = async () => {
    if (!changed.length) return;
    setSaving(true);
    try {
      await updateSettings(Object.fromEntries(changed.map(k => [k, values[k] ?? 0])) as Partial<Settings>, { source: fromGoldPk ? 'gold.pk' : 'the rate form' });
      toast({ title: 'Rate saved', description: `${MAIN.label} ${pkr((values[MAIN.key] ?? stored[MAIN.key]))} from now on — new sales and the website.` });
      setValues({}); setFromGoldPk(false);
      onSaved?.();
    } catch {
      toast({ title: 'Rate not saved', description: 'Check the connection and try again.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">PKR per gram. {settings.ratesUpdatedAt ? `Set ${whenSet(settings.ratesUpdatedAt)}${settings.ratesUpdatedBy ? ` by ${settings.ratesUpdatedBy}` : ''}.` : ''}</p>
        <Button type="button" variant="outline" size="sm" onClick={fetchGoldPk} disabled={fetching}>
          {fetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
          Fill gold from gold.pk
        </Button>
      </div>
      {groups().map(g => (
        <div key={g.title} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{g.title}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {g.fields.map(f => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`rate-${f.key}`} className={cn('text-sm font-normal', f.key === MAIN.key ? 'text-foreground font-medium' : 'text-muted-foreground')}>{f.label}</Label>
                <AmountInput id={`rate-${f.key}`} value={shown(f.key)} emptyValue={undefined}
                  onValueChange={n => setValues(v => ({ ...v, [f.key]: n ?? 0 }))} aria-label={`${g.title} ${f.label} per gram`} />
              </div>
            ))}
          </div>
          {g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
        </div>
      ))}
      <div className="flex items-center justify-end gap-2">
        {changed.length > 0 && <Button type="button" variant="ghost" onClick={() => { setValues({}); setFromGoldPk(false); }} disabled={saving}>Discard</Button>}
        {changed.length > 0 ? (
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save {changed.length > 1 ? `${changed.length} rates` : 'rate'}
          </Button>
        ) : (
          <Button type="button" onClick={confirmSame} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Same today — confirm {MAIN.label} {pkr(stored[MAIN.key])}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The sheet the chip opens. Mounted once, in the app shell. */
export function RateSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="glass-window w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Today’s rate</SheetTitle>
          <SheetDescription>Every new sale starts from these, and the website quotes at them.</SheetDescription>
        </SheetHeader>
        <RatesForm onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/** Re-render once a minute, so "today" turns amber at midnight on a page left open. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  return now;
}

/** `21K 26,250 · 9:40 Ammar` in the top bar; amber when not set today. */
export function RateChip() {
  const settings = useAppStore(s => s.settings);
  const now = useMinute();
  const rate = settings[MAIN.key] as number | undefined;
  const today = ratesSetToday(settings.ratesUpdatedAt, now);
  const when = whenSet(settings.ratesUpdatedAt, now);
  return (
    <button
      type="button"
      onClick={openRateSheet}
      data-stale={today ? undefined : ''}
      title={today ? 'Today’s rate — tap to change' : 'Not set today — tap to set today’s rate'}
      className={cn(
        // Not glass-ctl: Liquid Glass draws that as a round icon control of fixed size.
        'rate-chip mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 min-h-0 h-8 text-xs tabular-nums whitespace-nowrap transition-colors',
        today ? 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
          : 'border-warning/50 bg-warning/10 text-warning hover:bg-warning/20',
      )}
    >
      {!today && <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="font-medium text-foreground/90">{MAIN.label}</span>
      <span className={cn(!today && 'text-warning')}>{pkr(rate)}</span>
      {/* A phone's top bar has room for the rate alone; the time and who set it from sm up. */}
      <span aria-hidden className="hidden sm:inline text-muted-foreground/60">·</span>
      <span className="hidden sm:inline">{settings.ratesUpdatedAt ? when : 'not set today'}</span>
      {settings.ratesUpdatedBy && <span className="hidden md:inline">{settings.ratesUpdatedBy}</span>}
    </button>
  );
}

/** One line in the cart when the shop's rate was not set today. Never blocks the sale. */
export function RateStaleNotice() {
  const settings = useAppStore(s => s.settings);
  const now = useMinute();
  if (ratesSetToday(settings.ratesUpdatedAt, now)) return null;
  return (
    <button type="button" onClick={openRateSheet}
      className="flex w-full items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-left text-xs text-warning hover:bg-warning/15">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>The rate was not set today ({MAIN.label} {pkr(settings[MAIN.key] as number)} · {whenSet(settings.ratesUpdatedAt, now)}). Tap to set it — or carry on.</span>
    </button>
  );
}
