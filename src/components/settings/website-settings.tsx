'use client';

/**
 * Settings → Integrations → "Selling on taheri.shop".
 *
 * The shop's side of the website checkout: whether it is on, how a piece is
 * priced on top of its gold, what delivery costs, and which POS category a
 * website product lands in. Bank details are shown but not edited here — they
 * come from the server's environment so nothing that can write to the
 * database can change where a customer's money goes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppStore } from '@/lib/store';
import { DEFAULT_WEBSITE_CONFIG, WEBSITE_CONFIG_DOC, type WebsiteCategoryPricing, type WebsiteConfig } from '@/lib/website/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Globe } from 'lucide-react';

/** The site's collection folders — the keys categoryPricing is written under. */
const SITE_COLLECTIONS = [
  'Rings', 'Diamond Rings', 'Bands', 'Palladium Bands for Him',
  'Bangles', 'Thin Bangles', 'Kara Churi set', 'Karay', 'Stone Bangles', 'Diamond Bangles', 'Bracelet', 'Diamond Bracelets', 'String Bracelets', 'Bangle & Ring',
  'Chains', 'Lockets', 'Contemporary Lockets', 'Takhti', 'Taweez',
  'Gold Sets', 'Diamond Sets', 'Stone Sets', 'String Set', 'Locket Set With Bangle', 'Locket sets without Bangle',
  'Tops', 'Diamond Tops', 'Jhumki', 'Baali',
];

const KARATS: WebsiteCategoryPricing['karat'][] = ['18k', '21k', '22k', '24k'];

