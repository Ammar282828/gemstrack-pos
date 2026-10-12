import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TONES, toneText, toneFill, tonePill, toneTint } from './tones';

const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
const tailwind = readFileSync(join(__dirname, '../../tailwind.config.ts'), 'utf8');

describe('tones', () => {
  it('has the seven tones of the app', () => {
    expect([...TONES].sort()).toEqual(['credit', 'house', 'late', 'owed', 'quiet', 'settled', 'working']);
  });

  it('maps every tone to its own whole class names', () => {
    for (const t of TONES) {
      expect(toneText(t)).toBe(`text-tone-${t}-ink`);
      expect(toneFill(t)).toBe(`bg-tone-${t}`);
      expect(tonePill(t)).toBe(`text-tone-${t}-ink bg-tone-${t}/[.13]`);
      expect(toneTint(t)).toBe(`bg-tone-${t}/10`);
    }
  });

  it('has every tone as a variable in light and dark, and as a Tailwind colour', () => {
    for (const t of TONES) {
      // The five colours are declared twice (light on :root, dark on .dark), fill and ink; quiet and
      // house follow --muted-foreground / --primary, which already change with the mode, so once.
      const want = t === 'quiet' || t === 'house' ? 1 : 2;
      expect(css.match(new RegExp(`--tone-${t}:`, 'g'))?.length).toBeGreaterThanOrEqual(want);
      expect(css.match(new RegExp(`--tone-${t}-ink:`, 'g'))?.length).toBeGreaterThanOrEqual(want);
      expect(tailwind).toContain(`var(--tone-${t})`);
      expect(tailwind).toContain(`var(--tone-${t}-ink)`);
    }
  });
});

describe('the app palette in the CSS', () => {
  // The four values per house that the app's Assets.xcassets hold (a.1), as the hex the app
  // names them; the CSS holds them as HSL, so compare after converting (to within rounding).
  const hsl = (h: number, s: number, l: number) => {
    s /= 100; l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const near = (a: string, b: string) =>
    [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);

  const block = (selector: string) => {
    const at = css.indexOf(selector + ' {');
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
  const token = (b: string, name: string) => {
    const m = b.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
    expect(m, name).not.toBeNull();
    return hsl(+m![1], +m![2], +m![3]);
  };

  const cases: Array<[string, string, Record<string, string>]> = [
    ['Taheri light', ':root, .theme-default', { background: '#F2F3F6', card: '#FFFFFF', primary: '#8A6B42', 'primary-foreground': '#FFFFFF' }],
    ['Taheri dark', '.dark', { background: '#0A1111', card: '#141A1A', primary: '#BE9F76', 'primary-foreground': '#0B1414' }],
    ['Mina light', '.brand-mina.theme-default', { background: '#F4EFE8', card: '#FFFDF9', primary: '#380000', 'primary-foreground': '#FBF9F9' }],
    ['Mina dark', '.dark .brand-mina:not(.theme-default)', { background: '#1C1114', card: '#27191D', primary: '#E8A5AE', 'primary-foreground': '#251318' }],
  ];
  for (const [name, selector, want] of cases) {
    it(`${name} holds the app's four colours`, () => {
      const b = block(selector);
      for (const [tokenName, hex] of Object.entries(want)) {
        expect(near(token(b, tokenName), hex), `${name} --${tokenName} ${token(b, tokenName)} vs ${hex}`).toBe(true);
      }
    });
  }
});
