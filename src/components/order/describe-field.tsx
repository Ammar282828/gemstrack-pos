"use client";

/**
 * A piece's description, semi-automatic (owner, 2026-11-03): suggestions from what pieces have been called
 * before (this category's first) and from the owner's saved stone combinations written with the category
 * ("Ruby & diamond" + ring → "Ruby & diamond ring"); View all opens the whole history, searchable; Add stone
 * combo saves a new one. Typing stays instant: the lists are read once and filtered on the device.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, History } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { staticCategories, categorySingular } from '@/lib/categories';
import { loadDescribe, saveStoneCombos, type DescribeData } from '@/lib/describe-client';
import { cleanText, composeCombo, suggest } from '@/lib/describe';

const EMPTY: DescribeData = { history: [], combos: [] };

export function useDescribeData(): [DescribeData, (combos: string[]) => void] {
  const [data, setData] = useState<DescribeData>(EMPTY);
  useEffect(() => {
    let live = true;
    void loadDescribe().then(d => { if (live) setData(d); });
    return () => { live = false; };
  }, []);
  return [data, combos => setData(d => ({ ...d, combos }))];
}

/** The category's word for a description: "ring" for Rings, nothing when there is no category. */
export const categoryWord = (category: string | undefined) => (categorySingular(category) || '').toLowerCase();

export function DescribeField({ value, onChange, category, textareaProps }: {
  value: string;
  onChange: (v: string) => void;
  category?: string;
  textareaProps?: Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange'>;
}) {
  const { toast } = useToast();
  const [data, setCombos] = useDescribeData();
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState(value);
  const [viewAll, setViewAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const word = categoryWord(category);

  // Suggestions follow the words after a short pause, so typing is never held up by filtering.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTyped(value), 120);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const options = useMemo(
    () => (focused ? suggest(typed, data.history, data.combos, category || '', word, 8) : []),
    [focused, typed, data, category, word],
  );

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Textarea
          {...textareaProps}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // A tap on a suggestion must land before the list goes.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          rows={textareaProps?.rows ?? 2}
        />
        {options.length > 0 && (
          <ul className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-xl border bg-popover text-popover-foreground shadow-md p-1" role="listbox">
            {options.map(o => (
              <li key={o}>
                <button type="button" role="option" aria-selected="false"
                  className="w-full text-left rounded-lg px-3 py-1.5 text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(o); setFocused(false); }}>
                  {o}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setViewAll(true)}>
          <History className="h-3 w-3" /> View all
        </button>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3" /> Add stone combo
        </button>
      </div>
      <DescribeHistoryDialog open={viewAll} onOpenChange={setViewAll} data={data} category={category || ''} onPick={t => { onChange(t); setViewAll(false); }} />
      <AddComboDialog open={adding} onOpenChange={setAdding} word={word} combos={data.combos}
        onSaved={(combos, combo) => { setCombos(combos); onChange(composeCombo(combo, word)); toast({ title: 'Stone combo saved', description: combo }); }} />
    </div>
  );
}

function DescribeHistoryDialog({ open, onOpenChange, data, category, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; data: DescribeData; category: string; onPick: (t: string) => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  useEffect(() => { if (open) { setQ(''); setCat(category); } }, [open, category]);
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.history.filter(h => (!cat || h.category === cat) && words.every(w => h.text.toLowerCase().includes(w))).slice(0, 300);
  }, [data, q, cat]);
  const present = useMemo(() => new Set(data.history.map(h => h.category)), [data]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Descriptions used before</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!cat} onClick={() => setCat('')}>All</Chip>
          {staticCategories.filter(c => present.has(c.id)).map(c => (
            <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.title}</Chip>
          ))}
        </div>
        <div className="max-h-[50vh] overflow-auto -mx-1">
          {rows.length === 0 && <p className="text-sm text-muted-foreground px-1 py-4">Nothing matches.</p>}
          {rows.map(h => (
            <button key={`${h.category}|${h.text}`} type="button" className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-accent flex items-baseline justify-between gap-3" onClick={() => onPick(h.text)}>
              <span className="text-sm">{h.text}</span>
              <span className="text-xs text-muted-foreground shrink-0">{h.count}×</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
      {children}
    </button>
  );
}

function AddComboDialog({ open, onOpenChange, word, combos, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; word: string; combos: string[]; onSaved: (all: string[], combo: string) => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(''); }, [open]);
  const save = async () => {
    const combo = cleanText(text);
    if (!combo) return;
    setBusy(true);
    try {
      const kept = await saveStoneCombos([...combos, combo]);
      onSaved(kept, combo);
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Not saved', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add stone combo</DialogTitle></DialogHeader>
        <Input autoFocus maxLength={60} placeholder="e.g. Ruby & diamond" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} />
        {word && text.trim() && <p className="text-xs text-muted-foreground">Offered as “{composeCombo(text, word)}”.</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={busy || !text.trim()} onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
