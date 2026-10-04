import { describe, expect, it } from 'vitest';
import { groupSends, titleOf } from './sent-log';

describe('titleOf', () => {
  it('takes the bold name from the caption', () => {
    expect(titleOf({ caption: '✨ *Open Loop Bead Bracelet* — _21K Yellow Gold_\n\nA fine…' })).toBe('Open Loop Bead Bracelet');
  });
  it('falls back to the first line, then the file name in words', () => {
    expect(titleOf({ caption: '✨ Bangles\nmore' })).toBe('Bangles');
    expect(titleOf({ caption: '', fileName: 'men-s-ruby-rings.jpg' })).toBe('Men s ruby rings');
    expect(titleOf({})).toBe('');
  });
});

describe('groupSends', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 3, 8, m)).toISOString();

  it('one line per piece, with every place it went, newest first', () => {
    const got = groupSends([
      { at: at(17), destination: 'whatsapp-community', sitePiece: 'Wristwear/Bracelet/A.webp', caption: '✨ *A*' },
      { at: at(17), destination: 'whatsapp-channel', sitePiece: 'Wristwear/Bracelet/A.webp', caption: '✨ *A*' },
      { at: at(18), destination: 'whatsapp-community', sitePiece: 'Wristwear/Bracelet/B.webp', caption: '✨ *B*' },
      { at: at(18), destination: 'whatsapp-channel', sitePiece: 'Wristwear/Bracelet/B.webp', caption: '✨ *B*' },
    ]);
    expect(got.map(g => g.title)).toEqual(['B', 'A']);
    expect(got[1]).toMatchObject({ sitePiece: 'Wristwear/Bracelet/A.webp', destinations: ['whatsapp-community', 'whatsapp-channel'] });
  });

  it('the same piece sent again later is a second line', () => {
    const got = groupSends([
      { at: at(0), destination: 'whatsapp-community', sitePiece: 'x', caption: '*X*' },
      { at: at(45), destination: 'whatsapp-community', sitePiece: 'x', caption: '*X*' },
    ]);
    expect(got).toHaveLength(2);
  });

  it('an Instagram story joins the send beside it, or stands alone', () => {
    const got = groupSends([
      { at: at(18), destination: 'whatsapp-community', fileName: 'sapphire-platinum.jpg', caption: '✨ *Sapphire & Platinum*' },
      { at: at(19), destination: 'instagram-story' },
      { at: at(50), destination: 'instagram-story' },
    ]);
    expect(got).toHaveLength(2);
    expect(got[1]).toMatchObject({ title: 'Sapphire & Platinum', destinations: ['whatsapp-community', 'instagram-story'] });
    expect(got[0]).toMatchObject({ title: '', destinations: ['instagram-story'] });
  });

  it('queue sends gather by their queue entry', () => {
    const got = groupSends([
      { at: at(1), destination: 'whatsapp-community', queue: 'q1', fileName: 'ring.jpg', caption: '*Ring*' },
      { at: at(1), destination: 'whatsapp-community', queue: 'q1', fileName: 'ring-2.jpg', caption: '' },
    ]);
    expect(got).toEqual([{ key: 'queue:q1', at: at(1), title: 'Ring', destinations: ['whatsapp-community'] }]);
  });
});
