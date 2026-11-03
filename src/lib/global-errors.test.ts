import { describe, expect, it } from 'vitest';
import { describeRejection } from './global-errors';

describe('describeRejection', () => {
  it('says nothing for a cancelled request or while offline', () => {
    const abort = new Error('x'); abort.name = 'AbortError';
    expect(describeRejection(abort)).toBeNull();
    expect(describeRejection(new Error('boom'), false)).toBeNull();
    expect(describeRejection(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBeNull();
  });
  it('words an error, a string and an odd value', () => {
    expect(describeRejection(new Error('Could   not save\n'))?.description).toBe('Could not save');
    expect(describeRejection('plain')?.description).toBe('plain');
    expect(describeRejection(undefined)?.description).toMatch(/Try that again/);
    expect(describeRejection({ message: 'm' })?.description).toBe('m');
  });
  it('keeps it to one short line', () => {
    expect(describeRejection(new Error('a'.repeat(500)))!.description.length).toBe(140);
  });
});
