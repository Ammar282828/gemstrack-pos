"use client";

/**
 * The confirmation card's edit controls: everything a spoken entry carries, changeable before
 * it is written (lib/voice/edit.ts). Each control sends one Edit; the reading is built again
 * from it, so the card always shows what would actually be written.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { rankNames, type LearnedAlias, type RankedName, type RosterEntry } from '@/lib/voice/phonetics';
import { ORDER_STATUS_WORDS, PAYMENT_METHOD_WORDS, type DocEntry } from '@/lib/voice/documents';
import type { Reading } from '@/lib/voice/resolve';
import { docKindFor, editableFor, WRITE_ACTIONS, type Edit } from '@/lib/voice/edit';

const FIELD_LABEL: Record<string, string> = {
  name: 'Name', phone: 'Phone', contact: 'Phone', altPhone: 'Other phone', email: 'Email', city: 'City', address: 'Address',
  country: 'Country', ringSize: 'Ring size', bangleSize: 'Bangle size', braceletSize: 'Bracelet size', chainLength: 'Chain length',
  birthday: 'Birthday', anniversary: 'Anniversary', preference: 'Likes', notes: 'Notes', specialty: 'Makes', workshop: 'Workshop',
};

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A number typed as text, so "5,0" on the way to "5,000" is not thrown away; blank is none. */
function NumberBox({ value, onChange, suffix, placeholder }: { value: number | null; onChange: (n: number | null) => void; suffix?: string; placeholder?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  // Follow a change made elsewhere (a re-read), not the one being typed.
  useEffect(() => {
    const typed = parseFloat(text.replace(/,/g, ''));
    if ((value ?? null) !== (Number.isFinite(typed) ? typed : null)) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <Input
        inputMode="decimal" value={text} placeholder={placeholder}
        onChange={e => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          const n = parseFloat(t.replace(/,/g, ''));
          onChange(Number.isFinite(n) ? n : null);
        }}
        className={cn(suffix && 'pr-10')}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function PersonPicker({ reading, roster, aliases, want, onPick }: {
  reading: Reading; roster: RosterEntry[]; aliases: Map<string, LearnedAlias>;
  want: 'customer' | 'karigar' | 'any'; onPick: (p: RankedName) => void;
}) {
  const [open, setOpen] = useState(!reading.person && !reading.ambiguous);
  const [q, setQ] = useState('');
  const pool = useMemo(() => (want === 'any' ? roster : roster.filter(r => r.kind === want)), [roster, want]);
  const hits = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    const lower = s.toLowerCase();
    // What is typed is matched by letters first, then by sound, so a spelling and a sound both find her.
    const typed = pool.filter(r => r.name.toLowerCase().includes(lower)).slice(0, 6).map(r => ({ ...r, score: 1, via: 'exact' as const }));
    const sounded = rankNames(s, pool, aliases).filter(r => r.score > 0.45 && !typed.some(t => t.id === r.id && t.kind === r.kind));
    return [...typed, ...sounded].slice(0, 6);
  }, [q, pool, aliases]);

  if (!open && reading.person) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-medium">{reading.person.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{reading.person.kind === 'customer' ? 'Customer' : 'Karigar'}
            {reading.person.via === 'phonetic' && ', matched by sound'}
            {reading.person.via === 'learned' && ', as you corrected before'}</span>
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Input autoFocus={!!reading.person} value={q} onChange={e => setQ(e.target.value)} placeholder={want === 'karigar' ? 'Type a karigar’s name' : want === 'customer' ? 'Type a customer’s name' : 'Type a name'} />
      {hits.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md border">
          {hits.map(h => (
            <button
              key={`${h.kind}-${h.id}`} type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => { onPick(h); setOpen(false); setQ(''); }}
            >
              <span className="truncate">{h.name}</span>
              <span className="text-xs text-muted-foreground">{h.kind === 'customer' ? 'Customer' : 'Karigar'}</span>
            </button>
          ))}
        </div>
      )}
      {reading.person && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(false)}>Keep {reading.person.name}</button>}
    </div>
  );
}

