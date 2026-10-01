import { describe, expect, it } from 'vitest';
import { docFileName, docPreview, longDay, shortDay, stamp } from './doc';

describe('docFileName', () => {
  it('is the headline: the house, what it is, the record — the notification shows nothing else', () => {
    expect(docFileName({ title: 'New sale', headline: 'INV-000083 · Rashida Modi · PKR 321,700' }, 'Taheri ERP'))
      .toBe('Taheri ERP · New sale · INV-000083 · Rashida Modi · PKR 321,700.pdf');
  });
  it('drops what a file name cannot carry, and the emoji', () => {
    expect(docFileName({ title: 'Daily report', headline: '1 Oct / 2026: "good" 💎\nday' }, 'House of Mina ERP'))
      .toBe('House of Mina ERP · Daily report · 1 Oct 2026 good day.pdf');
  });
  it('writes a time with a dot, since a colon cannot be in a file name', () => {
    expect(docFileName({ title: 'Test', headline: '1 Oct 2026, 9:45 pm' }, 'Taheri ERP')).toBe('Taheri ERP · Test · 1 Oct 2026, 9.45 pm.pdf');
  });
  it('stays a readable length', () => {
    const name = docFileName({ title: 'New sale', headline: 'x'.repeat(400) }, 'Taheri ERP');
    expect(name.length).toBeLessThanOrEqual(154);
    expect(name.endsWith('….pdf')).toBe(true);
  });
});

describe('dates, in Karachi', () => {
  const t = new Date('2026-09-30T20:30:00Z'); // 1:30 am on the 1st in Karachi
  it('reads the Karachi day, not the server’s', () => {
    expect(longDay(t)).toBe('Thursday 1 October 2026');
    expect(shortDay(t.toISOString())).toBe('1 Oct');
    expect(shortDay('2026-10-05')).toBe('5 Oct');
    expect(stamp(t)).toBe('1 Oct 2026, 1:30 am');
  });
  it('previews a document in a line or two', () => {
    expect(docPreview({ kind: 'x', title: 'End of day', heading: '', headline: '1 Oct', sections: [], at: t, figures: [{ label: 'Sales', value: 'PKR 10' }] }))
      .toMatch(/· End of day · 1 Oct\.pdf\nSales: PKR 10$/);
  });
});
