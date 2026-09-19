/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { isOneOf, buildHash } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import Extractor from '../services/extractor/extractor.js';
import puppeteerExtractor from '../services/extractor/puppeteerExtractor.js';
import logger from '../services/logger.js';
import * as cheerio from 'cheerio';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

// Guards against an unbounded loop if the "next page" link is ever still present on what is
// actually the last page (e.g. a markup change, or a fixture that serves the same page for
// every URL in tests) - each page still costs a request, so this stays a backstop, not a target.
const MAX_PAGES = 100;

/** The headed sections of an exposé that make up the description, in the order the page shows them. */
const DESCRIPTION_SECTIONS = ['Objektbeschreibung', 'Ausstattung', 'Lage'];

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
 * Fetch listings from ISI Home, walking pages until one comes back empty or has no
 * "next page" link. Every run re-crawls from page 1: providers must not keep run-crossing
 * state at module scope (two jobs can execute concurrently and would trample each other's
 * progress), so there is no cheap way to remember "already saw the older pages" between runs.
 * Results already stored are filtered out downstream by the pipeline's hash-based dedup, so
 * re-walking older pages costs extra requests but never produces duplicate notifications.
 *
 * `this` is bound to the FredyPipelineExecutioner instance by the pipeline.
 *
 * @param {string} url The base provider URL (page 1).
 * @returns {Promise<Object[]>} Combined listings from all pages.
 */
async function getListings(url) {
  const allListings = [];
  let pageNum = 1;

  while (true) {
    const pageUrl = buildPageUrl(url, pageNum);
    logger.debug(`ISI Home: Fetching page ${pageNum} => ${pageUrl}`);

    const extractor = new Extractor({ browser: this._browser });
    await extractor.execute(pageUrl, config.waitForSelector);

    const listings = extractor.parseResponseText(config.crawlContainer, config.crawlFields, pageUrl);

    if (listings == null || listings.length === 0) {
      logger.debug(`ISI Home: Page ${pageNum} returned no listings. Stopping pagination.`);
      break;
    }

    allListings.push(...listings);
    logger.debug(`ISI Home: Got ${listings.length} listings from page ${pageNum} (total: ${allListings.length})`);

    // Check if there is a "next page" link; if not, this was the last page.
    const hasNextPage =
      extractor.responseText != null && cheerio.load(extractor.responseText)('a.next.page-numbers').length > 0;

    if (!hasNextPage) {
      logger.debug(`ISI Home: No next-page link found on page ${pageNum}. Pagination complete.`);
      break;
    }

    if (pageNum >= MAX_PAGES) {
      logger.warn(`ISI Home: Reached the ${MAX_PAGES}-page safety limit. Stopping pagination.`);
      break;
    }

    pageNum++;
  }

  return allListings;
}

/**
 * Collapse runs of spaces inside each line and keep the paragraph breaks, which the listing detail
 * shows as they are.
 *
 * @param {string} text
 * @returns {string|null} The tidied text, or null when nothing but whitespace was left.
 */
function tidyParagraphs(text) {
  const tidied = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidied || null;
}

/**
 * Read one headed section of an exposé page.
 *
 * The page comes out of a page builder that nests each section differently: "Objektbeschreibung"
 * sits inside the block holding its text, "Ausstattung" right before it, and "Lage" in a wrapper of
 * its own ahead of it. Those three positions are what is tried. The builder's generated ids
 * (`code_block-79-12790`) would be shorter to select by, but they number the elements of the
 * template and shift whenever someone edits it.
 *
 * @param {import('cheerio').CheerioAPI} $ The exposé page.
 * @param {string} title The section's headline, e.g. "Ausstattung".
 * @returns {string|null} The section's text, or null when the page has no such section.
 */
