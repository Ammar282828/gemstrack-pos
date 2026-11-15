import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TONES, TONE } from './tones';

// WCAG contrast of the palette in globals.css, for light/dark x Taheri/Mina, modelled on Android's ContrastTests.
// 4.5:1 for words. The tokens are parsed from the CSS and layered as the cascade does.

const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');

const declsOf = (selector: string): Record<string, string> => {
  const at = css.indexOf('\n  ' + selector + ' {');
  expect(at, selector).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('\n  }', at));
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};

const LIGHT = declsOf(':root, .theme-default');
const DARK = declsOf('.dark');
const MINA_LIGHT = declsOf('.brand-mina.theme-default');
const MINA_DARK = declsOf('.dark .brand-mina:not(.theme-default)');

const schemes: Array<[string, boolean, Record<string, string>]> = [
  ['Taheri light', false, { ...LIGHT }],
  ['Taheri dark', true, { ...LIGHT, ...DARK }],
  ['Mina light', false, { ...LIGHT, ...MINA_LIGHT }],
  ['Mina dark', true, { ...LIGHT, ...DARK, ...MINA_DARK }],
];

type RGB = [number, number, number];

const hslToRgb = (h: number, s: number, l: number): RGB => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};

const colour = (vars: Record<string, string>, name: string): RGB => {
  let v = vars[name];
  expect(v, `--${name}`).toBeDefined();
  for (let i = 0; i < 5; i++) {
    const m = v.match(/^var\(--([\w-]+)\)$/);
    if (!m) break;
    v = vars[m[1]];
    expect(v, `--${m[1]}`).toBeDefined();
  }
  const m = v.match(/^([\d.]+) ([\d.]+)% ([\d.]+)%$/);
  expect(m, `--${name}: ${v}`).not.toBeNull();
  return hslToRgb(+m![1], +m![2], +m![3]);
};

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg: RGB, bg: RGB, alpha: number): RGB => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [1, 1, 1];

describe('contrast of the palette (WCAG, 4.5:1 for words)', () => {
  for (const [name, dark, vars] of schemes) {
    const card = colour(vars, 'card');
    const ground = colour(vars, 'background');
    const grounds: Array<[string, RGB]> = [['card', card], ['ground', ground]];

    it(`${name}: every tone's ink reads on its 13% wash over the card and the ground`, () => {
      const failures: string[] = [];
      for (const t of TONES) {
        const fill = colour(vars, `tone-${t}`);
        const ink = colour(vars, `tone-${t}-ink`);
        for (const [gn, g] of grounds) {
          const c = ratio(ink, over(fill, g, 0.13));
          if (c < 4.5) failures.push(`${name} tone-${t}-ink on ${gn} wash ${c.toFixed(2)}`);
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });

    it(`${name}: muted-foreground reads on the card and the ground`, () => {
      for (const [gn, g] of grounds) {
        const c = ratio(colour(vars, 'muted-foreground'), g);
        expect(c, `${name} muted-foreground on ${gn} ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: destructive text reads on the card${dark ? '' : ' and the ground'}`, () => {
      const c = ratio(colour(vars, 'destructive'), card);
      expect(c, `${name} destructive on card ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      if (!dark) {
        const cg = ratio(colour(vars, 'destructive'), ground);
        expect(cg, `${name} destructive on ground ${cg.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: swipe squares' text reads on their solid fill`, () => {
      const failures: string[] = [];
      for (const t of TONES) {
        const m = TONE[t].solid.match(/text-(black|white|card|primary-foreground)/);
        expect(m, TONE[t].solid).not.toBeNull();
        const text = m![1] === 'black' ? BLACK : m![1] === 'white' ? WHITE : m![1] === 'card' ? card : colour(vars, 'primary-foreground');
        const c = ratio(text, colour(vars, `tone-${t}`));
        if (c < 4.5) failures.push(`${name} swipe ${t} ${c.toFixed(2)}`);
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});
