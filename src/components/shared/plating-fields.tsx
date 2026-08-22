"use client";

/**
 * The 925 sterling silver finish block — plating type, a free-text note when
 * it is "Other", and the nickel-free flag. Controlled, so it works in a plain
 * dialog as well as inside a form.
 *
 * Renders nothing for a non-silver piece: plating is meaningless on solid gold.
 */

import React from 'react';
import { PLATING_TYPES, metalSupportsPlating } from '@/lib/store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

export interface PlatingValue {
  platingType?: string;
  platingNote?: string;
  nickelFree?: boolean;
}

export const PlatingFields: React.FC<{
  metalType?: string;
  value: PlatingValue;
  onChange: (patch: PlatingValue) => void;
  className?: string;
}> = ({ metalType, value, onChange, className }) => {
  if (!metalSupportsPlating(metalType)) return null;

  return (
    <div className={className ?? 'rounded-md border p-3 space-y-3'}>
      <p className="text-sm font-medium">925 Sterling Silver finish</p>

      <div>
        <Label className="text-xs">Plating</Label>
        <Select
          value={value.platingType || NONE}
          onValueChange={v => onChange({ ...value, platingType: v === NONE ? '' : v })}
        >
          <SelectTrigger><SelectValue placeholder="No plating" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No plating</SelectItem>
            {PLATING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {value.platingType === 'Other' && (
        <div>
          <Label className="text-xs">Describe the plating</Label>
          <Input placeholder="e.g. Rose gold plating"
            value={value.platingNote || ''}
            onChange={e => onChange({ ...value, platingNote: e.target.value })}  aria-label="Describe the plating"/>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox id="nickel-free" checked={!!value.nickelFree}
          onCheckedChange={c => onChange({ ...value, nickelFree: c === true })} />
        <Label htmlFor="nickel-free" className="font-normal text-sm cursor-pointer">Nickel free</Label>
      </div>
    </div>
  );
};
