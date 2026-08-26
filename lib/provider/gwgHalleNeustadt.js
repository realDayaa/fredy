/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.gwg-halle.de';

/**
 * @param {string|null|undefined} link
 * @returns {string|null}
 */
function toAbsoluteLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : `${BASE_URL}/${link.replace(/^\/+/, '')}`;
}

/**
 * The street span carries a trailing "&middot;" separator meant for the postal code that follows
 * it visually on the card (e.g. "Azaleenstraße 35 ·"); it has to go before the street becomes part
 * of an address string, or the dot ends up sitting right after the house number.
 *
 * @param {string|null|undefined} street
 * @returns {string|null}
 */
function cleanStreet(street) {
  if (street == null) return null;
  return street.replace(/·/g, '').trim() || null;
}

/**
 * Builds a "Street Nr, PLZ City" address for geocoding. The card also exposes a district (e.g.
 * "Nördliche Neustadt"), but it is left out here: Nominatim reliably resolves street + postal
 * code, while adding a district name on top has been observed to break the same query (see the
 * immowelt provider for the investigation this mirrors).
 *
 * @param {{street?: string|null, postalCode?: string|null, city?: string|null}} o
 * @returns {string|null}
 */
export function buildAddress({ street, postalCode, city }) {
  const cleanedStreet = cleanStreet(street);
  const tail = [postalCode, city].filter(Boolean).join(' ');
  return [cleanedStreet, tail].filter(Boolean).join(', ') || null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = toAbsoluteLink(o.link);
  return {
    id: buildHash(o.link, o.price),
    title: o.title,
    link,
    address: buildAddress(o),
    image: toAbsoluteLink(o.image),
    size: extractNumber(o.size),
    rooms: extractNumber(o.rooms),
    price: extractNumber(o.price),
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
  crawlContainer: '.ce-estate-search__card',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: 'a@href',
    link: 'a@href',
    title: '.ce-estate-search__card__content__title | trim',
    street: '.ce-estate-search__card__content__streetAddress | trim',
    postalCode: '.ce-estate-search__card__content__postalCode | trim',
    city: '.ce-estate-search__card__content__city | trim',
    price: '.ce-estate-search__card__content__rent | trim',
    rooms: '.ce-estate-search__card__content__rooms | trim',
    size: '.ce-estate-search__card__content__floorsize | trim',
    image: '.ce-estate-search__card__image img@src',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'GWG Halle-Neustadt',
  baseUrl: `${BASE_URL}/`,
  id: 'gwgHalleNeustadt',
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
