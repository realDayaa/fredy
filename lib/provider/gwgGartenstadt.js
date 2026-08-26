/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.gwg-gartenstadt.de';

/**
 * @param {string|null|undefined} link
 * @returns {string|null}
 */
function toAbsoluteLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `${BASE_URL}/${link.replace(/^\/+/, '')}`;
}

/**
 * Contao's customcatalog module renders the price as free text (e.g. "€ 601,12 € + 50,- €
 * Mansarde / Monat"), sometimes with a surcharge appended. Only the first (base Kaltmiete) figure
 * is a stable, comparable number, so that is all normalize() keeps.
 * @param {string|null|undefined} value
 * @returns {number|null}
 */
function firstNumber(value) {
  if (value == null) return null;
  const match = value.match(/[\d.,]+/);
  return match ? extractNumber(match[0]) : null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = toAbsoluteLink(o.link);
  const zip = (o.zip || '').trim();
  const address = [o.title, zip ? `${zip} Halle (Saale)` : 'Halle (Saale)'].filter(Boolean).join(', ');

  return {
    id: buildHash(o.link, o.price),
    title: o.title,
    link,
    image: toAbsoluteLink(o.image),
    address,
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
  crawlContainer: '.mod_customcataloglist.cc_immorealty .entries > .entry',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: '.cc_immorealty_top h4 a@href',
    title: '.cc_immorealty_top h4 a | trim',
    link: '.cc_immorealty_top h4 a@href',
    image: '.cc_immorealty_middle img@src',
    zip: '.property-meta li:nth-child(1) | trim',
    size: '.property-meta li:nth-child(2) | trim',
    rooms: '.property-meta li:nth-child(3) | trim',
    price: '.cc_immorealty_bottom .price | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'GWG Gartenstadt Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'gwgGartenstadt',
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
