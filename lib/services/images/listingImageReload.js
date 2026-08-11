/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getProviders } from '../../utils.js';
import { updateListingImageUrl } from '../storage/listingsStorage.js';
import { refreshListingImage } from './listingImageCache.js';
import logger from '../logger.js';

/**
 * Re-download a listing's image, first asking the source portal for a current URL when the
 * provider knows how to find one.
 *
 * Some portals (Frohe Zukunft's WordPress/MIA-import setup is the confirmed case) periodically
 * re-import their whole media library under a new hashed directory, which leaves every
 * previously-scraped `image_url` dead - the filename survives, the folder around it does not.
 * Simply re-fetching the stored URL downloads that dead end forever; getting a real photo means
 * going back to the listing's live page and reading off wherever it lives now.
 *
 * Providers that need this export an optional `rediscoverImage(listing)` on their static config
 * (see `lib/types/providerConfig.js`). Providers without one - most of them, since a stable image
 * URL is the common case - fall straight back to the already-stored URL, which is exactly what
 * {@link module:listingImageCache.refreshListingImage} has always done on its own.
 *
 * @param {{id: string, provider: string, link: string|null, image_url: string|null}} listing
 * @returns {Promise<boolean>} Whether a new image was downloaded and cached.
 */
export async function reloadListingImageFromSource(listing) {
  if (!listing?.id) return false;

  let freshUrl = null;
  try {
    const providers = await getProviders();
    const providerModule = providers.find((p) => p.metaInformation?.id === listing.provider);
    if (typeof providerModule?.config?.rediscoverImage === 'function') {
      freshUrl = await providerModule.config.rediscoverImage(listing);
    }
  } catch (err) {
    logger.debug(`Could not rediscover a fresh image URL for listing '${listing.id}': ${err.message}`);
  }

  const urlToTry = freshUrl || listing.image_url;
  if (!urlToTry) return false;

  // Recorded so the stored URL stops 404/301-ing for everyone else too - the default hotlink
  // fallback in the image route, notifications, the MCP photo tool - not just this one refresh.
  if (freshUrl && freshUrl !== listing.image_url) {
    updateListingImageUrl(listing.id, freshUrl);
  }

  return refreshListingImage(listing.id, urlToTry);
}
