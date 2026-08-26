/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.wohnen-halle.de';

/**
 * The figures carry a German label ("Gesamtmiete:  537 €", "Zimmer:  3", "Größe:  57,22 m²"), so
 * the number is pulled out with a search rather than a leading-anchored parse.
 * @param {string|null|undefined} value
 * @returns {number|null}
 */
function firstNumber(value) {
  if (value == null) return null;
  const match = value.match(/[\d.,]+/);
  return match ? extractNumber(match[0]) : null;
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
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    id: buildHash(o.link, o.price),
    title: o.title,
    link: toAbsoluteLink(o.link),
    address: o.address,
    image: toAbsoluteLink(o.image),
    size: firstNumber(o.size),
    rooms: firstNumber(o.rooms),
    price: firstNumber(o.price),
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
  // The Contao EstateManager list module renders a full, unfiltered result set on a plain GET to
  // /suchergebnisse - the on-page filter form only narrows it down further via a POST that stores
  // the criteria in the visitor's session, which a stateless per-run scrape cannot rely on anyway.
  crawlContainer: '.result-list .real_estate_item_default',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: '.main-image a@href',
    link: '.main-image a@href',
    title: '.details-inside .title | trim',
    address: '.details-inside .address | trim',
    image: '.main-image img@src',
    rooms: '.hwg-room | trim',
    size: '.hwg-size | trim',
    price: '.hwg-price | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'HWG Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'hwg',
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
