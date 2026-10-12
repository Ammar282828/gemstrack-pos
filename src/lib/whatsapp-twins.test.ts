import { describe, expect, it } from 'vitest';
import { communityTwins, twinName, twinOf, type WaGroup } from './whatsapp-twins';

const OLD = '1@g.us', NEW = '2@g.us';
const groups: WaGroup[] = [
  { id: OLD, name: 'Taheri Collections', parent: '', announce: false },
  { id: '10@g.us', name: 'Taheri Collections', parent: OLD, announce: true },
  { id: '11@g.us', name: 'Diamonds by Taheri 💎', parent: OLD, announce: true },
  { id: '12@g.us', name: 'Taheri Exclusives', parent: OLD, announce: false },
  { id: '13@g.us', name: 'Watches by Taheri ⌚️', parent: OLD, announce: true },
  { id: NEW, name: 'Taheri Collections - II', parent: '', announce: false },
  { id: '20@g.us', name: 'Taheri Collections - II', parent: NEW, announce: true },
  { id: '21@g.us', name: 'Diamonds by Taheri II', parent: NEW, announce: true },
  { id: '22@g.us', name: 'taheri exclusives', parent: NEW, announce: false },
  { id: '30@g.us', name: 'Team Taheri', parent: '', announce: false },
];
const twins = communityTwins(`${OLD}=${NEW}, junk=x`);

describe('community twins', () => {
  it('reads the pairs', () => expect([...twins]).toEqual([[OLD, NEW]]));
  it('names ignore emoji, case and a trailing II', () => expect(twinName('Diamonds by Taheri 💎')).toBe(twinName('diamonds by taheri II')));
  it('announcements go to the new announcements', () => expect(twinOf('10@g.us', groups, twins)?.id).toBe('20@g.us'));
  it('a topic group goes to its namesake', () => {
    expect(twinOf('11@g.us', groups, twins)?.id).toBe('21@g.us');
    expect(twinOf('12@g.us', groups, twins)?.id).toBe('22@g.us');
  });
  it('the community maps to the community', () => expect(twinOf(OLD, groups, twins)?.id).toBe(NEW));
  it('nothing until the new community has the group', () => expect(twinOf('13@g.us', groups, twins)).toBeNull());
  it('groups outside the community are left alone', () => {
    expect(twinOf('30@g.us', groups, twins)).toBeNull();
    expect(twinOf('20@g.us', groups, twins)).toBeNull();
  });
});
