import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { RepairCard } from './repair-card';
import type { Repair } from '@/lib/store';

const base: Repair = {
  id: 'REP-000001',
  customerName: 'Ayesha Khan',
  customerContact: '+923001234567',
  pieces: [{ item: 'Gold ring', work: 'resize to 14', weightG: 4.2, price: 3000 }, { item: 'Bangle', work: 'polish', price: 2000 }],
  payments: [{ amount: 2000, date: '2026-10-09T10:00:00.000Z', method: 'Cash' }],
  status: 'received',
  receivedAt: '2026-10-09T10:00:00.000Z',
  promisedDate: '2026-10-14',
};
const noop = () => {};
const render = (repair: Repair, props: { late?: number | null; whatsappHref?: string | null } = {}) =>
  renderToString(createElement(RepairCard, {
    repair, late: props.late ?? null, whatsappHref: props.whatsappHref,
    onEdit: noop, onReady: noop, onHandBack: noop, onPrint: noop, onCancel: noop, onDelete: noop,
  })).replace(/<!-- -->/g, '');

describe('RepairCard (the ticket card on /repairs)', () => {
  it('renders an in-the-shop ticket: person, pieces, id, balance and Ready', () => {
    const html = render(base);
    expect(html).toContain('Ayesha Khan');
    expect(html).toContain('resize to 14');
    expect(html).toContain('REP-000001');
    expect(html).toContain('In the shop');
    expect(html).toContain('PKR 3,000'); // 5,000 of work less 2,000 paid
    expect(html).toContain('Ready</button>');
    expect(html).not.toContain('Hand back');
  });

  it('shows days late once past the promised day', () => {
    const html = render(base, { late: 3 });
    expect(html).toContain('3d late');
  });

  it('a ready ticket offers Hand back and, with a number, Tell them', () => {
    const html = render({ ...base, status: 'ready', readyAt: '2026-10-11T10:00:00.000Z' }, { whatsappHref: 'https://wa.me/923001234567' });
    expect(html).toContain('Hand back');
    expect(html).toContain('Tell them');
    expect(html).toContain('Ready');
  });

  it('a collected, fully paid ticket is quiet and says paid', () => {
    const html = render({ ...base, status: 'collected', payments: [{ amount: 5000, date: '2026-10-10T10:00:00.000Z' }] });
    expect(html).toContain('opacity-70');
    expect(html).toContain('paid');
    expect(html).not.toContain('Hand back');
  });

  it('copes with a walk-in with no contact, no pieces and no promise', () => {
    const html = render({ ...base, customerName: '', customerContact: undefined, pieces: [], payments: [], promisedDate: undefined });
    expect(html).toContain('Walk-in');
  });
});
