import { describe, expect, it } from 'vitest';
import { originFromTap, setLastTap } from './tap-origin';

describe('a dialog grows from the tap', () => {
  const box = { left: 100, top: 200, width: 400, height: 300 };
  it('points at the press, in the box\'s own pixels', () => {
    setLastTap({ x: 150, y: 260, t: 1000 });
    expect(originFromTap(box, 1200)).toBe('50px 60px');
  });
  it('keeps a press outside the box on its edge', () => {
    setLastTap({ x: 20, y: 900, t: 1000 });
    expect(originFromTap(box, 1100)).toBe('0px 300px');
  });
  it('grows from the centre when no press came just before', () => {
    setLastTap({ x: 150, y: 260, t: 1000 });
    expect(originFromTap(box, 2500)).toBeNull();
    setLastTap(null);
    expect(originFromTap(box, 1000)).toBeNull();
  });
});
