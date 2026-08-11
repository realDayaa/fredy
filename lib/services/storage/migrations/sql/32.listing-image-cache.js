/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * A place to keep the first photo Fredy ever downloaded for a listing.
 *
 * Some portals do not serve a stable file at a listing's image URL - Frohe Zukunft's WordPress theme
 * is the confirmed case - and can later resolve the very same URL to a rotated photo or a generic
 * placeholder, because the origin regenerates what lives behind it rather than the listing itself
 * changing. Fredy only ever hotlinked `image_url` before this table existed, so the picture a user
 * sees could silently change or degrade to a placeholder long after the listing was found, with
 * nothing in the pipeline aware that anything happened.
 *
 * The fix is to download the bytes once, right when a listing is first stored, and serve that copy
 * forever after - see listingImageCache.js. A child table rather than columns on `listings`, for the
 * same reason as `listing_price_history`: `listings` is read with `SELECT *` on the hottest pages in
 * the app (the table and grid views), and a BLOB column there would ship every cached photo's bytes
 * on every such query. `ON DELETE CASCADE` disposes of a listing's cached image exactly when the
 * listing goes, the same precedent `listing_price_history` and `listing_travel_times` already set.
 *
 * There is deliberately no automatic UPDATE path onto this table - the whole point is that once an
 * image is cached, nothing overwrites it on its own. Only an explicit, user-triggered refresh is
 * allowed to replace it, for the one failure mode the automatic cache cannot fix itself: the very
 * first crawl happening to catch a placeholder before a real photo ever existed.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_image_cache (
      listing_id TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      data       BLOB NOT NULL,
      mime_type  TEXT NOT NULL,
      source_url TEXT,
      cached_at  INTEGER NOT NULL
    )
  `);
}
