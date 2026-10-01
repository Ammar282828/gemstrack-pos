import { describe, expect, it } from 'vitest';
import { liveText, startLive } from './live';

describe('liveText', () => {
  it('puts what earlier sessions settled first, then this session, then the guess', () => {
    expect(liveText('Uzair ko', [{ transcript: ' paanch hazaar', isFinal: true }, { transcript: 'diye', isFinal: false }]))
      .toEqual({ final: 'Uzair ko paanch hazaar', interim: 'diye' });
  });
  it('is empty before anything is heard', () => {
    expect(liveText('', [])).toEqual({ final: '', interim: '' });
  });
});

describe('startLive', () => {
  it('says so, and shows nothing, where the browser has no speech recognition', () => {
    const states: string[] = [];
    const s = startLive(() => {}, st => states.push(st));
    expect(states).toEqual(['unsupported']);
    expect(s.stop()).toBe('');
  });
});
