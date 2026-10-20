/**
 * Label LIVE (label.live, the Mac label app the shop prints its tags with) from the ERP — owner,
 * 2026-10-20: "can you connect label live to my erp".
 *
 * Label LIVE takes a print from a link: `labellive://print?design=<pinned design>&variables=<RJSON>
 * &printer=<printer id>&copies=<n>&window=…`, and several at once as `labellive://batch?payload=<base64
 * JSON array of jobs>` (label.live/guides/automated-label-printing-integration-with-production-processes).
 * A link is the one way that works from the ERP page: Safari and Chrome hand it to the app, where the
 * app's HTTP API (localhost:11180) is blocked from an https page by the browsers' private-network rules.
 *
 * The design's variable names live in its .lsc file on the Mac, so the ERP never guesses them: the owner
 * pastes the link Label LIVE's own Integrate button copies for the design, and `parseIntegrateUrl` reads
 * the design, the printer and every variable name out of it. `guessField` then pairs each variable with
 * a piece's field by its name; Settings → Labels lets the owner change any pairing.
 *
 * The design must be pinned to Label LIVE's Home screen (its rule for a link to find it).
 */

export interface LabelLiveConfig {
  /** The design's name as Label LIVE pins it ("minalabel"). */
  design: string;
  /** Label LIVE's printer id (its Print tab); empty prints to the last printer used. "Preview" previews. */
  printer: string;
  copies: number;
  /** Each design variable → the piece's field that fills it (`FIELD_KEYS`), or "" to leave it as the design has it. */
  map: Record<string, LabelFieldKey | ''>;
  /** Keep Label LIVE's window out of the way while it prints. */
  hideWindow: boolean;
}

/** What a piece can put on a label. Money is whole rupees (decision "Whole rupees"). */
export const LABEL_FIELDS = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Name' },
  { key: 'price', label: 'Price (Rs 12,500)' },
  { key: 'priceNumber', label: 'Price, number only (12500)' },
  { key: 'weight', label: 'Weight (4.250 g)' },
  { key: 'weightNumber', label: 'Weight, number only (4.250)' },
  { key: 'metal', label: 'Metal and karat (Gold 21k)' },
  { key: 'karat', label: 'Karat (21k)' },
  { key: 'category', label: 'Category' },
  { key: 'stones', label: 'Stones (details)' },
  { key: 'stoneWeight', label: 'Stone weight (g)' },
  { key: 'diamonds', label: 'Diamonds (details)' },
  { key: 'size', label: 'Size' },
  { key: 'plating', label: 'Plating' },
  { key: 'shop', label: 'Shop name' },
  { key: 'qr', label: 'QR / barcode (the SKU)' },
  { key: 'date', label: 'Today’s date' },
] as const;
export type LabelFieldKey = typeof LABEL_FIELDS[number]['key'];
export const FIELD_KEYS = LABEL_FIELDS.map(f => f.key) as readonly LabelFieldKey[];

/** The values one piece gives a label — worked out by the caller (it has the rates). */
export type LabelValues = Partial<Record<LabelFieldKey, string>>;

// ── Reading Label LIVE's Integrate link ───────────────────────────────────

/**
 * Split RJSON `NAME:'Jane Doe',CITY:Karachi` at the commas between pairs (not those inside quotes) and
 * return each pair's key and value.
 */
