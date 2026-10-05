import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));

import { mergeWeights, posOnlyWeights, withAngleWeights } from './weights';

const pos = (key: string, weightGrams: number) => ({ [key]: { key, weightGrams, enteredBy: 'x', enteredAt: '2026-10-05T09:00:00Z' } });

describe('counter weights', () => {
  const catalog = { 'Rings & Bands/Rings/Ring 1.webp': { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Traditional' } };
  const counter = { ...pos('Rings & Bands/Rings/Ring 1.webp', 4.2), ...pos('Rings & Bands/Rings/DSC09463.webp', 6.07) };

  it('weigh a catalogued piece that has no label, and leave a labelled one as the photo shows it', () => {
    const m = mergeWeights({ ...catalog, 'Earrings/Tops/Tops 1.webp': { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'x', weightGrams: 3 } }, { ...counter, ...pos('Earrings/Tops/Tops 1.webp', 3.5) });
    expect(m['Rings & Bands/Rings/Ring 1.webp']).toMatchObject({ weightGrams: 4.2, weightSource: 'pos' });
    expect(m['Earrings/Tops/Tops 1.webp']).toMatchObject({ weightGrams: 3.5, weightSource: 'label' });
  });

  it('carry a drop the catalogue does not hold yet — weight only, never into the priced catalogue', () => {
    expect(Object.keys(mergeWeights(catalog, counter))).toEqual(['Rings & Bands/Rings/Ring 1.webp']);
    expect(posOnlyWeights(catalog, counter)).toEqual({ 'Rings & Bands/Rings/DSC09463.webp': 6.07 });
  });
});

describe('withAngleWeights', () => {
  const w = (key: string, g: number, at: string) => ({ [key]: { key, weightGrams: g, enteredBy: 'x', enteredAt: at } });
  const angles = { 'R/Rings/DSC09463.webp': { angleOf: 'R/Rings/DSC09481.webp' }, 'R/Rings/DSC09467.webp': { angleOf: 'R/Rings/DSC09477.webp' }, 'R/Rings/DSC09476.webp': { angleOf: 'R/Rings/DSC09477.webp' } };
  it('gives a piece the weight entered on one of its angles, the latest when there are several', () => {
    const out = withAngleWeights({ ...w('R/Rings/DSC09463.webp', 6.07, '2026-10-05T09:27'), ...w('R/Rings/DSC09467.webp', 5.2, '2026-10-05T09:17'), ...w('R/Rings/DSC09476.webp', 5.25, '2026-10-05T09:26') }, angles);
    expect(out['R/Rings/DSC09481.webp'].weightGrams).toBe(6.07);
    expect(out['R/Rings/DSC09477.webp'].weightGrams).toBe(5.25);
    expect(out['R/Rings/DSC09463.webp'].weightGrams).toBe(6.07);
  });
  it('never overrides a weight entered on the piece itself', () => {
    const out = withAngleWeights({ ...w('R/Rings/DSC09481.webp', 7, '2026-10-01'), ...w('R/Rings/DSC09463.webp', 6.07, '2026-10-05') }, angles);
    expect(out['R/Rings/DSC09481.webp'].weightGrams).toBe(7);
  });
});
