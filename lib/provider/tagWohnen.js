/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://tag-wohnen.de';

/**
 * Marketing copy wraps every headline in decorative asterisks, e.g.
 * "* Südpark * in Renovierung * Sparpreis *". They carry no information the way a real title's
 * punctuation would, so only the outermost pair is trimmed rather than every "*" in the string -
 * doing that would also eat the ones separating the individual selling points in the middle.
 *
 * @param {string|null|undefined} title
 * @returns {string|null}
 */
export function cleanTitle(title) {
  if (title == null) return null;
  return (
    title
      .replace(/^\*+\s*/, '')
      .replace(/\s*\*+$/, '')
      .trim() || null
  );
}

/**
 * The spec list ("Zimmer", "Wohnfläche", "Gesamtmiete") renders as a `<dt>`/`<dd>` pair per figure
 * with no separating whitespace in the markup, so the crawled text is one unbroken string like
 * "Zimmer3Wohnfläche59,09 m2Gesamtmiete474,00 €". Each figure is pulled out by the label that
 * precedes it rather than by position, since a listing missing one (e.g. no room count) would
 * otherwise shift every field after it.
 *
 * @param {string|null|undefined} specs the card's combined spec-list text
 * @param {string} label the German label the figure follows ("Zimmer", "Wohnfläche", "Gesamtmiete")
 * @returns {number|null}
 */
export function extractSpec(specs, label) {
  if (specs == null) return null;
  const match = specs.match(new RegExp(`${label}\\s*([\\d.,]+)`));
  return match ? extractNumber(match[1]) : null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    id: buildHash(o.id, o.price),
    title: cleanTitle(o.title),
    // The site's own "Details" link is built from the same id and is not URL-encoded (a literal
    // "/" sits inside the query value), so this mirrors that instead of guessing at encoding rules
    // for a query string the site itself does not follow.
    link: o.id ? `${BASE_URL}/immosuche/expose?object_id=${o.id}` : null,
    address: o.location,
    image: o.image,
    size: extractSpec(o.specs, 'Wohnfläche'),
    rooms: extractSpec(o.specs, 'Zimmer'),
    price: extractSpec(o.specs, 'Gesamtmiete'),
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
  crawlContainer: '.expose-teaser',
  sortByDateParam: null,
  // The result list is rendered client-side by a React app after the initial document loads, so
  // the crawl has to wait for that XHR round-trip rather than for a fixed selector.
  waitForSelector: 'body',
  puppeteerOptions: {
    puppeteerTimeout: 60_000,
    waitForNetworkIdle: true,
    waitForNetworkIdleTimeout: 60_000,
  },
  crawlFields: {
    id: '@data-id',
    title: '.expose-teaser__headline h3 | trim',
    location: '.expose-teaser__location-text | trim',
    specs: '.expose-teaser__specs | trim',
    // Cards below the fold have not lazy-loaded yet when the crawl runs, so `src` is still empty;
    // `data-src` carries the real URL from the start and is identical to `src` once it does load.
    image: 'img@data-src',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'TAG Wohnen',
  baseUrl: `${BASE_URL}/`,
  id: 'tagWohnen',
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