function readSection($, title) {
  const heading = $('h2')
    .filter((_, element) => $(element).text().replace(/\s+/g, ' ').trim() === title)
    .first();
  if (heading.length === 0) return null;

  const block = [
    heading.closest('.ct-code-block'),
    heading.next('.ct-code-block'),
    heading.parent().next('.ct-code-block'),
  ].find((candidate) => candidate.length > 0);
  if (block == null) return null;

  const content = block.clone();
  content.find('h2').remove();
  content.find('br').replaceWith('\n');
  // Adjacent paragraphs carry no whitespace between them, so they would run into one another.
  content.find('p').after('\n\n');
  return tidyParagraphs(content.text());
}

/**
 * Enrich a listing with the exposé text. The search result card has no description at all.
 *
 * @param {ParsedListing} listing The listing scraped from the search result page.
 * @param {import('puppeteer').Browser} browser The shared browser of the current job run.
 * @returns {Promise<ParsedListing>} The enriched listing, or the untouched one on any failure.
 */
async function fetchDetails(listing, browser) {
  try {
    const html = await puppeteerExtractor(listing.link, null, { browser, name: 'isihome_details' });
    if (!html) return listing;

    const $ = cheerio.load(html);
    const description = DESCRIPTION_SECTIONS.map((title) => {
      const text = readSection($, title);
      return text == null ? null : `${title}\n${text}`;
    })
      .filter(Boolean)
      .join('\n\n');

    return description ? { ...listing, description } : listing;
  } catch (error) {
    logger.warn(`Could not fetch ISI Home detail page for listing '${listing.id}'.`, error?.message || error);
    return listing;
  }
}

/**
 * Turn a scraped card into a listing, with price, size and rooms as numbers.
 *
 * The hash is still built from the price *text*. It was the only form of the price before these
 * fields became numbers, and hashing the number instead would give every listing already stored a
 * new identity: the next run would store all of them a second time and announce them again.
 *
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const title = o.title || 'No title available';
  const priceText = normalizePrice(o.price);
  const price = extractNumber(priceText);
  const size = normalizeSize(o.size);
  // German decimal comma on the card ("4,5"), so the half room survives as 4.5.
  const rooms = extractNumber(o.rooms);
  const link = o.link != null && !o.link.startsWith('http') ? `https://isihome.de${o.link}` : o.link;
  const address = normalizeAddress(o.address);
  const id = buildHash(o.id || link, priceText);
  return Object.assign(o, { id, title, price, size, rooms, link, address });
}

/**
 * ISI Home price labels may contain a prefix like "Kaltmiete: " or "Kaufpreis: ".
 * When multiple price rows match (e.g. Kaltmiete + Warmmiete), cheerio concatenates
 * them all. Extract only the first price, still as German-formatted text ("1.096,00"):
 * that text is what the listing hash is built from, see `normalize`.
 * @param {string} price
 * @returns {string} The price text, or `'--- €'` when the card has none.
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
 * Strip that and read the German-formatted figure ("106,88 m²" → 106.88).
 * @param {string} size
 * @returns {number|null} `null` when the card has no size.
 */
function normalizeSize(size) {
  if (size == null) {
    return null;
  }
  return extractNumber(size.replace(/^[^:]+:\s*/, ''));
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

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList Terms the job wants filtered out.
 * @param {string[]} appliedBlacklistedDistricts Districts the job wants filtered out.
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList, appliedBlacklistedDistricts) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = o.description == null || !isOneOf(o.description, appliedBlackList);
  const isBlacklistedDistrict =
    appliedBlacklistedDistricts.length === 0 ? false : isOneOf(o.address, appliedBlacklistedDistricts);
  return o.title != null && !isBlacklistedDistrict && titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
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
    rooms: '.row.data-anzahl_zimmer .dd | removeNewline | trim',
    address: '.property-subtitle | removeNewline | trim',
    link: '.property-title a@href',
    image: '.property-thumbnail img@src',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  getListings: getListings,
  normalize: normalize,
  fetchDetails: fetchDetails,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'ISIHOME',
  baseUrl: 'https://isihome.de/',
  id: 'isihome',
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
