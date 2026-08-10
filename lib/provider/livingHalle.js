/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.living-halle.de';

/**
 * The card's feature list has no street - only "<PLZ> <City>" - sitting between the object type
 * and the next known label ("Wohnfläche", "Grundstücksgröße" or "Anzahl Zimmer" - some commercial
 * listings skip straight to "Anzahl Zimmer" with no living-space figure at all). Whichever of the
 * three shows up first ends the address; when none of them do, the match runs to the end of the
 * (already trimmed) text.
 *
 * @param {string|null|undefined} features the card's combined feature-list text
 * @returns {string|null}
 */
export function extractAddress(features) {
  if (features == null) return null;
  const match = features.match(/(\d{5}\s+.+?)(?=\s+(?:Wohnfläche|Grundstücksgröße|Anzahl)|$)/);
  return match ? match[1].trim() : null;
}

/**
 * @param {string|null|undefined} features
 * @returns {number|null}
 */
export function extractSize(features) {
  if (features == null) return null;
  const match = features.match(/Wohnfläche:\s*(?:ca\.\s*)?([\d.,]+)/);
  return match ? extractNumber(match[1]) : null;
}

/**
 * @param {string|null|undefined} features
 * @returns {number|null}
 */
export function extractRooms(features) {
  if (features == null) return null;
  const match = features.match(/Anzahl Zimmer:\s*([\d.,]+)/);
  return match ? extractNumber(match[1]) : null;
}

/**
 * The footer carries up to two figures - Warmmiete (all-in) and Kaltmiete (base rent), either of
 * which may be missing on its own - concatenated into one string by the crawl selector matching
 * both `.c-property-card__price` blocks. Kaltmiete is preferred so the figure is comparable with
 * the Kalt/Warm distinction other German-portal providers already use.
 *
 * @param {string|null|undefined} priceBlock
 * @returns {number|null}
 */
export function extractPrice(priceBlock) {
  if (priceBlock == null) return null;
  const kalt = priceBlock.match(/Kaltmiete:\s*([\d.,]+)/);
  if (kalt) return extractNumber(kalt[1]);
  const warm = priceBlock.match(/Warmmiete:\s*([\d.,]+)/);
  return warm ? extractNumber(warm[1]) : null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    id: buildHash(o.link, o.title),
    title: o.title,
    link: o.link,
    address: extractAddress(o.features),
    image: o.image,
    size: extractSize(o.features),
    rooms: extractRooms(o.features),
    price: extractPrice(o.priceBlock),
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
  crawlContainer: '.c-property-card',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: '.c-property-card__button@href',
    link: '.c-property-card__button@href',
    title: '.c-property-card__title | trim',
    features: '.c-property-card__features | trim',
    priceBlock: '.c-property-card__price | trim',
    image: 'img@src',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  name: 'living halle',
  baseUrl: `${BASE_URL}/`,
  id: 'livingHalle',
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
