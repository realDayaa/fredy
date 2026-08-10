/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * LEUWO (Leipziger Wohnungsgenossenschaft) provider using the site's IVM Professional backend.
 *
 * The public search page (https://www.leuwo.de/objekte/) renders its results entirely client-side:
 * the page embeds a short-lived bearer token (`var sToken = '...'`) and JS then POSTs it to
 * `https://leuwo.ivm-professional.de/interface/v1.0/objects/getSearch.json` to fetch the actual
 * listings as JSON. getListings() replicates exactly that: fetch the page for a fresh token, then
 * query the API directly - which is both cheaper and far more reliable than driving a browser
 * through the client-side search widget.
 */

import { buildHash, isOneOf } from '../utils.js';
import logger from '../services/logger.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.leuwo.de';
const API_URL = 'https://leuwo.ivm-professional.de/interface/v1.0/objects/getSearch.json';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// Safety backstop against an API that never reports the last page - costs one extra request per
// loop, never a target to reach in practice for a single city's worth of listings.
const MAX_PAGES = 20;

/**
 * Scrape the short-lived bearer token the search widget uses to call the IVM Professional API.
 * @param {string} pageUrl
 * @returns {Promise<string|null>}
 */
async function fetchToken(pageUrl) {
  const response = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    logger.error(`LEUWO: could not load ${pageUrl} to obtain a search token (${response.status}).`);
    return null;
  }
  const html = await response.text();
  // The page embeds the same assignment twice (once live, once commented out further down), so
  // the first match is taken deliberately rather than requiring uniqueness.
  const match = html.match(/var\s+sToken\s*=\s*'([^']+)'/);
  return match ? match[1] : null;
}

/**
 * Fetch every listing for Halle (Saale) from the IVM Professional search API, paginating until the
 * API reports no further pages.
 *
 * `this` is bound to the FredyPipelineExecutioner instance by the pipeline, but this provider needs
 * nothing from it - the page to scrape the token from is fixed, independent of the job's configured
 * URL.
 *
 * @returns {Promise<any[]>}
 */
async function getListings() {
  const tokenPageUrl = `${BASE_URL}/objekte/`;
  const token = await fetchToken(tokenPageUrl);
  if (!token) return [];

  const listings = [];
  let page = 1;
  // Assigned inside the loop before the `while` condition reads it - the loop body always runs
  // at least once (do/while), so there is no iteration where this is read uninitialized.
  let totalPages;

  do {
    const body = new URLSearchParams();
    body.append('district_citys[]', 'Halle');
    body.set('limit', '100');
    body.set('page', String(page));

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Origin: BASE_URL,
        Referer: tokenPageUrl,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': USER_AGENT,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      logger.error(`LEUWO: search API responded with ${response.status} on page ${page}.`);
      break;
    }

    const json = await response.json();
    const data = json?.result?.data;
    if (!data) break;

    totalPages = Number(data.pages) || 1;
    listings.push(...Object.values(data.objects || {}));
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);

  return listings;
}

/**
 * @param {any} o
 * @returns {string|null}
 */
function buildAddress(o) {
  const street = [o.streetname, o.streetnr].filter(Boolean).join(' ').trim();
  const cityLine = [o.zip, o.city].filter(Boolean).join(' ').trim();
  return [street, cityLine].filter(Boolean).join(', ') || null;
}

/**
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const price = toNumber(o?.prices?.rent);
  const description = [o.floor ? `Etage: ${o.floor}` : null, o.free_date ? `Verfügbar ab: ${o.free_date}` : null]
    .filter(Boolean)
    .join('\n');

  return {
    id: buildHash(String(o.id ?? ''), String(price ?? '')),
    title: o?.expose?.title ?? null,
    link: o.id != null ? `${BASE_URL}/objektdetail?dID=${o.id}` : null,
    address: buildAddress(o),
    image: o?.image?.url ?? null,
    size: toNumber(o.space),
    rooms: toNumber(o.rooms),
    price,
    latitude: toNumber(o?.geoposition?.latitude),
    longitude: toNumber(o?.geoposition?.longitude),
    description: description || undefined,
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
  crawlFields: {
    id: 'id',
    title: 'expose.title',
    price: 'prices.rent',
    size: 'space',
    rooms: 'rooms',
    address: 'streetname',
    image: 'image.url',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  getListings,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  name: 'LEUWO',
  baseUrl: `${BASE_URL}/`,
  id: 'leuwo',
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
