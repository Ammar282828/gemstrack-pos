"use client";

/**
 * A phone field that copes with how people actually write numbers here.
 *
 * Pakistani mobiles are written 0300 1234567. The input shows a fixed +92, so
 * typing that verbatim produces +92 0300 1234567 — a trunk prefix that only
 * belongs on a domestic call, kept in the middle of an international number.
 * libphonenumber will still parse it, but what gets *saved* is the raw string,
 * so the database ends up holding two spellings of the same number and a
 * WhatsApp send to one of them fails.
 *
 * So: every change is normalised to E.164 before it leaves this component, and
 * a number that is not yet dialable says so rather than looking finished.
 */

import React from 'react';
import PhoneInput from 'react-phone-number-input';
import { parsePhoneNumberFromString, getCountryCallingCode } from 'libphonenumber-js';
import { AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const FRAME =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ' +
  'ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring ' +
  'focus-within:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

/**
 * Drop a national trunk zero sitting directly after the country code, then
 * return the canonical E.164 form. `+9203001234567` and `03001234567` both
 * become `+923001234567`.
 */
export function toE164(raw: string | undefined, country: 'PK' = 'PK'): string {
  if (!raw) return '';
  const compact = raw.replace(/[\s\-().]/g, '').replace(/^'+/, '');

  // Strip a trunk zero sitting between the country code and the number. The
  // calling code is looked up, never guessed: a greedy /^\+\d{1,3}0/ reads
  // "+92 3000118653" as country "+923" followed by a trunk zero and quietly
  // deletes a real digit from a valid number.
  const cc = getCountryCallingCode(country);

  // A pasted number sometimes carries the code twice — "+92 +92 333 …".
  let cleaned = compact;
  while (cleaned.startsWith(`+${cc}+${cc}`)) cleaned = `+${cc}${cleaned.slice(2 * cc.length + 2)}`;

  const withoutTrunk = cleaned.startsWith(`+${cc}0`)
    ? `+${cc}${cleaned.slice(cc.length + 2)}`
    : cleaned;

  // Only accept the stripped form if it actually improves matters.
  const strippedParse = parsePhoneNumberFromString(withoutTrunk, country);
  if (strippedParse?.isValid()) return strippedParse.number as string;

  const parsed = parsePhoneNumberFromString(cleaned, country);
  if (parsed?.number) return parsed.number as string;

  return withoutTrunk !== compact ? withoutTrunk : raw;
}

/** How finished the number is, for the message under the field. */
export function phoneState(raw: string | undefined, country: 'PK' = 'PK'):
  { state: 'empty' | 'incomplete' | 'invalid' | 'valid'; digits: number; expected?: number } {
  if (!raw || raw.replace(/\D/g, '') === '') return { state: 'empty', digits: 0 };
  const parsed = parsePhoneNumberFromString(raw, country);
  const digits = raw.replace(/\D/g, '').length;
  if (!parsed) return { state: 'incomplete', digits };
  if (parsed.isValid()) return { state: 'valid', digits };
  // Possible means the length is plausible for the country but the number
  // itself is not assigned — worth flagging differently from "keep typing".
  return { state: parsed.isPossible() ? 'invalid' : 'incomplete', digits };
}

export const PhoneField: React.FC<{
  value?: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  /** Suppresses the hint until the field has been touched. */
  showHint?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}> = ({ value, onChange, onBlur, showHint = true, disabled, className, 'aria-label': ariaLabel }) => {
  const [touched, setTouched] = React.useState(false);
  // The library keeps its own copy of the typed text and deliberately ignores
  // a changed `value` prop mid-typing, so normalising on each keystroke fixes
  // what is stored but leaves "+92 0300 …" sitting in the box. Remounting once
  // on blur makes the field show the number that was actually saved.
  const [nonce, setNonce] = React.useState(0);
  const status = phoneState(value);
  const tell = showHint && touched && status.state !== 'empty';

  const settle = () => {
    setTouched(true);
    const canonical = toE164(value);
    if (canonical !== value) onChange(canonical);
    setNonce(n => n + 1);
    onBlur?.();
  };

  return (
    <div className="space-y-1" onBlur={settle}>
      <PhoneInput
        key={nonce}
        international
        defaultCountry="PK"
        countryCallingCodeEditable={false}
        value={value || undefined}
        disabled={disabled}
        onChange={v => onChange(toE164(v as string | undefined))}
        aria-label={ariaLabel}
        className={cn(
          FRAME,
          tell && status.state !== 'valid' && 'border-destructive/60',
          className,
        )}
      />

      {tell && status.state === 'incomplete' && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          Incomplete — a Pakistani mobile is 10 digits after +92 (you have {Math.max(0, status.digits - 2)}).
        </p>
      )}
      {tell && status.state === 'invalid' && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          That is the right length but not a number this country issues — check the digits.
        </p>
      )}
      {tell && status.state === 'valid' && (
        <p className="text-xs text-success flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 flex-shrink-0" />Looks right.
        </p>
      )}
    </div>
  );
};
