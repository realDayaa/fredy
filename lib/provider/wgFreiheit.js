/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.wgfreiheit.de';

/**
 * @param {string|null|undefined} link
 * @returns {string|null}
 */
function toAbsoluteLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `${BASE_URL}/${link.replace(/^\/+/, '')}`;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = toAbsoluteLink(o.link);
  const title = o.title;

  return {
    id: buildHash(o.link, o.price),
    title,
    link,
    // The search results only carry the street (folded into the title, e.g. "1-Raum-Wohnung
    // Karpfenweg 18") and no separate address field, so the title itself is the best address text
    // available for geocoding.
    address: title ? `${title}, Halle (Saale)` : null,
    image: null,
    size: extractNumber(o.size),
    rooms: extractNumber(o.rooms),
    price: extractNumber(o.price),
  };
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList Terms the job wants filtered out.
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList) {
  return o.title != null && !isOneOf(o.title, appliedBlackList) && !isOneOf(o.description, appliedBlackList);
}

/** @type {ProviderConfig} */
const config = {
  url: null,
  crawlContainer: '#objectlist .list.residenzen > .listitem',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: '.text .title a@href',
    title: '.text .title a | trim',
    link: '.text .title a@href',
    rooms: '.anzahl_zimmer .sortRooms | trim',
    size: '.wohnflaeche .sortSize | trim',
    price: '.nettokaltmiete .sortPrice | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  name: 'WG Freiheit Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'wgFreiheit',
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
 * @returns {ProviderConfig} A configuration usable by a single pipeline run.
 */
export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export { config };
