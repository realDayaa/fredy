/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { up } from '../../lib/services/storage/migrations/sql/32.listing-image-cache.js';

/**
 * The cache is a child table so that every existing way of removing a listing - the retention
 * purge, deleting a job, the demo cleanup - disposes of the cached image without knowing this
 * feature exists. That only holds if the foreign key is declared and enforced, which is what most
 * of this suite is about.
 */
describe('migration 32 - listing image cache', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE listings (id TEXT PRIMARY KEY)`);
    db.prepare(`INSERT INTO listings (id) VALUES ('l1')`).run();
  });

  afterEach(() => db.close());

  const addImage = (listingId, data = Buffer.from([1, 2, 3])) =>
    db
      .prepare(
        `INSERT INTO listing_image_cache (listing_id, data, mime_type, source_url, cached_at)
         VALUES (?, ?, 'image/jpeg', 'https://example.com/a.jpg', 0)`,
      )
      .run(listingId, data);

  it('creates the table', () => {
    up(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'listing_image_cache'`).get()).toBeTruthy();
  });

  it('takes the cached image with the listing it belongs to', () => {
    up(db);
    addImage('l1');

    db.prepare(`DELETE FROM listings WHERE id = 'l1'`).run();

    expect(db.prepare(`SELECT COUNT(1) AS n FROM listing_image_cache`).get().n).toBe(0);
  });

  it('refuses a row for a listing that does not exist', () => {
    up(db);
    expect(() => addImage('nope')).toThrow();
  });

  it('allows only one cached image per listing', () => {
    up(db);
    addImage('l1');
    expect(() => addImage('l1')).toThrow();
  });

  it('is safe to run again', () => {
    up(db);
    addImage('l1');

    expect(() => up(db)).not.toThrow();
    expect(db.prepare(`SELECT COUNT(1) AS n FROM listing_image_cache`).get().n).toBe(1);
  });
});
