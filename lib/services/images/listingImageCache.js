/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import SqliteConnection from '../storage/SqliteConnection.js';
import logger from '../logger.js';
import { detectImageMimeType } from './imageFormat.js';

/**
 * A listing photo has no business exceeding this; anything bigger is refused rather than stored.
 * @type {number}
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** How long a download may take before it is abandoned. @type {number} */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * A real browser UA. Some portals serve a different (or no) image to clients that identify as bots.
 * @type {string}
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Download `imageUrl` and return it as a mime-typed buffer, or null when the download failed or the
 * response isn't a recognized image format. Never throws - a broken photo must never take down the
 * crawl that is trying to cache it.
 *
 * @param {string} imageUrl
 * @returns {Promise<{data: Buffer, mimeType: string}|null>}
 */
async function downloadImage(imageUrl) {
  let response;
  try {
    response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'image/jpeg,image/png,image/webp,image/gif,image/*,*/*',
      },
    });
  } catch (err) {
    logger.debug(`Could not download listing image '${imageUrl}': ${err.message}`);
    return null;
  }

  if (!response.ok) {
    logger.debug(`Listing image fetch returned HTTP ${response.status} for '${imageUrl}'`);
    return null;
  }

  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_IMAGE_BYTES) {
    logger.debug(`Listing image '${imageUrl}' exceeds the ${MAX_IMAGE_BYTES}-byte cache limit, skipping`);
    return null;
  }

  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    logger.debug(`Could not read listing image body for '${imageUrl}': ${err.message}`);
    return null;
  }

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    logger.debug(`Downloaded listing image '${imageUrl}' exceeds the ${MAX_IMAGE_BYTES}-byte cache limit, skipping`);
    return null;
  }

  const headerMimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const mimeType = detectImageMimeType(buffer, headerMimeType);
  if (!mimeType) {
    logger.debug(`Listing image '${imageUrl}' is not a recognized image format, skipping`);
    return null;
  }

  return { data: buffer, mimeType };
}

/**
 * Cache a listing's image the first time it is seen, and never again.
 *
 * This is the whole fallback guarantee: a portal that later rotates in a different photo, or a
 * generic placeholder, at the exact same URL cannot touch what Fredy already has, because nothing
 * here ever re-fetches once a row exists for that listing. Some WordPress-based portals (Frohe
 * Zukunft is the confirmed case) do exactly that between crawls.
 *
 * Silently does nothing when the listing has no image URL, already has a cached image, or the
 * download fails for any reason - caching a photo must never be able to fail a crawl run.
 *
 * @param {string} listingId The DB row id (not the provider hash).
 * @param {string|null|undefined} imageUrl The URL scraped for this listing.
 * @returns {Promise<void>}
 */
export async function cacheListingImageIfMissing(listingId, imageUrl) {
  if (!listingId || !imageUrl) return;

  try {
    const alreadyCached = SqliteConnection.query(`SELECT 1 FROM listing_image_cache WHERE listing_id = @listingId`, {
      listingId,
    })[0];
    if (alreadyCached) return;

    const image = await downloadImage(imageUrl);
    if (!image) return;

    // ON CONFLICT DO NOTHING rather than assuming the row is still missing: two jobs can discover
    // and store the same new listing id in close succession, and the second download must not
    // clobber the first, for exactly the same reason a re-crawl must not.
    SqliteConnection.execute(
      `INSERT INTO listing_image_cache (listing_id, data, mime_type, source_url, cached_at)
       VALUES (@listingId, @data, @mimeType, @sourceUrl, @cachedAt)
       ON CONFLICT(listing_id) DO NOTHING`,
      { listingId, data: image.data, mimeType: image.mimeType, sourceUrl: imageUrl, cachedAt: Date.now() },
    );
  } catch (err) {
    // A crawl run must survive this no matter what goes wrong - a locked database, a missed
    // migration, anything. Losing a photo is recoverable; losing a whole run of new listings is not.
    logger.debug(`Could not cache image for listing '${listingId}': ${err.message}`);
  }
}

/**
 * Force-replace whatever is cached for a listing, or cache it for the first time.
 *
 * The escape hatch for the one failure mode {@link cacheListingImageIfMissing} cannot fix on its
 * own: the very first crawl happening to catch a placeholder before a real photo ever existed. Meant
 * to run only for a single listing, at a user's explicit request - never from the crawl pipeline.
 *
 * @param {string} listingId
 * @param {string} imageUrl
 * @returns {Promise<boolean>} Whether a new image was downloaded and stored.
 */
export async function refreshListingImage(listingId, imageUrl) {
  if (!listingId || !imageUrl) return false;

  const image = await downloadImage(imageUrl);
  if (!image) return false;

  SqliteConnection.execute(
    `INSERT INTO listing_image_cache (listing_id, data, mime_type, source_url, cached_at)
     VALUES (@listingId, @data, @mimeType, @sourceUrl, @cachedAt)
     ON CONFLICT(listing_id) DO UPDATE SET
       data = excluded.data,
       mime_type = excluded.mime_type,
       source_url = excluded.source_url,
       cached_at = excluded.cached_at`,
    { listingId, data: image.data, mimeType: image.mimeType, sourceUrl: imageUrl, cachedAt: Date.now() },
  );
  return true;
}

/**
 * The cached image for a listing, if any.
 *
 * @param {string} listingId
 * @returns {{data: Buffer, mimeType: string}|null}
 */
export function getCachedListingImage(listingId) {
  if (!listingId) return null;
  const row = SqliteConnection.query(
    `SELECT data, mime_type AS mimeType FROM listing_image_cache WHERE listing_id = @listingId`,
    { listingId },
  )[0];
  return row ? { data: row.data, mimeType: row.mimeType } : null;
}
