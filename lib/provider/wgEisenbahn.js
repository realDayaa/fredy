/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.wgeisenbahn.de';

/**
 * The `<li>` figures carry their label directly against the value with no separator
 * (e.g. "Zimmer<br/>3" becomes the text "Zimmer3" once the `<br/>` is stripped), so the number is
 * pulled out with a search rather than a leading-anchored parse. None of the labels used by this
 * template ("Zimmer", "Wohnfläche", "Kaltmiete") contain digits themselves.
 * @param {string|null|undefined} value
 * @returns {number|null}
 */
function firstNumber(value) {
  if (value == null) return null;
  const match = value.match(/[\d.,]+/);
  return match ? extractNumber(match[0]) : null;
}

/**
 * The card's image is a CSS background (`style="background-image: url('...')"`), not an `<img>`,
 * so the URL is pulled out of the raw style attribute.
 * @param {string|null|undefined} style
 * @returns {string|null}
 */
function extractBackgroundImageUrl(style) {
  if (style == null) return null;
  const match = style.match(/url\((['"]?)(.*?)\1\)/);
  return match ? match[2] : null;
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
    image: toAbsoluteLink(extractBackgroundImageUrl(o.image)),
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
  crawlContainer: '.row.immobilien .card',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: 'a.immoItemLink@href',
    link: 'a.immoItemLink@href',
    title: '.card-body .card-title | trim',
    address: '.card-body .card-text | trim',
    image: '.card__image@style',
    rooms: '.card-body ul li:nth-child(1) | trim',
    size: '.card-body ul li:nth-child(2) | trim',
    price: '.card-body ul li:nth-child(3) | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'WG Eisenbahn Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'wgEisenbahn',
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
