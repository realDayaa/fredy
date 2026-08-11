/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { detectImageMimeType } from '../../../lib/services/images/imageFormat.js';

describe('detectImageMimeType', () => {
  it('trusts a supported header mime type without sniffing bytes', () => {
    const bytes = Buffer.from('not actually an image, but header says jpeg');
    expect(detectImageMimeType(bytes, 'image/jpeg')).toBe('image/jpeg');
  });

  it('sniffs JPEG from its magic bytes when the header is missing or generic', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMimeType(bytes, 'application/octet-stream')).toBe('image/jpeg');
  });

  it('sniffs PNG from its magic bytes', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageMimeType(bytes, '')).toBe('image/png');
  });

  it('sniffs GIF from its magic bytes', () => {
    const bytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMimeType(bytes, '')).toBe('image/gif');
  });

  it('sniffs WEBP from its RIFF/WEBP magic bytes', () => {
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectImageMimeType(bytes, '')).toBe('image/webp');
  });

  it('returns null for unrecognized bytes', () => {
    const bytes = Buffer.from('this is definitely not an image file..');
    expect(detectImageMimeType(bytes, '')).toBeNull();
  });

  it('returns null for content shorter than 12 bytes', () => {
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff]), '')).toBeNull();
  });

  it('returns null for empty or missing input', () => {
    expect(detectImageMimeType(null)).toBeNull();
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
  });
});