export function rjsonPairs(s: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  let buf = '', quote: string | null = null;
  const flush = () => {
    const i = buf.indexOf(':');
    if (i > 0) {
      const key = buf.slice(0, i).trim().replace(/^['"]|['"]$/g, '');
      let value = buf.slice(i + 1).trim();
      if (/^'[\s\S]*'$|^"[\s\S]*"$/.test(value)) value = value.slice(1, -1).replace(/\\(['"&])/g, '$1');
      if (key) out.push({ key, value });
    }
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { buf += c + s[++i]; continue; }
    if (quote) { if (c === quote) quote = null; buf += c; continue; }
    if (c === "'" || c === '"') { quote = c; buf += c; continue; }
    if (c === '{' || c === '}') continue; // a `{…}` wrapper some links carry
    if (c === ',') { flush(); continue; }
    buf += c;
  }
  flush();
  return out;
}

export interface ParsedIntegrate { design: string; printer: string; copies: number; variables: string[] }

/**
 * The link Label LIVE's Integrate button copies ("Copy URL" or "Copy Browser URL") → its design, printer,
 * copies and variable names. Null when it isn't a Label LIVE print link.
 */
export function parseIntegrateUrl(raw: string): ParsedIntegrate | null {
  const s = (raw || '').trim();
  const m = /^labellive:\/\/print\??(.*)$/i.exec(s);
  if (!m) return null;
  // Its options are split at the "&" that are not escaped as "\&" (Label LIVE's rule inside values).
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < m[1].length; i++) {
    const c = m[1][i];
    if (c === '&' && m[1][i - 1] !== '\\') { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  const get = (name: string) => {
    const p = parts.find(x => x.toLowerCase().startsWith(`${name}=`));
    if (p === undefined) return undefined;
    const v = p.slice(name.length + 1);
    try { return decodeURIComponent(v.replace(/\+/g, '%20')); } catch { return v; }
  };
  const design = (get('design') ?? '').trim();
  if (!design) return null;
  const copies = Number(get('copies'));
  return {
    design,
    printer: (get('printer') ?? '').trim(),
    copies: Number.isFinite(copies) && copies >= 1 ? Math.min(99, Math.round(copies)) : 1,
    variables: rjsonPairs(get('variables') ?? '').map(p => p.key),
  };
}

/** The field a design variable most likely wants, by its name; "" when nothing fits. */
export function guessField(variable: string): LabelFieldKey | '' {
  const v = variable.toLowerCase().replace(/[^a-z0-9]/g, '');
  const has = (...w: string[]) => w.some(x => v.includes(x));
  if (has('qr', 'barcode')) return 'qr';
  if (has('sku', 'code', 'tag', 'itemno', 'productid') || v === 'id') return 'sku';
  if (has('stonewt', 'stoneweight')) return 'stoneWeight';
  if (has('diamond')) return 'diamonds';
  if (has('stone', 'gem')) return 'stones';
  if (has('weight', 'wt', 'gram', 'gms')) return v.endsWith('num') || v.endsWith('number') ? 'weightNumber' : 'weight';
  if (has('price', 'amount', 'pkr', 'rate', 'mrp', 'cost')) return v.endsWith('num') || v.endsWith('number') ? 'priceNumber' : 'price';
  if (has('karat', 'carat', 'purity') || v === 'kt' || v === 'k') return 'karat';
  if (has('metal', 'material')) return 'metal';
  if (has('category', 'type', 'collection')) return 'category';
  if (has('size')) return 'size';
  if (has('plating', 'finish', 'polish')) return 'plating';
  if (has('shop', 'brand', 'store', 'company')) return 'shop';
  if (has('date', 'day')) return 'date';
  if (has('name', 'title', 'design', 'item', 'product', 'description')) return 'name';
  return '';
}

/** A config from a pasted Integrate link, each variable paired with its likely field. */
export function configFromIntegrate(p: ParsedIntegrate, previous?: LabelLiveConfig | null): LabelLiveConfig {
  const map: LabelLiveConfig['map'] = {};
  for (const v of p.variables) map[v] = previous?.map[v] !== undefined ? previous.map[v] : guessField(v);
  return { design: p.design, printer: p.printer, copies: p.copies, map, hideWindow: previous?.hideWindow ?? true };
}

// ── Making the print link ─────────────────────────────────────────────────

/**
 * One value as RJSON: always single-quoted, a quote escaped. An "&" becomes "and" rather than Label
 * LIVE's "\&" escape, which a percent-encoded link may or may not keep; a tag never needs the sign.
 */
export const rjsonValue = (v: string) => `'${String(v).replace(/\r?\n/g, ' ').replace(/&/g, 'and').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The design's variables filled from one piece: `SKU:'TC-1042',PRICE:'Rs 12,500'`. */
export function variablesFor(config: LabelLiveConfig, values: LabelValues): string {
  return Object.entries(config.map)
    .filter(([, field]) => field)
    .map(([name, field]) => `${name}:${rjsonValue(values[field as LabelFieldKey] ?? '')}`)
    .join(',');
}

const enc = (v: string) => encodeURIComponent(v);

/** One piece → `labellive://print?…`. */
export function printUrl(config: LabelLiveConfig, values: LabelValues, copies = config.copies): string {
  const q = [
    `design=${enc(config.design)}`,
    `variables=${enc(variablesFor(config, values))}`,
    ...(config.printer ? [`printer=${enc(config.printer)}`] : []),
    `copies=${Math.max(1, Math.min(99, Math.round(copies) || 1))}`,
    `window=${config.hideWindow ? 'hide' : 'show'}`,
    'ignoreWarnings=true',
  ];
  return `labellive://print?${q.join('&')}`;
}

/** Base64 of UTF-8 text, in the browser and on the server alike. */
function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/**
 * Several pieces → one `labellive://batch?payload=…` (a browser opens only the first of several links a
 * tap starts, so pieces go together). Each job has the design, its variables, printer and copies.
 */
export function batchUrl(config: LabelLiveConfig, pieces: LabelValues[], copies = config.copies): string {
  const jobs = pieces.map(v => ({
    design: config.design,
    variables: variablesFor(config, v),
    ...(config.printer ? { printer: config.printer } : {}),
    copies: String(Math.max(1, Math.min(99, Math.round(copies) || 1))),
    window: config.hideWindow ? 'hide' : 'show',
    ignoreWarnings: 'true',
  }));
  return `labellive://batch?payload=${enc(b64(JSON.stringify(jobs)))}`;
}

/** The link for one piece or many. */
export const labelLiveUrl = (config: LabelLiveConfig, pieces: LabelValues[], copies?: number) =>
  pieces.length === 1 ? printUrl(config, pieces[0], copies) : batchUrl(config, pieces, copies);

/**
 * As the shop's settings keep it: the pairings as a list, because the settings document is written with
 * a merge, which would keep a removed variable in a map but replaces a list whole.
 */
export interface StoredLabelLive { design: string; printer: string; copies: number; hideWindow: boolean; vars: { name: string; field: LabelFieldKey | '' }[] }

export const toStoredLabelLive = (c: LabelLiveConfig): StoredLabelLive => ({
  design: c.design.trim(), printer: c.printer.trim(), copies: c.copies, hideWindow: c.hideWindow,
  vars: Object.entries(c.map).map(([name, field]) => ({ name, field })),
});

/** A saved config, checked: anything odd is dropped rather than printed wrong. */
export function cleanLabelLive(input: unknown): LabelLiveConfig | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const design = typeof o.design === 'string' ? o.design.trim().slice(0, 120) : '';
  if (!design) return null;
  const map: LabelLiveConfig['map'] = {};
  const pairs: [string, unknown][] = Array.isArray(o.vars)
    ? (o.vars as unknown[]).map(v => (v && typeof v === 'object' ? [String((v as { name?: unknown }).name ?? ''), (v as { field?: unknown }).field] : ['', '']))
    : o.map && typeof o.map === 'object' ? Object.entries(o.map as Record<string, unknown>) : [];
  {
    for (const [k, v] of pairs.slice(0, 60)) {
      if (!k || k.length > 60) continue;
      map[k] = typeof v === 'string' && (FIELD_KEYS as readonly string[]).includes(v) ? (v as LabelFieldKey) : '';
    }
  }
  const copies = Number(o.copies);
  return {
    design,
    printer: typeof o.printer === 'string' ? o.printer.trim().slice(0, 200) : '',
    copies: Number.isFinite(copies) && copies >= 1 ? Math.min(99, Math.round(copies)) : 1,
    map,
    hideWindow: o.hideWindow !== false,
  };
}
