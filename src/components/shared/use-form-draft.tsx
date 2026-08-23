"use client";

/**
 * Keeps an unfinished form, and offers it back on return.
 *
 * Saves on a debounce rather than every keystroke, because a custom order has
 * a lot of fields and writing on each one would serialise the whole form
 * dozens of times a second for no benefit.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { FileClock, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  saveDraft, readDraft, clearDraft, isWorthSaving, type DraftKind, type Draft,
} from '@/lib/form-drafts';

const DEBOUNCE_MS = 800;

export function useFormDraft<T>(opts: {
  kind: DraftKind;
  /** `new` for a fresh form, or the record id when editing. */
  id: string;
  /** Current form values. */
  value: T;
  /** Off entirely when the setting is disabled. */
  enabled: boolean;
  /** Editing an existing record already has its data saved — nothing to draft. */
  skip?: boolean;
}) {
  const { kind, id, value, enabled, skip } = opts;
  const [found, setFound] = React.useState<Draft<T> | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  // Only look once, on mount: re-reading after the first save would offer the
  // user their own in-progress typing back to them.
  const looked = React.useRef(false);

  React.useEffect(() => {
    if (looked.current || !enabled || skip) return;
    looked.current = true;
    setFound(readDraft<T>(kind, id));
  }, [enabled, skip, kind, id]);

  React.useEffect(() => {
    if (!enabled || skip) return;
    const t = setTimeout(() => {
      if (isWorthSaving(value)) saveDraft(kind, id, value);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, enabled, skip, kind, id]);

  const discard = React.useCallback(() => {
    clearDraft(kind, id);
    setFound(null);
    setDismissed(true);
  }, [kind, id]);

  /** Call once the record is actually saved. */
  const done = React.useCallback(() => clearDraft(kind, id), [kind, id]);

  return {
    draft: dismissed ? null : found,
    discard,
    done,
    dismiss: () => setDismissed(true),
  };
}

export const DraftRestoreBanner: React.FC<{
  savedAt: string;
  noun: string;
  onRestore: () => void;
  onDiscard: () => void;
}> = ({ savedAt, noun, onRestore, onDiscard }) => {
  let when = 'a moment ago';
  try { when = formatDistanceToNow(new Date(savedAt), { addSuffix: true }); } catch { /* keep the fallback */ }
  return (
    <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <FileClock className="h-4 w-4 flex-shrink-0 text-primary" />
      <p className="text-sm flex-1 min-w-0">
        You have an unfinished {noun} from <span className="font-medium">{when}</span>.
      </p>
      <div className="flex gap-2 flex-shrink-0">
        <Button type="button" size="sm" onClick={onRestore}>Restore it</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard} aria-label="Discard draft">
          <X className="h-4 w-4 mr-1" />Discard
        </Button>
      </div>
    </div>
  );
};
