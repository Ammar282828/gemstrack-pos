import { describe, it, expect } from 'vitest';
import { isWalkInName, phoneKey, resolveSaleCustomer, saleCustomerKey, shouldCreateCustomer, WALK_IN_ENTITY, WALK_IN_NAME } from './walk-in';

const book = [
  { id: 'cust-zoya', name: 'Zoya Nasir Iqbal', phone: '+923001234567' },
  { id: 'cust-maria-2', name: 'Maria Bhaijee', phone: '+923453367772' },
  { id: 'cust-maria-1', name: 'maria  bhaijee', phone: '03453367772' },
  { id: 'cust-tasneem', name: 'Tasneem Lotia', phone: '+923452244629' },
  { id: 'cust-ummehani', name: 'Ummehani Lotia', phone: '+923452244629' },
  { id: 'cust-noPhone', name: 'Batool Murtaza' },
  { id: 'cust-1790606575689-y4s4q', name: 'Walk-in Customer', phone: '' },
];

describe('isWalkInName', () => {
  it('the placeholder in any spelling the counter or old code used', () => {
    for (const n of ['Walk-in Customer', 'walk-in customer', 'Walk-in', 'walk in', 'Walkin', '  Walk-In  Customer ']) {
      expect(isWalkInName(n)).toBe(true);
    }
  });
  it('a real name, a number on the placeholder, or nothing is not the placeholder', () => {
    for (const n of ['Walk-in Customer - 03001234567', 'Walker', 'Zoya', '', undefined, null]) {
      expect(isWalkInName(n)).toBe(false);
    }
  });
});

describe('phoneKey', () => {
  it('local, international and bare forms of one number agree', () => {
    expect(phoneKey('0300 1234567')).toBe('3001234567');
    expect(phoneKey('+92 300-1234567')).toBe('3001234567');
    expect(phoneKey('923001234567')).toBe('3001234567');
  });
  it('too few digits is no number', () => {
    expect(phoneKey('12345')).toBe('');
    expect(phoneKey(undefined)).toBe('');
  });
});

describe('resolveSaleCustomer', () => {
  it('nothing typed: a walk-in, and no customer is made', () => {
    expect(resolveSaleCustomer({ customers: book })).toEqual({ name: WALK_IN_NAME, phone: '', isNew: false });
    expect(resolveSaleCustomer({ typedName: '  ', typedPhone: ' ', customers: book }).isNew).toBe(false);
  });
  it('an edited walk-in invoice puts the placeholder back in the name box: still a walk-in', () => {
    const r = resolveSaleCustomer({ typedName: 'Walk-in Customer', customers: book });
    expect(r).toEqual({ name: WALK_IN_NAME, phone: '', isNew: false });
    expect(shouldCreateCustomer(r)).toBe(false);
  });
  it('a picked customer is that customer, with their number', () => {
    expect(resolveSaleCustomer({ selectedId: 'cust-zoya', typedName: 'Zoya Nasir Iqbal', typedPhone: '', customers: book }))
      .toEqual({ id: 'cust-zoya', name: 'Zoya Nasir Iqbal', phone: '+923001234567', isNew: false });
  });
  it('a picked customer with no number on file takes the one typed', () => {
    expect(resolveSaleCustomer({ selectedId: 'cust-noPhone', typedPhone: '03211111111', customers: book }).phone).toBe('03211111111');
  });
  it('a picked id this device has not loaded is kept for generateInvoice to read', () => {
    expect(resolveSaleCustomer({ selectedId: 'cust-elsewhere', typedName: 'Someone', customers: book }))
      .toEqual({ id: 'cust-elsewhere', name: 'Someone', phone: '', isNew: false });
  });
  it('a picked leftover "Walk-in Customer" is let go of, not kept', () => {
    const r = resolveSaleCustomer({ selectedId: 'cust-1790606575689-y4s4q', typedName: 'Walk-in Customer', customers: book });
    expect(r.id).toBeUndefined();
    expect(r.isNew).toBe(false);
  });
  it('a leftover "Walk-in Customer" with a number typed becomes the person the number says', () => {
    expect(resolveSaleCustomer({ selectedId: 'cust-1790606575689-y4s4q', typedName: 'Walk-in Customer', typedPhone: '0300 1234567', customers: book }).id)
      .toBe('cust-zoya');
  });
  it('a typed name is a new customer', () => {
    expect(resolveSaleCustomer({ typedName: '  Sakina Painter ', customers: book }))
      .toEqual({ name: 'Sakina Painter', phone: '', isNew: true });
  });
  it('a number alone that nobody has is a new customer named by it, as before', () => {
    const r = resolveSaleCustomer({ typedPhone: '03339998888', customers: book });
    expect(r).toEqual({ name: 'Walk-in Customer - 03339998888', phone: '03339998888', isNew: true });
    expect(shouldCreateCustomer(r)).toBe(true);
  });
  it('a number on file, no name typed: that customer, not a copy', () => {
    expect(resolveSaleCustomer({ typedPhone: '0300-1234567', customers: book }).id).toBe('cust-zoya');
  });
  it('a number on file with their name typed (any case or spacing): that customer', () => {
    expect(resolveSaleCustomer({ typedName: 'zoya  nasir iqbal', typedPhone: '+923001234567', customers: book }).id).toBe('cust-zoya');
  });
  it('the same person twice already: the first of them, never a third', () => {
    expect(resolveSaleCustomer({ typedName: 'Maria Bhaijee', typedPhone: '03453367772', customers: book }).id).toBe('cust-maria-1');
    expect(resolveSaleCustomer({ typedPhone: '03453367772', customers: book }).id).toBe('cust-maria-1');
  });
  it('a number on file under another name is left alone: two people can share a phone', () => {
    expect(resolveSaleCustomer({ typedName: 'Zainab Iqbal', typedPhone: '03001234567', customers: book }))
      .toEqual({ name: 'Zainab Iqbal', phone: '03001234567', isNew: true });
  });
  it('a number two different people share, no name typed: neither is guessed', () => {
    const r = resolveSaleCustomer({ typedPhone: '03452244629', customers: book });
    expect(r.id).toBeUndefined();
    expect(r.isNew).toBe(true);
  });
  it('a name alone is never matched to someone in the book: that is a guess', () => {
    expect(resolveSaleCustomer({ typedName: 'Batool Murtaza', customers: book }).id).toBeUndefined();
  });
});

