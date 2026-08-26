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
 * The search results carry no separate address field - the street lives inside the title, always
 * as "<N>-Raum-Wohnung <Street> <Number>" (e.g. "1-Raum-Wohnung Karpfenweg 18"). That prefix is
 * stripped so the address geocodes on the street alone rather than on "1-Raum-Wohnung ..." text.
 * @param {string|null|undefined} title
 * @returns {string|null}
 */
function streetFromTitle(title) {
  if (title == null) return null;
  return title.replace(/^\d+-Raum-Wohnung\s+/, '').trim() || null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = toAbsoluteLink(o.link);
  const title = o.title;
  const street = streetFromTitle(title);

  return {
    id: buildHash(o.link, o.price),
    title,
    link,
    address: street ? `${street}, Halle (Saale)` : null,
    image: toAbsoluteLink(o.image),
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
    image: '.image img[itemprop="Titelbild"]@src',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
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
