/**
 * What the iPhone app may change in the shop's settings document (/api/app/write updateSettings).
 *
 * A list of what is allowed, not of what is forbidden: anything not named here is dropped, so a field
 * added to `app_settings/global` tomorrow (a secret, a counter) is closed to the phone by default.
 * Never here, on purpose: the rates (setRates stamps who and when), the lock, the delete code, the
 * invoice/order/repair counters, the Shopify token and any key. Those stay the ERP's own screens.
 * The shapes are the ones the web stores (store.ts `Settings`, `PaymentMethod`).
 */

export const SETTINGS_BOOLEANS = [
  'autoDraftForms', 'notifEnabled',
  'notifNewOrder', 'notifOrderCompleted', 'notifOrderCancelled', 'notifNewInvoice', 'notifPaymentReceived',
  'notifDailyReport', 'notifDailyChecklist', 'notifEndOfDay', 'notifWeeklyReport', 'notifAdsDaily',
  'notifMonthlyReport', 'notifOrderOverdue', 'notifGivenItems', 'notifKarigarPayment',
] as const;

export const SETTINGS_TIMES = ['notifDailyChecklistTime', 'notifEndOfDayTime', 'notifDailyReportTime'] as const;

/** Text fields: the most a person could mean (an address of a few lines), so a paste gone wrong is not stored. */
const SETTINGS_TEXT: Record<string, { max: number; required?: boolean }> = {
  shopName: { max: 80, required: true },
  shopAddress: { max: 300 },
  shopContact: { max: 200 },
  teamNote: { max: 600 },
};

const THEMES = ['default', 'taheri'];
const UI_STYLES = ['standard', 'glass'];
const MAX_PHONES = 20;
const MAX_METHODS = 30;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SettingsPatchResult = { ok: true; patch: Record<string, unknown> } | { ok: false; error: string };

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : null);

/** The clean patch for the whitelisted fields in `input`, or the first thing wrong with it. */
export function cleanSettingsPatch(input: unknown): SettingsPatchResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Nothing to save.' };
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const k of SETTINGS_BOOLEANS) {
    if (!(k in src)) continue;
    if (typeof src[k] !== 'boolean') return { ok: false, error: `${k} must be on or off.` };
    out[k] = src[k];
  }

  for (const k of SETTINGS_TIMES) {
    if (!(k in src)) continue;
    if (typeof src[k] !== 'string' || !HH_MM.test(src[k] as string)) return { ok: false, error: `${k} must be a time like 09:00.` };
    out[k] = src[k];
  }

  for (const [k, rule] of Object.entries(SETTINGS_TEXT)) {
    if (!(k in src)) continue;
    const v = trimmed(src[k]);
    if (v === null) return { ok: false, error: `${k} must be text.` };
    if (rule.required && !v) return { ok: false, error: 'The shop needs a name.' };
    if (v.length > rule.max) return { ok: false, error: `${k} is too long (${rule.max} characters at most).` };
    out[k] = v;
  }

  if ('theme' in src) {
    if (typeof src.theme !== 'string' || !THEMES.includes(src.theme)) return { ok: false, error: 'Shop mode must be Light or Dark.' };
    out.theme = src.theme;
  }
  if ('uiStyle' in src) {
    if (typeof src.uiStyle !== 'string' || !UI_STYLES.includes(src.uiStyle)) return { ok: false, error: 'Interface style must be Standard or Liquid Glass.' };
    out.uiStyle = src.uiStyle;
  }

  if ('notifPhones' in src) {
    if (!Array.isArray(src.notifPhones) || src.notifPhones.length > MAX_PHONES) return { ok: false, error: `Up to ${MAX_PHONES} numbers.` };
    const seen = new Set<string>();
    for (const p of src.notifPhones) {
      // International format with no plus, as the web saves it and the sender reads it.
      const digits = typeof p === 'string' || typeof p === 'number' ? String(p).replace(/\D/g, '') : '';
      if (digits.length < 8 || digits.length > 15) return { ok: false, error: 'A WhatsApp number is 8 to 15 digits with the country code.' };
      seen.add(digits);
    }
    out.notifPhones = [...seen];
  }

  if ('paymentMethods' in src) {
    if (!Array.isArray(src.paymentMethods) || src.paymentMethods.length > MAX_METHODS) return { ok: false, error: `Up to ${MAX_METHODS} bank accounts.` };
    const methods: Record<string, string>[] = [];
    const ids = new Set<string>();
    for (const raw of src.paymentMethods) {
      const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const id = trimmed(m.id), bankName = trimmed(m.bankName), accountName = trimmed(m.accountName), accountNumber = trimmed(m.accountNumber);
      const iban = m.iban === undefined || m.iban === null ? '' : trimmed(m.iban);
      if (id === null || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) return { ok: false, error: 'Each bank account needs its own id.' };
      if (!bankName || !accountName || !accountNumber || iban === null) return { ok: false, error: 'A bank account needs the bank, the account name and the number.' };
      if (bankName.length > 120 || accountName.length > 120 || accountNumber.length > 64 || iban.length > 64) return { ok: false, error: 'A bank account detail is too long.' };
      ids.add(id);
      methods.push({ id, bankName, accountName, accountNumber, ...(iban && { iban }) });
    }
    out.paymentMethods = methods;
  }

  return Object.keys(out).length ? { ok: true, patch: out } : { ok: false, error: 'Nothing to save.' };
}
