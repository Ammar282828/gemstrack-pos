import { describe, expect, it } from 'vitest';
import { detectSpamCustomers, isGibberishName, isRandomEmailLocal, tokenGibberishScore, transactedCustomerIds } from './customer-spam';

// All names and addresses made up. ERPCore's CustomerSpamTests.swift runs these same cases.

describe('tokenGibberishScore', () => {
  it('scores camel-noise, case flips, consonant runs and few vowels', () => {
    expect(tokenGibberishScore('A')).toBe(0);
    expect(tokenGibberishScore('Ayesha')).toBe(0);
    expect(tokenGibberishScore('ABajEyYE')).toBe(4); // 2 internal caps + 5 flips
    expect(tokenGibberishScore('Strk')).toBe(2); // a run of four consonants
    expect(tokenGibberishScore('xKqZpW')).toBe(9); // 3 internal caps + flips + run + no vowels
    expect(tokenGibberishScore('McDonald')).toBe(1);
    expect(tokenGibberishScore('Rhythm')).toBe(4); // run + 0 vowels in 6 letters
  });
});

describe('isGibberishName', () => {
  it('flags a name whose tokens score 3 or more', () => {
    expect(isGibberishName('')).toBe(false);
    expect(isGibberishName('   ')).toBe(false);
    expect(isGibberishName('Ayesha Demo')).toBe(false);
    expect(isGibberishName('Sara McDonald')).toBe(false);
    expect(isGibberishName('ABajEyYE')).toBe(true);
    expect(isGibberishName('  qWrTzX   hJkLmN ')).toBe(true);
    expect(isGibberishName('Strk Demo')).toBe(false);
    expect(isGibberishName('Strk Brrk')).toBe(true);
  });
});

describe('isRandomEmailLocal', () => {
  it('looks only at a long local part, ignoring dots, dashes and underscores', () => {
    expect(isRandomEmailLocal(undefined)).toBe(false);
    expect(isRandomEmailLocal('')).toBe(false);
    expect(isRandomEmailLocal('bcdfghjk@example.com')).toBe(false); // under 12
    expect(isRandomEmailLocal('xkqzpwtrmn12@example.com')).toBe(true); // a run of five consonants
    expect(isRandomEmailLocal('ayesha.demo.person@example.com')).toBe(false);
    expect(isRandomEmailLocal('ab.ca.da.fa.ga.ha@example.com')).toBe(false); // vowels half the letters
    expect(isRandomEmailLocal('a1b2c3d4e5f6g7h8@example.com')).toBe(true); // 2 of 8 letters: 0.25 → random
  });

  it('counts digits out of the letters, and a local part of no letters as one', () => {
    expect(isRandomEmailLocal('bac1dac2fac3gac4@example.com')).toBe(false);
    expect(isRandomEmailLocal('123456789012@example.com')).toBe(true); // 0 / 1 < 0.28
    expect(isRandomEmailLocal('b1c2d3a4f5g6@example.com')).toBe(true); // 1 of 6 letters
  });
});

describe('transactedCustomerIds', () => {
  it('takes orders, invoices, and only customers\' hisaab rows', () => {
    const ids = transactedCustomerIds(
      [{ customerId: 'c1' }, { customerId: null }, {}],
      [{ customerId: 'c2' }, { customerId: '' }],
      [{ entityType: 'customer', entityId: 'c3' }, { entityType: 'karigar', entityId: 'c4' }, { entityType: 'customer' }],
    );
    expect([...ids].sort()).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('detectSpamCustomers', () => {
  const bot = { id: 'b1', name: 'ABajEyYE qWrTzX', email: 'xkqzpwtrmn12@example.com' };
  it('flags a bot with its reasons', () => {
    expect(detectSpamCustomers([bot], new Set())).toEqual([
      { customer: bot, reasons: ['Gibberish name', 'Random email', 'No phone / address / orders'] },
    ]);
    const nameOnly = { id: 'b2', name: 'ABajEyYE' };
    expect(detectSpamCustomers([nameOnly], new Set())[0].reasons).toEqual(['Gibberish name', 'No phone / address / orders']);
    const emailOnly = { id: 'b3', name: 'Demo Person', email: 'xkqzpwtrmn12@example.com' };
    expect(detectSpamCustomers([emailOnly], new Set())[0].reasons).toEqual(['Random email', 'No phone / address / orders']);
  });

  it('never flags anyone with a phone, an address or any history, nor a plain name', () => {
    expect(detectSpamCustomers([{ ...bot, phone: '03000000000' }], new Set())).toEqual([]);
    expect(detectSpamCustomers([{ ...bot, address: 'Demo Street 1' }], new Set())).toEqual([]);
    expect(detectSpamCustomers([bot], new Set(['b1']))).toEqual([]);
    expect(detectSpamCustomers([{ id: 'p1', name: 'Ayesha Demo', email: 'ayesha.demo@example.com' }], new Set())).toEqual([]);
    // Blank phone and address are none.
    expect(detectSpamCustomers([{ ...bot, phone: '  ', address: ' ' }], new Set())).toHaveLength(1);
  });
});
