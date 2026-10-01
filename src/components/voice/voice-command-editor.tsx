"use client";

/**
 * One command step on the card (lib/voice/steps.ts): each value as heard, what it was read as,
 * and the choices when it could be more than one thing. Any value can be retyped; a choice pins
 * it. Built from the command's own arg list, so every command in commands.ts is editable here
 * without a screen of its own.
 */

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArgSpec } from '@/lib/voice/args';
import { addPiece, pickArg, removePiece, setArg, type ArgView, type Step, type StepView } from '@/lib/voice/steps';

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const ENTITY = new Set(['customer', 'karigar', 'person', 'order', 'invoice', 'repair', 'product', 'given', 'job', 'expense', 'income', 'screen']);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2 text-sm">
      <span className="pt-2.5 text-muted-foreground">{label}</span>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function Control({ a, onSet }: { a: ArgView; onSet: (raw: string) => void }) {
  const t = a.spec.type;
  if (t === 'enum') {
    const value = a.r?.ok ? String(a.r.value) : '';
    return (
      <select className={selectClass} value={value} onChange={e => onSet(e.target.value)}>
        {!value && <option value="">Choose…</option>}
        {(a.spec.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (t === 'bool') {
    const value = a.r?.ok ? (a.r.value ? 'on' : 'off') : '';
    return (
      <select className={selectClass} value={value} onChange={e => onSet(e.target.value)}>
        {!value && <option value="">Choose…</option>}
        <option value="on">On</option><option value="off">Off</option>
      </select>
    );
  }
  if (t === 'karat') {
    const value = a.r?.ok ? String(a.r.value) : '';
    return (
      <select className={selectClass} value={value} onChange={e => onSet(e.target.value)}>
        <option value="">—</option>
        {['24k', '22k', '21k', '18k', '12k'].map(k => <option key={k} value={k}>{k}</option>)}
      </select>
    );
  }
  if (t === 'date') {
    return <Input type="date" value={a.r?.ok ? String(a.r.value) : ''} onChange={e => onSet(e.target.value)} />;
  }
  const numeric = t === 'money' || t === 'number' || t === 'grams';
  return (
    <Input
      value={a.raw} onChange={e => onSet(e.target.value)}
      inputMode={numeric ? 'decimal' : t === 'phone' ? 'tel' : undefined}
      placeholder={ENTITY.has(t) ? 'Type a name, a number…' : undefined}
    />
  );
}

/** What a value was read as, or why it could not be, with the choices. */
function Reading({ a, onPick }: { a: ArgView; onPick: (i: number) => void }) {
  if (!a.r) return null;
  if (a.r.ok) {
    const shows = ENTITY.has(a.spec.type) || a.r.ref;
    return shows && a.r.label !== a.raw ? <p className="text-xs text-muted-foreground">→ {a.r.label}</p> : null;
  }
  const r = a.r;
  return (
    <div className="space-y-1">
      <p className="text-xs text-destructive">{r.reason}</p>
      {r.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.candidates.map((c, i) => (
            <Button key={c.key} type="button" size="sm" variant="outline" className="h-auto max-w-full py-1 text-left" onClick={() => onPick(i)}>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{c.label}</span>
                {c.detail && <span className="block truncate text-[11px] text-muted-foreground">{c.detail}</span>}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function VoiceCommandEditor({ step, view, onChange }: { step: Step; view: StepView; onChange: (s: Step) => void }) {
  const [shown, setShown] = useState<string[]>([]);
  if (step.kind !== 'command' || !view.def) return null;
  const set = (key: string, raw: string) => onChange(setArg(step, key, raw));
  const pick = (a: ArgView, i: number) => { if (a.r && !a.r.ok) onChange(pickArg(step, a.key, a.r.candidates[i])); };
  // What was said or is needed is shown; the rest can be added.
  const visible = view.args.filter(a => a.spec.required || a.raw || step.pins[a.key] || shown.includes(a.key));
  const more = view.args.filter(a => !visible.includes(a));
  const row = (a: ArgView, key = a.key) => (
    <Row key={key} label={a.spec.label}>
      <Control a={a} onSet={raw => set(a.key, raw)} />
      <Reading a={a} onPick={i => pick(a, i)} />
    </Row>
  );
  const pieceSpec = view.def.pieces;

  return (
    <div className="space-y-2.5">
      {visible.map(a => row(a))}

      {pieceSpec && (
        <div className="space-y-2">
          {view.pieces.map((p, i) => (
            <div key={i} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{pieceSpec.start.label} {i + 1}</span>
                <button type="button" aria-label={`Remove ${pieceSpec.start.label.toLowerCase()} ${i + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => onChange(removePiece(step, i))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              {p.filter((a, n) => n === 0 || a.raw || step.pins[a.key] || shown.includes(a.key)).map(a => row(a))}
              <PieceMore fields={p.filter((a, n) => n > 0 && !a.raw && !step.pins[a.key] && !shown.includes(a.key)).map(a => a.spec)} onAdd={name => setShown(s => [...s, `piece.${i}.${name}`])} />
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(addPiece(step))}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add a {pieceSpec.start.label.toLowerCase()}
          </Button>
        </div>
      )}

      {more.length > 0 && (
        <Row label="">
          <select className={cn(selectClass, 'text-muted-foreground')} value="" onChange={e => e.target.value && setShown(s => [...s, e.target.value])}>
            <option value="">Add a detail…</option>
            {more.map(a => <option key={a.key} value={a.key}>{a.spec.label}</option>)}
          </select>
        </Row>
      )}
    </div>
  );
}

function PieceMore({ fields, onAdd }: { fields: ArgSpec[]; onAdd: (name: string) => void }) {
  if (!fields.length) return null;
  return (
    <select className={cn(selectClass, 'h-8 text-xs text-muted-foreground')} value="" onChange={e => e.target.value && onAdd(e.target.value)}>
      <option value="">Add to this piece…</option>
      {fields.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
    </select>
  );
}