export function WebsiteSettings() {
  const { toast } = useToast();
  const categories = useAppStore(s => s.categories);
  const [cfg, setCfg] = useState<WebsiteConfig>(DEFAULT_WEBSITE_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'app_settings', WEBSITE_CONFIG_DOC));
        if (snap.exists()) {
          const d = snap.data() as Partial<WebsiteConfig>;
          setCfg({ ...DEFAULT_WEBSITE_CONFIG, ...d, defaultPricing: { ...DEFAULT_WEBSITE_CONFIG.defaultPricing, ...(d.defaultPricing || {}) }, categoryPricing: d.categoryPricing || {} });
        }
      } catch (e) {
        // Once the database is closed again, only an owner may read this. Staff
        // opening Settings should see a plain explanation, not a blank card.
        setDenied(true);
        console.warn('[website settings] could not read app_settings/website', e);
      } finally { setLoaded(true); }
    })();
  }, []);

  const set = (patch: Partial<WebsiteConfig>) => { setCfg(c => ({ ...c, ...patch })); setDirty(true); };
  const setDefault = (patch: Partial<WebsiteCategoryPricing>) => set({ defaultPricing: { ...cfg.defaultPricing, ...patch } });
  const setCat = (name: string, patch: Partial<WebsiteCategoryPricing> | null) => {
    const next = { ...cfg.categoryPricing };
    if (patch === null) delete next[name]; else next[name] = { ...(next[name] || {}), ...patch };
    set({ categoryPricing: next });
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'app_settings', WEBSITE_CONFIG_DOC), { ...cfg, updatedAt: new Date().toISOString() });
      setDirty(false);
      toast({ title: 'Website settings saved', description: cfg.enabled ? 'The site will show prices at the next rate refresh.' : 'Selling is switched off; the site shows no prices.' });
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!cfg.posCategoryId) m.push('a POS category for website products');
    if (!(cfg.defaultPricing.makingChargesPerGram > 0)) m.push('a default making charge per gram');
    return m;
  }, [cfg]);

  const overridden = Object.keys(cfg.categoryPricing);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-xl flex items-center"><Globe className="mr-2 h-5 w-5" /> Selling on taheri.shop</CardTitle>
        <CardDescription>
          The site prices each photographed piece live — weight × today&apos;s rate for its karat, plus what you set here —
          and creates the product and the order in this book when a customer checks out. Payment is by bank transfer;
          you confirm it on the order, then book Leopards from there.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {denied && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium">These settings are owner-only.</p>
            <p className="text-muted-foreground">Pricing and the selling switch can only be read and changed by a shop owner. Nothing below will save on this account.</p>
          </div>
        )}

        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="space-y-0.5">
            <Label className="text-base">Show prices and take orders</Label>
            <p className="text-sm text-muted-foreground">
              {cfg.enabled ? 'On. The site shows prices for every piece with a readable weight.' : 'Off. The site shows no prices; every piece is enquiry-only.'}
              {missing.length > 0 && <span className="block text-amber-600 mt-1">Before this can work, set {missing.join(' and ')}.</span>}
            </p>
          </div>
          <Switch checked={cfg.enabled} onCheckedChange={v => set({ enabled: v })} disabled={!loaded} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>POS category for website products</Label>
            <Select value={cfg.posCategoryId} onValueChange={v => set({ posCategoryId: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a category" /></SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">A product is created here the moment a piece is bought — none before.</p>
          </div>
          <div className="space-y-2">
            <Label>Diamond-set pieces</Label>
            <Select value={cfg.diamondPolicy} onValueChange={v => set({ diamondPolicy: v as WebsiteConfig['diamondPolicy'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="enquire">Price on request (recommended)</SelectItem>
                <SelectItem value="gold_only">Price the gold, add a default diamond charge</SelectItem>
              </SelectContent>
            </Select>
            {cfg.diamondPolicy === 'gold_only' && (
              <Input type="number" inputMode="numeric" placeholder="Default diamond charge, Rs" value={cfg.diamondChargesDefault || ''} onChange={e => set({ diamondChargesDefault: Number(e.target.value) || 0 })} />
            )}
          </div>
        </div>

        <div>
          <Label className="text-base">Default pricing</Label>
          <p className="text-sm text-muted-foreground mb-3">Applies to every collection without its own row below.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1"><Label className="text-xs">Karat</Label>
              <Select value={cfg.defaultPricing.karat} onValueChange={v => setDefault({ karat: v as WebsiteCategoryPricing['karat'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KARATS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1"><Label className="text-xs">Wastage %</Label><Input type="number" inputMode="decimal" step="0.5" value={cfg.defaultPricing.wastagePercentage} onChange={e => setDefault({ wastagePercentage: Number(e.target.value) || 0 })} /></div>
            <div className="space-y-1"><Label className="text-xs">Making, Rs per gram</Label><Input type="number" inputMode="numeric" value={cfg.defaultPricing.makingChargesPerGram || ''} onChange={e => setDefault({ makingChargesPerGram: Number(e.target.value) || 0 })} /></div>
            <div className="space-y-1"><Label className="text-xs">Stones, Rs per piece</Label><Input type="number" inputMode="numeric" value={cfg.defaultPricing.stoneChargesDefault || ''} onChange={e => setDefault({ stoneChargesDefault: Number(e.target.value) || 0 })} /></div>
          </div>
          <div className="space-y-1 mt-3 sm:w-1/4"><Label className="text-xs">Palladium karat</Label>
            <Select value={cfg.palladiumKarat} onValueChange={v => set({ palladiumKarat: v as WebsiteConfig['palladiumKarat'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="18k">18k</SelectItem><SelectItem value="12k">12k</SelectItem></SelectContent>
            </Select></div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div><Label className="text-base">Per-collection pricing</Label><p className="text-sm text-muted-foreground">Only the fields you fill differ from the default.</p></div>
            <Select value="" onValueChange={name => setCat(name, {})}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Add a collection…" /></SelectTrigger>
              <SelectContent>{SITE_COLLECTIONS.filter(n => !overridden.includes(n)).map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {overridden.length === 0 && <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">Every collection uses the default pricing.</p>}
          <div className="space-y-2">
            {overridden.map(name => {
              const c = cfg.categoryPricing[name];
              return (
                <div key={name} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] gap-2 items-end rounded-md border p-3">
                  <div className="font-medium text-sm sm:col-span-1 col-span-1">{name}</div>
                  <div className="space-y-1 col-span-2 sm:col-span-1"><Label className="text-xs">Karat</Label>
                    <Select value={c.karat || ''} onValueChange={v => setCat(name, { karat: v as WebsiteCategoryPricing['karat'] })}>
                      <SelectTrigger><SelectValue placeholder={`default ${cfg.defaultPricing.karat}`} /></SelectTrigger>
                      <SelectContent>{KARATS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-1"><Label className="text-xs">Wastage %</Label><Input type="number" step="0.5" placeholder={String(cfg.defaultPricing.wastagePercentage)} value={c.wastagePercentage ?? ''} onChange={e => setCat(name, { wastagePercentage: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Making /g</Label><Input type="number" placeholder={String(cfg.defaultPricing.makingChargesPerGram)} value={c.makingChargesPerGram ?? ''} onChange={e => setCat(name, { makingChargesPerGram: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Stones</Label><Input type="number" placeholder={String(cfg.defaultPricing.stoneChargesDefault)} value={c.stoneChargesDefault ?? ''} onChange={e => setCat(name, { stoneChargesDefault: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                  <Button variant="ghost" size="sm" onClick={() => setCat(name, null)}>Remove</Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Delivery charge, Rs</Label><Input type="number" inputMode="numeric" value={cfg.deliveryCharge || ''} onChange={e => set({ deliveryCharge: Number(e.target.value) || 0 })} /><p className="text-xs text-muted-foreground">Leopards, anywhere in Pakistan. Booked by you after the transfer clears.</p></div>
          <div className="space-y-1"><Label>Free delivery over, Rs</Label><Input type="number" inputMode="numeric" value={cfg.freeDeliveryOver || ''} onChange={e => set({ freeDeliveryOver: Number(e.target.value) || undefined })} /></div>
        </div>

        <div className="rounded-md border p-4 text-sm space-y-1">
          <p className="font-medium">Bank account shown to customers</p>
          <p className="text-muted-foreground">Set in the hosting environment as <code>NEXT_PUBLIC_STORE_BANK_LINE</code> (&quot;Bank — Account title&quot;) and <code>NEXT_PUBLIC_STORE_IBAN</code>, not here — so nothing that can write to this database can change where the money goes.</p>
          <p className="text-muted-foreground">Leopards: <code>LEOPARDS_API_KEY</code> and <code>LEOPARDS_API_PASSWORD</code>, same place. Without them the order page takes a CN number by hand.</p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
          <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save website settings'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
