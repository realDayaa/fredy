/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * The cache writes plain SQL, so the test backs the mocked SqliteConnection with a real
 * in-memory database instead of asserting on statement strings.
 */
let db;

vi.mock('../../../lib/services/storage/SqliteConnection.js', () => ({
  default: {
    execute: (sql, params = {}) => db.prepare(sql).run(params),
    query: (sql, params = {}) => db.prepare(sql).all(params),
    withTransaction: (callback) => db.transaction((cb) => cb(db))(callback),
  },
}));
vi.mock('../../../lib/services/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

/** A valid-enough JPEG buffer, distinguishable by a trailing marker byte. */
function fakeJpeg(marker) {
  return Buffer.from([...JPEG_HEADER, marker]);
}

function mockResponse({ ok = true, status = 200, body, contentType = 'image/jpeg', contentLength } = {}) {
  return {
    ok,
    status,
    headers: {
      get: (name) => {
        if (name === 'content-type') return contentType;
        if (name === 'content-length') return contentLength != null ? String(contentLength) : null;
        return null;
      },
    },
    arrayBuffer: async () => body,
  };
}

describe('listingImageCache', () => {
  let cacheListingImageIfMissing, refreshListingImage, getCachedListingImage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE listings (id TEXT PRIMARY KEY);
      CREATE TABLE listing_image_cache (
        listing_id TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        data       BLOB NOT NULL,
        mime_type  TEXT NOT NULL,
        source_url TEXT,
        cached_at  INTEGER NOT NULL
      );
    `);
    db.prepare(`INSERT INTO listings (id) VALUES ('l1')`).run();

    vi.stubGlobal('fetch', vi.fn());

    ({ cacheListingImageIfMissing, refreshListingImage, getCachedListingImage } =
      await import('../../../lib/services/images/listingImageCache.js'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it('downloads and stores the image the first time it sees a listing', async () => {
    fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(1) }));

    await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

    const cached = getCachedListingImage('l1');
    expect(cached).not.toBeNull();
    expect(cached.mimeType).toBe('image/jpeg');
    expect(cached.data.equals(fakeJpeg(1))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never re-fetches or overwrites an already-cached image - the core fallback guarantee', async () => {
    fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(1) }));
    await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

    // A later crawl finds the same URL now serving a rotated/placeholder image.
    fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(99) }));
    await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCachedListingImage('l1').data.equals(fakeJpeg(1))).toBe(true);
  });

  it('does nothing without a listing id or an image url', async () => {
    await cacheListingImageIfMissing(null, 'https://example.com/photo.jpg');
    await cacheListingImageIfMissing('l1', null);

    expect(fetch).not.toHaveBeenCalled();
    expect(getCachedListingImage('l1')).toBeNull();
  });

  it('does not throw and caches nothing when the download fails', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'));

    await expect(cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg')).resolves.toBeUndefined();
    expect(getCachedListingImage('l1')).toBeNull();
  });

  it('caches nothing on a non-ok HTTP response', async () => {
    fetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, body: fakeJpeg(1) }));

    await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

    expect(getCachedListingImage('l1')).toBeNull();
  });

  it('refuses an image larger than the cache limit', async () => {
    fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(1), contentLength: 50 * 1024 * 1024 }));

    await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

    expect(getCachedListingImage('l1')).toBeNull();
  });

  it('refuses a download that is not a recognized image format', async () => {
    fetch.mockResolvedValueOnce(
      mockResponse({ body: Buffer.from('not an image, just some html'), contentType: 'text/html' }),
    );

    await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

    expect(getCachedListingImage('l1')).toBeNull();
  });

  describe('refreshListingImage', () => {
    it('replaces an already-cached image on explicit request', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(1) }));
      await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

      fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(2) }));
      const refreshed = await refreshListingImage('l1', 'https://example.com/photo.jpg');

      expect(refreshed).toBe(true);
      expect(getCachedListingImage('l1').data.equals(fakeJpeg(2))).toBe(true);
    });

    it('leaves the existing image alone when the refresh download fails', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ body: fakeJpeg(1) }));
      await cacheListingImageIfMissing('l1', 'https://example.com/photo.jpg');

      fetch.mockRejectedValueOnce(new Error('network down'));
      const refreshed = await refreshListingImage('l1', 'https://example.com/photo.jpg');

      expect(refreshed).toBe(false);
      expect(getCachedListingImage('l1').data.equals(fakeJpeg(1))).toBe(true);
    });
  });
});
