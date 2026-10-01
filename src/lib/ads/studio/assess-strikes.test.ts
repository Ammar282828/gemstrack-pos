import { describe, expect, it } from 'vitest';
import { STRIKE_OUT, addStrikes, clearStrikes, readStrikes, setAside } from './assess-strikes';

describe('assess strikes', () => {
  it('sets a photo aside only after STRIKE_OUT strikes', () => {
    let list = addStrikes([], ['a', 'b'], () => 'the server stopped');
    expect(setAside(list).size).toBe(0);
    list = addStrikes(list, ['a'], () => 'unsupported image format');
    expect(STRIKE_OUT).toBe(2);
    expect([...setAside(list)]).toEqual(['a']);
    expect(list.find(s => s.id === 'a')).toEqual({ id: 'a', n: 2, why: 'unsupported image format' });
  });

  it('counts an id once per batch even if listed twice', () => {
    expect(addStrikes([], ['a', 'a'], () => 'x')).toEqual([{ id: 'a', n: 1, why: 'x' }]);
  });

  it('forgets the strikes of a photo that was assessed', () => {
    const list = addStrikes(addStrikes([], ['a', 'b'], () => 'x'), ['a'], () => 'y');
    expect(clearStrikes(list, ['a'])).toEqual([{ id: 'b', n: 1, why: 'x' }]);
  });

  it('does not change the list it was given', () => {
    const list = [{ id: 'a', n: 1, why: 'x' }];
    addStrikes(list, ['a'], () => 'y');
    expect(list[0].n).toBe(1);
  });

  it('reads back only well-formed entries', () => {
    expect(readStrikes(undefined)).toEqual([]);
    expect(readStrikes([{ id: 'a', n: 2, why: 'x' }, { id: 3 }, null, { id: 'b', n: 1 }])).toEqual([{ id: 'a', n: 2, why: 'x' }, { id: 'b', n: 1, why: '' }]);
  });
});
