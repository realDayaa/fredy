/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { sanitize } from '../utils/priceExtractors.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.haneuer.de';
// Listing links on the card are relative to this directory (e.g. "wg-zimmer-frei/"), not to the
// site root, so the prefix has to include it.
const LIST_PATH = '/mietangebote/';

/**
 * @param {string|null|undefined} link
 * @returns {string|null}
 */
function toAbsoluteLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `${BASE_URL}${LIST_PATH}${link.replace(/^\/+/, '')}`;
}

/**
 * The card's image is a CSS background (`style="background-image: url(...)"`), not an `<img>`, so
 * the URL is pulled out of the raw style attribute. Unlike wgEisenbahn's version of this, the URL
 * here is already absolute.
 *
 * @param {string|null|undefined} style
 * @returns {string|null}
 */
function extractBackgroundImageUrl(style) {
  if (style == null) return null;
  const match = style.match(/url\((['"]?)(.*?)\1\)/);
  return match ? match[2] : null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    // The list page carries no separate listing title - haneuer.de uses the street address for
    // that itself, e.g. the exposé's own <h1> is just "Am Kirchteich 5".
    id: buildHash(o.link, o.price),
    title: o.street,
    link: toAbsoluteLink(o.link),
    address: [o.street, o.plzCity].filter(Boolean).join(', ') || null,
    image: extractBackgroundImageUrl(o.image),
    // Prices and areas render as English-decimal ("341.00", "65.41 m²"); extractNumber would treat
    // the dot as a German thousands separator and turn 65.41 m² into 6541.
    size: sanitize(o.size),
    rooms: sanitize(o.rooms),
    price: sanitize(o.price),
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

/** @type {ProviderConfig} */
const config = {
  url: null,
  crawlContainer: '.immo-liste .immo',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: 'a.nlc@href',
    link: 'a.nlc@href',
    street: '.immo-info-left .immo-info-feld:nth-child(1) | trim',
    plzCity: '.immo-info-left .immo-info-feld:nth-child(2) | trim',
    price: '.immo-info-left .immo-info-feld:nth-child(3) | trim',
    rooms: '.immo-info-right .immo-info-feld:nth-child(2) | trim',
    size: '.immo-info-right .immo-info-feld:nth-child(3) | trim',
    image: '.immo-pic-bg@style',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  name: 'HA-NEUer WG',
  baseUrl: `${BASE_URL}/`,
  id: 'haNeuerWg',
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
