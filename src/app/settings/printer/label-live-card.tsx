'use client';

/**
 * Settings → Labels → Label LIVE: set up once, then every piece's page and the Products list print to
 * Label LIVE on this Mac (lib/label-live.ts). The owner pastes the link Label LIVE's Integrate button
 * copies for the design; the design, printer and variable names come from it, and each variable is
 * paired with a piece's field (guessed by name, changeable here). Saved in the shop's settings, so every
 * Mac at the counter prints the same tag.
 */

import React, { useEffect, useState } from 'react';
import { Printer, Link2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAppStore, type Product } from '@/lib/store';
import { cleanLabelLive, configFromIntegrate, toStoredLabelLive, LABEL_FIELDS, parseIntegrateUrl, printUrl, type LabelLiveConfig } from '@/lib/label-live';
import { labelValuesFor } from '@/lib/label-live-values';
import { openLabelLive } from '@/components/label-live-button';

const NONE = '__none';

export function LabelLiveCard({ testProduct }: { testProduct: Product | null }) {
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);
  const { toast } = useToast();
  const saved = cleanLabelLive(settings.labelLive);
  const [config, setConfig] = useState<LabelLiveConfig | null>(saved);
  const [link, setLink] = useState('');
  const [newVar, setNewVar] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!config && saved) setConfig(saved); }, [saved, config]);

  const read = (text: string) => {
    setLink(text);
    if (!text.trim()) return;
    const parsed = parseIntegrateUrl(text);
    if (!parsed) { toast({ title: 'That isn’t a Label LIVE print link', description: 'In Label LIVE: open the design → Integrate → Copy URL, then paste it here.', variant: 'destructive' }); return; }
    setConfig(configFromIntegrate(parsed, config));
  };
  const save = async () => {
    if (!config) return;
    setBusy(true);
    try {
      await updateSettings({ labelLive: toStoredLabelLive(config) });
      toast({ title: 'Label LIVE is set up', description: `Tags print with “${config.design}”.` });
    } catch {
      toast({ title: 'Not saved', description: 'Check the connection and try again.', variant: 'destructive' });
    } finally { setBusy(false); }
  };
  const test = () => {
    if (!config || !testProduct) return;
    openLabelLive(printUrl({ ...config, printer: config.printer }, labelValuesFor(testProduct, settings), 1));
  };
  const setMap = (name: string, field: string) => setConfig(c => (c ? { ...c, map: { ...c.map, [name]: field === NONE ? '' : (field as LabelLiveConfig['map'][string]) } } : c));
  const changed = !saved || !config || JSON.stringify(toStoredLabelLive(config)) !== JSON.stringify(toStoredLabelLive(saved));

  return (
    <Card id="label-live">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Printer className="h-5 w-5" /> Label LIVE</CardTitle>
        <CardDescription>
          Print tags from the ERP straight into Label LIVE on this Mac. Once: in Label LIVE open your tag’s design, pin it to
          the Home screen, press <b>Integrate</b> and <b>Copy URL</b>, and paste it below. Then every piece’s page and the
          Products list have <b>Print tag (Label LIVE)</b>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ll-link" className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Link from Label LIVE’s Integrate button</Label>
          <Textarea id="ll-link" rows={3} value={link} onChange={e => read(e.target.value)} placeholder="labellive://print?design=minalabel&variables=SKU:'…',PRICE:'…'&printer=…" className="font-mono text-xs" />
        </div>

        {config && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="ll-design">Design (pinned in Label LIVE)</Label>
                <Input id="ll-design" value={config.design} onChange={e => setConfig({ ...config, design: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ll-printer">Printer id</Label>
                <Input id="ll-printer" value={config.printer} placeholder="Last used" onChange={e => setConfig({ ...config, printer: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ll-copies">Copies of each tag</Label>
                <Input id="ll-copies" type="number" min={1} max={99} value={config.copies} onChange={e => setConfig({ ...config, copies: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">What fills each part of the tag</p>
              {Object.keys(config.map).length === 0 && <p className="text-xs text-muted-foreground">The link had no variables. Add the design’s variable names below (as Label LIVE shows them, e.g. SKU).</p>}
              <ul className="space-y-1.5">
                {Object.entries(config.map).map(([name, field]) => (
                  <li key={name} className="flex items-center gap-2">
                    <code className="min-w-[7rem] rounded bg-muted px-2 py-1 text-xs">{`{${name}}`}</code>
                    <Select value={field || NONE} onValueChange={v => setMap(name, v)}>
                      <SelectTrigger className="h-9" aria-label={`Field for ${name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Leave as the design has it</SelectItem>
                        {LABEL_FIELDS.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { const m = { ...config.map }; delete m[name]; setConfig({ ...config, map: m }); }}>Remove</Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input value={newVar} onChange={e => setNewVar(e.target.value)} placeholder="Another variable name" className="h-9" />
                <Button type="button" variant="outline" size="sm" disabled={!newVar.trim()} onClick={() => { const v = newVar.trim(); setConfig({ ...config, map: { ...config.map, [v]: '' } }); setNewVar(''); }}>Add</Button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch checked={config.hideWindow} onCheckedChange={v => setConfig({ ...config, hideWindow: v })} />
              Print without bringing Label LIVE to the front
            </label>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={busy || !config.design.trim() || !changed}>{saved && !changed ? <><CheckCircle2 className="mr-2 h-4 w-4" /> Saved</> : 'Save'}</Button>
              <Button variant="outline" onClick={test} disabled={!testProduct}>
                <Printer className="mr-2 h-4 w-4" /> {testProduct ? `Test with ${testProduct.sku}` : 'Choose a piece below to test'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The first time, the browser asks to open Label LIVE: allow it (and tick “always”). Label LIVE has to be open, and the
              design pinned to its Home screen — a design found by an old path (moved to iCloud) won’t print. Several pieces go as one batch.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
