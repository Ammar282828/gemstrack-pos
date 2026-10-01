import { describe, expect, it } from 'vitest';
import { itemPhotoRef, splitItemPhotos } from './order-photos';

describe('order photos out of the order', () => {
  it('moves inline photos to their own documents and leaves URLs and moved photos alone', () => {
    let n = 0;
    const { items, photos } = splitItemPhotos([
      { description: 'Ring', sampleImageDataUri: 'data:image/jpeg;base64,AAA' },
      { description: 'Stock piece', sampleImageDataUri: 'https://cdn/x.jpg' },
      { description: 'Moved', samplePhotoId: 'photo-old' },
      { description: 'None' },
    ], () => `p${++n}`);
    expect(photos).toEqual([{ id: 'p1', dataUri: 'data:image/jpeg;base64,AAA' }]);
    expect(items).toEqual([
      { description: 'Ring', samplePhotoId: 'p1' },
      { description: 'Stock piece', sampleImageDataUri: 'https://cdn/x.jpg' },
      { description: 'Moved', samplePhotoId: 'photo-old' },
      { description: 'None' },
    ]);
  });
  it('a new photo replaces the old id', () => {
    const { items } = splitItemPhotos([{ samplePhotoId: 'photo-old', sampleImageDataUri: 'data:x' }], () => 'p-new');
    expect(items).toEqual([{ samplePhotoId: 'p-new' }]);
  });
  it('readers take either shape', () => {
    expect(itemPhotoRef({ sampleImageDataUri: 'data:x' })).toEqual({ src: 'data:x' });
    expect(itemPhotoRef({ samplePhotoId: 'p1' })).toEqual({ id: 'p1' });
    expect(itemPhotoRef({})).toEqual({});
  });
});
