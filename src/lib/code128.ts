/**
 * Code 128 barcodes for the shipping slip (lib/shipping-slip-pdf.ts): a consignment number a courier's scanner reads.
 * Code C (two digits a symbol) for an even run of digits, Code B for anything else, with the mod-103 check symbol.
 * Pure: the drawing is the slip's.
 */

/** Each symbol's bar/space widths in modules (bar first), values 0–106; 106 is the stop (13 modules). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104, START_C = 105, STOP = 106;

/** The symbol values (start, data, check, stop) for `text`. Throws on characters Code B cannot carry. */
export function code128Values(text: string): number[] {
  const s = String(text);
  if (!s) throw new Error('Nothing to encode.');
  const digits = /^\d+$/.test(s) && s.length % 2 === 0;
  const values: number[] = [digits ? START_C : START_B];
  if (digits) {
    for (let i = 0; i < s.length; i += 2) values.push(Number(s.slice(i, i + 2)));
  } else {
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error(`Code 128 B cannot carry "${ch}".`);
      values.push(c - 32);
    }
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values;
}

/** The bars as widths in modules, alternating bar and space, starting with a bar. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap(v => CODE128_PATTERNS[v].split('').map(Number));
}

/** Total width in modules, without the quiet zones (10 modules each side, left to the drawer). */
export const code128Modules = (text: string) => code128Widths(text).reduce((a, b) => a + b, 0);
