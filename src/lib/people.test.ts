import { describe, expect, it } from 'vitest';
import { parsePeople, personFor } from './people';

const TAHERI = 'potatomasta501@gmail.com=Ammar,unknownuser80@gmail.com=Mansoor,mmurtaza1970@gmail.com=Murtaza,hmurtaza55@gmail.com=Huzaifa';
const NAMES = ['Ammar', 'Murtaza', 'Huzaifa', 'Mansoor', 'Mohammad'];

describe('who is signed in, at the counter', () => {
  const people = parsePeople(TAHERI);
  it('names each of Taheri\'s accounts', () => {
    expect(personFor('potatomasta501@gmail.com', people, NAMES)).toBe('Ammar');
    expect(personFor('unknownuser80@gmail.com', people, NAMES)).toBe('Mansoor');
    expect(personFor('mmurtaza1970@gmail.com', people, NAMES)).toBe('Murtaza');
    expect(personFor('hmurtaza55@gmail.com', people, NAMES)).toBe('Huzaifa');
  });
  it('ignores case and spaces in the address', () => {
    expect(personFor('  PotatoMasta501@Gmail.com ', people, NAMES)).toBe('Ammar');
  });
  it('gives no default to an account without a name, to nobody, or to a name not on the house\'s list', () => {
    expect(personFor('someone@gmail.com', people, NAMES)).toBeUndefined();
    expect(personFor(null, people, NAMES)).toBeUndefined();
    expect(personFor('hmurtaza55@gmail.com', people, ['Mina', 'Ammar', 'Murtaza'])).toBeUndefined();
  });
  it('reads the setting forgivingly', () => {
    expect(parsePeople(' a@x.com = Ammar , broken, =Nobody, b@x.com=Mina ,')).toEqual({ 'a@x.com': 'Ammar', 'b@x.com': 'Mina' });
    expect(parsePeople(undefined)).toEqual({});
  });
});
