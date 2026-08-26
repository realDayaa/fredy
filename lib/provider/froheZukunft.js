/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as cheerio from 'cheerio';
import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.frohe-zukunft.de';

/** A real browser UA; the theme's media rewrite rules 301 bot-looking requests to the homepage. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Pull one figure out of the concatenated "2 Zimmer 41.12 m² 379.00 €" text by the unit that
 * follows it, rather than by position - garage/parking listings only carry a price and no
 * room/size figures at all, which made positional (nth-child) indexing shift the wrong value into
 * the wrong field.
 *
 * The theme also renders these with a decimal point ("41.12", "379.00") rather than the usual
 * German decimal comma, so the shared `extractNumber` helper (which strips dots as thousand
 * separators) would mangle it - this parses the point as-is instead.
 *
 * @param {string|null|undefined} value The concatenated data__text values for one listing.
 * @param {RegExp} unitPattern Pattern with the number in capture group 1, anchored to its unit.
 * @returns {number|null}
 */
function extractByUnit(value, unitPattern) {
  if (value == null) return null;
  const match = value.match(unitPattern);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return isNaN(num) ? null : num;
}

/**
 * @param {string|null|undefined} link
 * @returns {string|null}
 */
function toAbsoluteLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `${BASE_URL}/${link.replace(/^\/+/, '')}`;
}

/**
 * The card's address reads "<Street Nr>, <District>, <PLZ>". Nominatim resolves "Street, PLZ"
 * reliably but chokes on some district spellings sitting between them - confirmed against the live
 * API, "Emil-Abderhalden-Str. 23, Zentrum / Stadtmitte, 06108" (a compound, slash-separated
 * district) returns zero results while "Emil-Abderhalden-Str. 23, 06108" resolves correctly, the
 * same failure mode already fixed for the immowelt and gwgHalleNeustadt providers. The district is
 * dropped rather than special-cased, since there is no way to know in advance which spellings a
 * future listing will use.
 *
 * @param {string|null|undefined} raw the address text as scraped from the card
 * @returns {string|null}
 */
export function buildGeocodableAddress(raw) {
  if (raw == null) return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return raw;
  const street = parts[0];
  const postalCode = parts[parts.length - 1];
  return /^\d{5}$/.test(postalCode) ? `${street}, ${postalCode}` : raw;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    id: buildHash(o.link, o.price),
    title: o.title,
    link: toAbsoluteLink(o.link),
    address: buildGeocodableAddress(o.address),
    image: o.image,
    size: extractByUnit(o.data, /([\d.]+)\s*m²/),
    rooms: extractByUnit(o.data, /([\d.]+)\s*Zimmer/),
    price: extractByUnit(o.data, /([\d.]+)\s*€/),
  };
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList Terms the job wants filtered out.
 * @param {string[]} appliedBlacklistedDistricts Districts the job wants filtered out.
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList, appliedBlacklistedDistricts) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);
  const isBlacklistedDistrict =
    appliedBlacklistedDistricts.length === 0 ? false : isOneOf(o.address, appliedBlacklistedDistricts);
  return o.title != null && !isBlacklistedDistrict && titleNotBlacklisted && descNotBlacklisted;
}

/**
 * Re-read a stored listing's current photo off its live detail page.
 *
 * The theme's WordPress/MIA-import setup periodically re-imports its whole media library under a
 * fresh hashed directory - confirmed against a live listing whose stored URL had gone dead:
 * `.../mia-import/16d6ad5.../5528484.jpg` had become `.../mia-import/1b526ad.../5528484.jpg` on
 * the live page. The filename survives the re-import, the folder around it does not, so every URL
 * captured at crawl time eventually 301s to the homepage instead of the photo. Simply re-fetching
 * the stored URL - what {@link module:listingImageCache.refreshListingImage} does on its own -
 * downloads that redirect target forever, never the photo.
 *
 * The detail page renders its lead photo with the exact same `.picture__media img` markup the
 * search-results card uses (just without the card's `.picture__link` wrapper), so this is a plain
 * HTTP fetch and a `cheerio` read - no browser needed.
 *
 * @param {{link: string|null}} listing
 * @returns {Promise<string|null>}
 */
async function rediscoverImage(listing) {
  if (!listing?.link) return null;
  try {
    const response = await fetch(listing.link, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const src = cheerio.load(html)('.picture__media img').first().attr('src');
    return src || null;
  } catch {
    return null;
  }
}

/** @type {ProviderConfig} */
const config = {
  url: null,
  crawlContainer: '.products__item',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: '.products__footer a.link[href*="/wohnfinder/"]@href',
    link: '.products__footer a.link[href*="/wohnfinder/"]@href',
    title: '.products__header h3 | trim',
    // Only the first <p> is the address; a garage/parking listing has none of the following
    // siblings, an apartment has a second one for the floor ("5. Etage") that must not be folded
    // into the address text.
    address: '.products__main .wysiwyg p:first-child | trim',
    image: '.picture__link .picture__media img@src',
    data: '.picture__link .data__list.data__infos .data__item .data__text | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
  rediscoverImage,
};

export const metaInformation = {
  countries: ['de'],
  name: 'Frohe Zukunft Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'froheZukunft',
};

/**
 * Build a run-scoped provider configuration.
 *
 * Returns a fresh object on every call instead of mutating module-level state. Two jobs can be in
 * flight at once - a manual run started while the scheduler is working through the others - and a
 * shared mutable config meant the second job overwrote the first job's URL and blacklist mid-run,
 * so listings were fetched for one job and stored under another.
 *
 * @param {{url: string, enabled?: boolean}} sourceConfig The job's entry for this provider.
 * @param {string[]} [blacklist] Terms to filter listings out by.
 * @param {string[]} [blacklistedDistricts] Districts to filter listings out by.
 * @returns {ProviderConfig} A configuration usable by a single pipeline run.
 */
export const createConfig = (sourceConfig, blacklist = [], blacklistedDistricts = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? [], blacklistedDistricts ?? []),
});

export { config };
