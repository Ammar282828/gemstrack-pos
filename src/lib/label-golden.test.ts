import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goldenLabelCases } from '@/lib/test-fixtures/label-golden';

// The tag engine's golden file: what the TypeScript prints for a fixed set of made-up tags (label-golden.ts). Android's
// core tests (LabelGoldenTests) read the same file and must print the same ZPL, byte for byte. When this code changes
// on purpose: `WRITE_LABEL_GOLDEN=1 npx vitest run src/lib/label-golden`, then run the apps' tests.
const FILE = resolve(__dirname, '../../apps/android/core/src/test/resources/label-golden.json');
const fresh = JSON.stringify(goldenLabelCases()) + '\n';

describe('label golden file', () => {
  it('is what the engine prints today', () => {
    if (process.env.WRITE_LABEL_GOLDEN) writeFileSync(FILE, fresh);
    expect(readFileSync(FILE, 'utf8')).toBe(fresh);
  });

  it('has the cases it promises', () => {
    const g = goldenLabelCases();
    expect(g.zpl.length).toBeGreaterThan(200);
    expect(g.lsc.length).toBe(3);
    expect(g.zpl.filter((c) => c.pieces.length > 0 || c.skip).every((c) => c.zpl.startsWith('^XA'))).toBe(true);
  });
});
