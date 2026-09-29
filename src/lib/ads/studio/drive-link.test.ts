import { describe, expect, it } from 'vitest';
import { folderIdOf } from './drive-link';

describe('a Drive folder by its link', () => {
  it('reads the id from the usual links, or takes a bare id', () => {
    expect(folderIdOf('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(folderIdOf('https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(folderIdOf('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(folderIdOf(' 1AbCdEfGhIjKlMnOpQrStUvWxYz012345 ')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  });
  it('refuses what isn’t one', () => {
    expect(folderIdOf('taheri content')).toBeNull();
    expect(folderIdOf('https://example.com/folders/x')).toBeNull();
  });
});
