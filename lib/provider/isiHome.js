/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { isOneOf, buildHash } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import Extractor from '../services/extractor/extractor.js';
import logger from '../services/logger.js';
import * as cheerio from 'cheerio';

let appliedBlackList = [];
let appliedBlacklistedDistricts = [];
let hasCompletedInitialCrawl = false;

/**
 * Build the URL for a specific page number by inserting /page/N/ before the query string.
 * @param {string} baseUrl
 * @param {number} pageNum
 * @returns {string}
 */
function buildPageUrl(baseUrl, pageNum) {
  const url = new URL(baseUrl);
  const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, '');
  url.pathname = `${pathWithoutTrailingSlash}/page/${pageNum}/`;
  return url.toString();
}

/**
 * Fetch listings from ISI Home.
 * On the first run, all pages are crawled to build the initial listing database.
 * On subsequent runs, only page 1 is fetched since results are sorted by date
 * descending — new listings always appear on page 1.
 *
 * `this` is bound to the FredyPipelineExecutioner instance by the pipeline.
 *
 * @param {string} url The base provider URL (page 1).
 * @returns {Promise<Object[]>} Combined listings from all pages.
 */
async function getListings(url) {
  const allListings = [];
  let pageNum = 1;

  if (hasCompletedInitialCrawl) {
    logger.debug('ISI Home: Subsequent run — fetching page 1 only.');
  } else {
    logger.debug('ISI Home: Initial run — crawling all pages.');
  }

  while (true) {
    const pageUrl = buildPageUrl(url, pageNum);
    logger.debug(`ISI Home: Fetching page ${pageNum} => ${pageUrl}`);

    const extractor = new Extractor({ ...config.puppeteerOptions, browser: this._browser });
    await extractor.execute(pageUrl, config.waitForSelector);

    const listings = extractor.parseResponseText(config.crawlContainer, config.crawlFields, pageUrl);

    if (listings == null || listings.length === 0) {
      logger.debug(`ISI Home: Page ${pageNum} returned no listings. Stopping pagination.`);
      break;
    }

    allListings.push(...listings);
    logger.debug(`ISI Home: Got ${listings.length} listings from page ${pageNum} (total: ${allListings.length})`);

    // After the initial crawl, only page 1 is needed since results are sorted by date.
    if (hasCompletedInitialCrawl) {
      break;
    }

    // Check if there is a "next page" link; if not, this was the last page.
    const hasNextPage =
      extractor.responseText != null && cheerio.load(extractor.responseText)('a.next.page-numbers').length > 0;

    if (!hasNextPage) {
      logger.debug(`ISI Home: No next-page link found on page ${pageNum}. Pagination complete.`);
      break;
    }

    pageNum++;
  }

  hasCompletedInitialCrawl = true;
  return allListings;
}

function normalize(o) {
  const title = o.title || 'No title available';
  const price = normalizePrice(o.price);
  const size = normalizeSize(o.size);
  const link = o.link != null && !o.link.startsWith('http') ? `https://isihome.de${o.link}` : o.link;
  const address = normalizeAddress(o.address);
  const id = buildHash(o.id || link, price);
  return Object.assign(o, { id, title, price, size, link, address });
}

/**
 * ISI Home price labels may contain a prefix like "Kaltmiete: " or "Kaufpreis: ".
 * When multiple price rows match (e.g. Kaltmiete + Warmmiete), cheerio concatenates
 * them all. Extract only the first numeric price value.
 * @param {string} price
 * @returns {string}
 */
function normalizePrice(price) {
  if (price == null) {
    return '--- €';
  }
  // Remove labels like "Kaltmiete: ", "Kaufpreis: " etc.
  const cleaned = price.replace(/^[^:]+:\s*/, '').trim();
  // Extract only the first price (e.g. "522,17 EUR 646,50 EUR (...)" → "522,17 EUR")
  const match = cleaned.match(/[\d.,]+/);
  if (match) return match[0].trim();
  return cleaned || '--- €';
}

/**
 * ISI Home size labels contain a prefix like "Wohnfläche ca.: ".
 * Strip that and keep only the numeric value + unit.
 * @param {string} size
 * @returns {string}
 */
function normalizeSize(size) {
  if (size == null) {
    return '--- m²';
  }
  return size.replace(/^[^:]+:\s*/, '').replace(/m²/g, '').trim() || '--- m²';
}

/**
 * Normalize the address by trimming and joining multi-line address parts.
 * @param {string} address
 * @returns {string}
 */
function normalizeAddress(address) {
  if (address == null) return '';
  return address
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(', ');
}

function applyBlacklist(o) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = o.description == null || !isOneOf(o.description, appliedBlackList);
  const isBlacklistedDistrict =
    appliedBlacklistedDistricts.length === 0 ? false : isOneOf(o.address, appliedBlacklistedDistricts);
  return o.title != null && !isBlacklistedDistrict && titleNotBlacklisted && descNotBlacklisted;
}

const config = {
  url: null,
  crawlContainer: '.property-container',
  sortByDateParam: 'im_order=datedesc',
  waitForSelector: '.immomakler-archive',
  crawlFields: {
    id: '.row.data-objektnr_extern .dd | removeNewline | trim',
    title: '.property-title a | removeNewline | trim',
    price: '.row.price .dd | removeNewline | trim',
    size: '.row.data-wohnflaeche .dd | removeNewline | trim',
    address: '.property-subtitle | removeNewline | trim',
    link: '.property-title a@href',
    image: '.property-thumbnail img@src',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'address', 'image'],
  getListings: getListings,
  normalize: normalize,
  filter: applyBlacklist,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  name: 'ISIHOME',
  baseUrl: 'https://isihome.de/',
  id: 'isihome',
};

export const init = (sourceConfig, blacklist, blacklistedDistricts) => {
  config.enabled = sourceConfig.enabled;
  config.url = sourceConfig.url;
  appliedBlacklistedDistricts = blacklistedDistricts || [];
  appliedBlackList = blacklist || [];
};

export { config };
