'use client';

/**
 * QR codes (designer v2): add one for the shop's WhatsApp chat, website, Instagram, shop or any text; and the
 * controls of a QR on the page (its words, its two colours, its quiet zone, a warning when it is too small to
 * scan). The links come from the house's own settings (STORE_LINKS, STORE_WHATSAPP_NUMBERS), never typed in.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { QrCode } from 'lucide-react';
import { newQr, type QrLayer } from '@/lib/social/editor';
import { qrFor } from '@/lib/social/qr';
import { QR_MIN } from '@/lib/design/safe';
import { STORE_LINKS, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import type { Editor } from '../story-editor';
import { ColourRow, Num, Row, Section, docColours } from './kit';

/** A wa.me link for a phone number as the shop prints it ("+92 335 2275553", or a local "0335…" Pakistani number). */
export function waLink(number: string): string {
  let d = number.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `92${d.slice(1)}`;
  return d ? `https://wa.me/${d}` : '';
}

/** The links this house can put in a QR code, each only if the house has it. */
export function qrSources(): { id: string; label: string; value: string }[] {
  const wa = STORE_LINKS.whatsapp || (STORE_WHATSAPP_NUMBERS[0] ? waLink(STORE_WHATSAPP_NUMBERS[0]) : '');
  return [
    { id: 'whatsapp', label: 'WhatsApp chat', value: wa },
    { id: 'website', label: 'Website', value: STORE_LINKS.website },
    { id: 'shop', label: 'Online shop', value: STORE_LINKS.shop },
    { id: 'instagram', label: 'Instagram', value: STORE_LINKS.instagram },
    { id: 'links', label: 'Link page', value: STORE_LINKS.url },
    { id: 'review', label: 'Google review', value: STORE_LINKS.googleReview },
  ].filter(s => s.value);
}

/** Elements → QR code: one button per link the house has, and any text. */
export function QrSection({ ed }: { ed: Editor }) {
  const [custom, setCustom] = useState('');
  const add = (value: string) => ed.add(newQr(value, '#111111', ed.F));
  const sources = qrSources();
  const problem = custom.trim() && !qrFor(custom.trim()) ? 'That is too long for a QR code here.' : null;
  return (
    <Section title="QR code">
      <div className="grid grid-cols-2 gap-2">
        {sources.map(s => <Button key={s.id} variant="outline" size="sm" className="justify-start" onClick={() => add(s.value)}><QrCode className="mr-1.5 h-4 w-4" /> {s.label}</Button>)}
      </div>
      {sources.length === 0 && <p className="text-[11px] text-muted-foreground">This ERP has no shop links set yet; type one below.</p>}
      <div className="flex gap-2">
        <Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Any link or words" className="text-base md:text-sm" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && custom.trim() && !problem) { add(custom.trim()); setCustom(''); } }} />
        <Button size="sm" className="h-11 md:h-9" disabled={!custom.trim() || !!problem} onClick={() => { add(custom.trim()); setCustom(''); }}>Add</Button>
      </div>
      {problem && <p className="text-[11px] text-destructive">{problem}</p>}
    </Section>
  );
}

/** A QR code on the page: what it says, its colours, its size. */
export function QrControls({ ed, l }: { ed: Editor; l: QrLayer }) {
  const set = (patch: Partial<QrLayer>, key?: string) => ed.update(l.id, patch, key);
  const [value, setValue] = useState(l.value);
  const [seen, setSeen] = useState(l.id);
  if (seen !== l.id) { setSeen(l.id); setValue(l.value); }   // another QR selected: start from its words
  const ok = !!qrFor(l.value);
  const px = l.w;
  const doc = docColours(ed);
  return (
    <div className="space-y-2.5">
      <Row label="Says">
        <Input value={value} onChange={e => { setValue(e.target.value); set({ value: e.target.value }, 'qrvalue'); }} className="text-base md:text-sm" onKeyDown={e => e.stopPropagation()} />
      </Row>
      {!ok && <p className="text-[11px] text-destructive">{l.value.trim() ? 'That is too long to fit in a QR code here, so nothing is drawn.' : 'Nothing to encode yet, so nothing is drawn.'}</p>}
      <div className="flex flex-wrap gap-1.5">
        {qrSources().map(s => <button key={s.id} type="button" onClick={() => { setValue(s.value); set({ value: s.value }); }} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted">{s.label}</button>)}
      </div>
      <Row label="Size"><Num value={px} min={QR_MIN} max={1000} step={4} onChange={v => set({ w: v }, 'qrw')} /></Row>
      {px < QR_MIN + 40 && <p className="text-[11px] text-amber-600">Small codes are hard to scan from a phone screen; {QR_MIN + 40} px or more is safer.</p>}
      <Row label="Dark parts"><ColourRow value={l.fg} onChange={c => set({ fg: c }, 'qrfg')} extra={doc} /></Row>
      <label className="flex items-center gap-1.5 text-xs"><Switch checked={!!l.bg} onCheckedChange={v => set({ bg: v ? '#FFFFFF' : null })} /> Light square behind it</label>
      {l.bg && <Row label="Behind"><ColourRow value={l.bg} onChange={c => set({ bg: c }, 'qrbg')} extra={doc} /></Row>}
      <Row label="Quiet edge"><Num value={l.quiet} min={0} max={8} onChange={v => set({ quiet: v }, 'qrq')} /></Row>
      <p className="text-[11px] text-muted-foreground">Keep a light border round the code (4 modules is the standard) and a strong contrast between dark and light so every phone reads it.</p>
    </div>
  );
}
