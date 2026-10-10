"use client";

import { useState } from 'react';
import { Pin, Pencil } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

/** The same live app_settings/global note the iPhone and widget read. */
export function TeamNote({ owner }: { owner: boolean }) {
  const note = useAppStore(s => s.settings.teamNote ?? '');
  const loaded = useAppStore(s => s.hasSettingsLoaded);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function open() { setText(note); setError(''); setEditing(true); }
  async function save(value: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const token = await auth?.currentUser?.getIdToken();
      const response = await fetch('/api/app/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ op: 'updateSettings', patch: { teamNote: value.trim() }, requestId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the note.');
      // Firestore's subscription keeps everyone current; reflect the confirmed write immediately here.
      useAppStore.setState(s => ({ settings: { ...s.settings, teamNote: value.trim() } }));
      setEditing(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the note.'); }
    finally { setBusy(false); }
  }
  if (!loaded || (!note && !owner)) return null;
  return <>
    <aside aria-label="Pinned team message" className="mb-4 rounded-xl border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <Pin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">Team note</p>
          {note && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{note}</p>}
        </div>
        {owner && <Button variant="ghost" size="sm" onClick={open}><Pencil className="mr-2 h-3.5 w-3.5" />{note ? 'Edit' : 'Pin a message'}</Button>}
      </div>
    </aside>
    <Dialog open={editing} onOpenChange={v => { if (!busy) setEditing(v); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pin a team message</DialogTitle></DialogHeader>
        <Textarea aria-label="Team message" value={text} onChange={e => setText(e.target.value)} maxLength={600} rows={5} disabled={busy} />
        <p className="text-xs text-muted-foreground">Everyone sees this until you clear it. {text.length}/600</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {note && <Button variant="outline" disabled={busy} onClick={() => save('')}>Clear note</Button>}
          <Button disabled={busy || !text.trim()} onClick={() => save(text)}>{busy ? 'Saving…' : 'Save message'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