export function VoiceEditor({ reading, roster, aliases, documents, onEdit }: {
  reading: Reading;
  roster: RosterEntry[];
  aliases: Map<string, LearnedAlias>;
  documents: DocEntry[];
  onEdit: (e: Edit) => void;
}) {
  const can = editableFor(reading.action);
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const docKind = docKindFor(reading.action);
  const docChoices = useMemo(() => {
    if (!docKind) return [];
    const p = reading.person;
    const ofKind = documents.filter(d => d.kind === docKind && d.open);
    const theirs = p ? ofKind.filter(d => d.customerId === p.id || d.customerName.toLowerCase() === p.name.toLowerCase()) : ofKind;
    const list = theirs.length ? theirs : ofKind;
    return reading.doc && !list.some(d => d.id === reading.doc!.id) ? [reading.doc, ...list] : list;
  }, [docKind, documents, reading.person, reading.doc]);

  const fieldKeys = can.fields
    ? [...new Set([...(reading.action.startsWith('new_') ? ['name'] : []), ...Object.keys(reading.fields ?? {}), ...extraKeys])]
        .filter(k => can.fields!.includes(k))
    : [];
  const moreKeys = can.fields ? can.fields.filter(k => !fieldKeys.includes(k)) : [];

  return (
    <div className="space-y-2.5 rounded-md border p-3">
      <Row label="What">
        <select className={selectClass} value={WRITE_ACTIONS.some(a => a.action === reading.action) ? reading.action : ''}
          onChange={e => e.target.value && onEdit({ kind: 'action', action: e.target.value as Reading['action'] })}>
          {!WRITE_ACTIONS.some(a => a.action === reading.action) && <option value="">Choose what this is…</option>}
          {WRITE_ACTIONS.map(a => <option key={a.action} value={a.action}>{a.label}</option>)}
        </select>
      </Row>

      {can.person && (
        <Row label={can.person === 'karigar' ? 'Karigar' : can.person === 'customer' ? 'Customer' : 'Who'}>
          <PersonPicker reading={reading} roster={roster} aliases={aliases} want={can.person} onPick={p => onEdit({ kind: 'person', person: p })} />
        </Row>
      )}

      {can.doc && (
        <Row label={can.doc === 'order' ? 'Order' : 'Invoice'}>
          {docChoices.length ? (
            <select className={selectClass} value={reading.doc?.id ?? ''}
              onChange={e => { const d = docChoices.find(x => x.id === e.target.value); if (d) onEdit({ kind: 'doc', doc: d }); }}>
              {!reading.doc && <option value="">Choose…</option>}
              {docChoices.map(d => <option key={d.id} value={d.id}>{d.id} · {d.customerName} · {d.label}</option>)}
            </select>
          ) : <span className="text-muted-foreground">No open {can.doc} {reading.person ? `for ${reading.person.name}` : 'in the book'}.</span>}
        </Row>
      )}

      {can.amount && <Row label="Amount"><NumberBox value={reading.amount} onChange={n => onEdit({ kind: 'amount', value: n })} suffix="Rs" placeholder="0" /></Row>}

      {can.grams && (
        <>
          <Row label="Weight"><NumberBox value={reading.grams} onChange={n => onEdit({ kind: 'grams', value: n })} suffix="g" /></Row>
          <Row label="Karat"><NumberBox value={reading.karat} onChange={n => onEdit({ kind: 'karat', value: n })} suffix="k" /></Row>
        </>
      )}

      {can.method && (
        <Row label="Paid by">
          <select className={selectClass} value={reading.method ?? 'Cash'} onChange={e => onEdit({ kind: 'field', key: 'method', value: e.target.value })}>
            {PAYMENT_METHOD_WORDS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Row>
      )}

      {can.status && (
        <Row label="Status">
          <select className={selectClass} value={reading.status ?? ''} onChange={e => onEdit({ kind: 'field', key: 'status', value: e.target.value })}>
            {!reading.status && <option value="">Choose…</option>}
            {ORDER_STATUS_WORDS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
      )}

      {can.date && (
        <Row label="Promised">
          <Input type="date" value={reading.date ?? ''} onChange={e => onEdit({ kind: 'field', key: 'date', value: e.target.value })} />
        </Row>
      )}

      {can.note && (
        <Row label="Note">
          <Input value={reading.description} onChange={e => onEdit({ kind: 'description', value: e.target.value })} placeholder="What it was for" />
        </Row>
      )}

      {fieldKeys.map(k => (
        <Row key={k} label={FIELD_LABEL[k] ?? k}>
          <Input value={reading.fields?.[k] ?? ''} onChange={e => onEdit({ kind: 'field', key: k, value: e.target.value })}
            inputMode={/phone|contact/i.test(k) ? 'tel' : undefined} />
        </Row>
      ))}
      {moreKeys.length > 0 && (
        <Row label="">
          <select className={cn(selectClass, 'text-muted-foreground')} value="" onChange={e => e.target.value && setExtraKeys(x => [...x, e.target.value])}>
            <option value="">Add a detail…</option>
            {moreKeys.map(k => <option key={k} value={k}>{FIELD_LABEL[k] ?? k}</option>)}
          </select>
        </Row>
      )}
    </div>
  );
}
