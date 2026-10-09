import { describe, expect, it } from 'vitest';
import { maisonBatchNames, maisonTrayProblem } from './maison-batch';

describe('maisonBatchNames', () => {
  it('names each photo "<House> — <Model>" and numbers a second photo of the same piece', () => {
    expect(maisonBatchNames([
      { house: 'Cartier', model: 'LOVE Bracelet, Classic', ext: 'heic' },
      { house: 'Cartier', model: 'love bracelet, classic ', ext: 'jpg' },
      { house: 'Tiffany & Co.', model: 'Tiffany T Wire Bracelet', ext: 'jpeg' },
      { house: 'Cartier', model: 'LOVE Bracelet, Classic', ext: 'png' },
    ])).toEqual([
      'Cartier — LOVE Bracelet, Classic.heic',
      'Cartier — love bracelet, classic 2.jpg',
      'Tiffany and Co — Tiffany T Wire Bracelet.jpeg',
      'Cartier — LOVE Bracelet, Classic 3.png',
    ]);
  });

  it('a different house with the same model name is a different piece', () => {
    expect(maisonBatchNames([
      { house: 'Chanel', model: 'Classic Bangle' },
      { house: 'Dior', model: 'Classic Bangle' },
    ])).toEqual(['Chanel — Classic Bangle.jpg', 'Dior — Classic Bangle.jpg']);
  });

  it('an empty tray names nothing', () => {
    expect(maisonBatchNames([])).toEqual([]);
  });
});

describe('maisonTrayProblem', () => {
  it('asks for a house from the list and a name on every photo', () => {
    expect(maisonTrayProblem([{ house: 'Cartier', model: 'LOVE Bracelet' }])).toBeNull();
    expect(maisonTrayProblem([{ house: 'Cartier', model: '  ' }])).toBe('1 photograph still needs a house and the model’s official name.');
    expect(maisonTrayProblem([{ house: 'Some House', model: 'A Ring' }, { house: '', model: '' }]))
      .toBe('2 photographs still need a house and the model’s official name.');
  });
});
