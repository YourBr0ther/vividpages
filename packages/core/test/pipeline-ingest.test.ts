import { describe, expect, it } from 'vitest';

import { extensionForMediaType } from '../src/pipeline/ingest';

describe('extensionForMediaType', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/svg+xml', 'svg'],
    ['image/avif', 'avif'],
  ])('maps %s -> %s', (mediaType, ext) => {
    expect(extensionForMediaType(mediaType)).toBe(ext);
  });

  it('is case-insensitive and ignores parameters and padding', () => {
    expect(extensionForMediaType('IMAGE/JPEG')).toBe('jpg');
    expect(extensionForMediaType('image/png; charset=binary')).toBe('png');
    expect(extensionForMediaType('  image/webp  ')).toBe('webp');
  });

  it('falls back to the sanitized subtype for unknown types', () => {
    expect(extensionForMediaType('image/x-foo')).toBe('xfoo');
    expect(extensionForMediaType('image/jxl')).toBe('jxl');
  });

  it('falls back to img when the subtype is missing or unusable', () => {
    expect(extensionForMediaType('image')).toBe('img');
    expect(extensionForMediaType('image/')).toBe('img');
    expect(extensionForMediaType('image/???')).toBe('img');
  });
});
