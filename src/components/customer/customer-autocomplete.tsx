"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Customer } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  customers: Customer[];
  value: string;
  onSelect: (params: { name: string; customerId?: string; phone?: string }) => void;
  placeholder?: string;
  className?: string;
}

export const CustomerAutocomplete: React.FC<Props> = ({
  customers,
  value,
  onSelect,
  placeholder = 'Type customer name...',
  className,
}) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync when parent resets value
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = query.trim().length === 0
    ? customers.slice(0, 8)
    : customers.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onSelect({ name: e.target.value });
    setOpen(true);
  };

  const handleSelect = (c: Customer) => {
    setQuery(c.name);
    setOpen(false);
    onSelect({ name: c.name, customerId: c.id, phone: c.phone });
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <ScrollArea className="max-h-48">
            <button
              type="button"
              onMouseDown={() => { setQuery(''); setOpen(false); onSelect({ name: '', customerId: undefined, phone: '' }); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 border-b"
            >
              <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground italic">Walk-in Customer</span>
            </button>
            {filtered.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => handleSelect(c)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
              >
                <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="flex-1">{c.name}</span>
                {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
              </button>
            ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
};