describe('shouldCreateCustomer', () => {
  it('only an id-less real name', () => {
    expect(shouldCreateCustomer({ name: 'Sakina Painter' })).toBe(true);
    expect(shouldCreateCustomer({ id: 'cust-zoya', name: 'Zoya' })).toBe(false);
    expect(shouldCreateCustomer({ name: WALK_IN_NAME })).toBe(false);
    expect(shouldCreateCustomer({ name: '' })).toBe(false);
  });
});

describe('saleCustomerKey', () => {
  const names = new Map(book.map(c => [c.id, c.name]));
  const current = (id: string) => names.get(id);
  it('a customer is keyed by their id', () => {
    expect(saleCustomerKey({ customerId: 'cust-zoya', customerName: 'Zoya Nasir Iqbal' }, current)).toBe('cust-zoya');
  });
  it('a name with no account is keyed by the name', () => {
    expect(saleCustomerKey({ customerName: 'Shopify Buyer' })).toBe('name:Shopify Buyer');
  });
  it('every shape of walk-in is the one walk-in row', () => {
    expect(saleCustomerKey({})).toBe(WALK_IN_ENTITY);
    expect(saleCustomerKey({ customerName: 'Walk-in Customer' })).toBe(WALK_IN_ENTITY);
    expect(saleCustomerKey({ customerId: WALK_IN_ENTITY, customerName: 'Walk-in Customer' })).toBe(WALK_IN_ENTITY);
    expect(saleCustomerKey({ customerId: 'cust-1790606575689-y4s4q', customerName: 'Walk-in Customer' }, current)).toBe(WALK_IN_ENTITY);
  });
  it('an old walk-in customer since renamed to a real person counts as that person', () => {
    expect(saleCustomerKey({ customerId: 'cust-old', customerName: 'Walk-in Customer' }, () => 'Mustafa Adeeb')).toBe('cust-old');
  });
  it('a customer no longer in the book falls back to the name on the sale', () => {
    expect(saleCustomerKey({ customerId: 'cust-gone', customerName: 'Walk-in Customer' }, current)).toBe(WALK_IN_ENTITY);
    expect(saleCustomerKey({ customerId: 'cust-gone', customerName: 'Hasan' }, current)).toBe('cust-gone');
  });
});
