/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as cheerio from 'cheerio';
import { buildHash, isOneOf } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import { normalizeBuildYear } from '../utils/buildingFacts.js';
import { toListingImages } from '../utils/listingImages.js';
import { toPlainText } from '../utils/plain-text.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import Extractor from '../services/extractor/extractor.js';
import { DEFAULT_HEADER } from '../services/extractor/utils.js';
import logger from '../services/logger.js';
/** @import { ParsedListing, ListingImage } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.frohe-zukunft.de';

/** How long one exposé request may take before it counts as unreadable. */
const EXPOSE_TIMEOUT_MS = 30_000;

/**
 * Pull one figure out of the concatenated "2 Zimmer 41.12 m² 379.00 €" text by the unit that
 * follows it, rather than by position - garage/parking listings only carry a price and no
 * room/size figures at all, which made positional (nth-child) indexing shift the wrong value into
 * the wrong field.
 *
 * The theme also renders these with a decimal point ("41.12", "379.00") rather than the usual
 * German decimal comma, so the shared `extractNumber` helper (which strips dots as thousand
 * separators) would mangle it - this parses the point as-is instead.
 *
 * @param {string|null|undefined} value The concatenated data__text values for one listing.
 * @param {RegExp} unitPattern Pattern with the number in capture group 1, anchored to its unit.
 * @returns {number|null}
 */
function extractByUnit(value, unitPattern) {
  if (value == null) return null;
  const match = value.match(unitPattern);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return isNaN(num) ? null : num;
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
 * The card's address reads "<Street Nr>, <District>, <PLZ>". Nominatim resolves "Street, PLZ"
 * reliably but chokes on some district spellings sitting between them - confirmed against the live
 * API, "Emil-Abderhalden-Str. 23, Zentrum / Stadtmitte, 06108" (a compound, slash-separated
 * district) returns zero results while "Emil-Abderhalden-Str. 23, 06108" resolves correctly, the
 * same failure mode already fixed for the immowelt and gwgHalleNeustadt providers. The district is
 * dropped rather than special-cased, since there is no way to know in advance which spellings a
 * future listing will use.
 *
 * @param {string|null|undefined} raw the address text as scraped from the card
 * @returns {string|null}
 */
export function buildGeocodableAddress(raw) {
  if (raw == null) return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return raw;
  const street = parts[0];
  const postalCode = parts[parts.length - 1];
  return /^\d{5}$/.test(postalCode) ? `${street}, ${postalCode}` : raw;
}

/**
 * What an exposé carries beyond the search card.
 *
 * @typedef {Object} Expose
 * @property {number|null} coldRent The "Mietpreis" row.
 * @property {number|null} charges What the "Gesamtmiete" adds to the cold rent: Betriebskosten and
 *   Heizkosten.
 * @property {number|null} buildYear The "Baujahr" row.
 * @property {string|null} description Every section of the exposé, one per heading.
 * @property {ListingImage[]} images The gallery, floor plan first.
 */

/**
 * One section of an exposé: a heading over either a two-column table ("Preise und Kosten",
 * "Immobiliendetails") or a block of text ("Zusätzliche Merkmale", "Ausstattungsbeschreibung").
 *
 * @typedef {Object} ExposeSection
 * @property {string} title
 * @property {Array<[string, string]>} rows Label and value of each table row with a value.
 * @property {string|null} text The text under the heading, for a section without a table.
 */

/**
 * @param {string} text
 * @returns {string} The text on one line, whitespace collapsed.
 */
const tidy = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Read the exposé's sections by their headings rather than by position, because a section the
 * advert has nothing for is left out of the page, and so is a row: "Anteile" and
 * "Wohnberechtigungsschein" are not on every exposé.
 *
 * @param {import('cheerio').CheerioAPI} $ The exposé.
 * @returns {ExposeSection[]}
 */
function readSections($) {
  return $('.row_second > .col')
    .toArray()
    .map((column) => {
      const block = $(column).find('.wysiwyg').first();
      const title = tidy(block.find('h3').first().text());
      const rows = $(column)
        .find('.datatable tbody tr')
        .toArray()
        .map((row) => {
          const cells = $(row).children('td');
          return [tidy(cells.eq(0).text()), tidy(cells.eq(1).text())];
        })
        .filter(([label, value]) => label && value);
      const content = block.clone();
      content.find('h3').remove();
      const text = toPlainText(content.html())
        .split('\n')
        .map(tidy)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { title, rows, text: text || null };
    })
    .filter((section) => section.title);
}

/**
 * Write the sections out as the listing's description, a table row as "Label: Wert".
 *
 * "Wohnberechtigungsschein: Nein" is left out. Blacklists are matched against the description as
 * plain substrings, so a job that blacklists "Wohnberechtigungsschein" to skip flats that need one
 * would otherwise drop every flat that says it does not. A "Ja" stays, where that blacklist belongs.
 *
 * @param {ExposeSection[]} sections
 * @returns {string|null}
 */
function describe(sections) {
  const parts = sections
    .map(({ title, rows, text }) => {
      const lines = rows
        .filter(([label, value]) => !(label === 'Wohnberechtigungsschein' && value === 'Nein'))
        .map(([label, value]) => `${label}: ${value}`);
      const body = lines.length > 0 ? lines.join('\n') : text;
      return body ? `${title}\n${body}` : null;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Read an exposé page.
 *
 * The search card only shows the Gesamtmiete (cold rent plus Betriebskosten and Heizkosten) and a
 * single picture. The cold rent is the "Mietpreis" row of the "Preise und Kosten" table; unlike the
 * card, the tables use German number formatting ("1.280,00 €").
 *
 * @param {string|null|undefined} html The exposé page.
 * @returns {Expose|null} Null for no page at all.
 */
export function parseExpose(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const sections = readSections($);
  const facts = new Map(sections.flatMap((section) => section.rows));

  const coldRent = extractNumber(facts.get('Mietpreis') ?? null);
  const totalRent = extractNumber(facts.get('Gesamtmiete') ?? null);
  const charges =
    coldRent != null && totalRent != null && totalRent >= coldRent
      ? Math.round((totalRent - coldRent) * 100) / 100
      : null;

  const images = toListingImages(
    $('.layout__carousel a.carousel__slide')
      .toArray()
      .map((slide) => ({ url: $(slide).attr('href'), caption: $(slide).attr('data-caption') })),
  );

  return {
    coldRent,
    charges,
    buildYear: normalizeBuildYear(facts.get('Baujahr') ?? null),
    description: describe(sections),
    images,
  };
}

/**
 * Load one exposé over plain `fetch` (the site serves its pages without a browser) and read it.
 *
 * Redirects are not followed. The site answers an exposé that has been taken down with a 301 to its
 * homepage, whose own picture carousel would otherwise be read as the flat's gallery. The search
 * page links every card to its exposé directly, so a live exposé never redirects.
 *
 * @param {string} link Absolute exposé URL.
 * @returns {Promise<Expose|null>} Null when the exposé could not be loaded or is gone.
 */
async function fetchExpose(link) {
  try {
    const response = await fetch(link, {
      headers: DEFAULT_HEADER,
      redirect: 'manual',
      signal: AbortSignal.timeout(EXPOSE_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn(`Frohe Zukunft: exposé ${link} answered ${response.status}.`);
      return null;
    }
    return parseExpose(await response.text());
  } catch (error) {
    logger.warn(`Frohe Zukunft: could not load exposé ${link}.`, error?.message || error);
    return null;
  }
}

/**
 * Read the search page, then every card's exposé for its cold rent.
 *
 * The cold rent is read here rather than in {@link fetchDetails}, because it is the listing's
 * price: `fetchDetails` only runs for users who opted into detail fetching, and only after the
 * first spec filter pass, which would have judged a listing by its total rent and dropped one whose
 * cold rent is within the job's maximum. The site lists a handful of flats, so one request per card
 * and run is cheap.
 *
 * @param {string} url The job's search URL.
 * @param {import('puppeteer').Browser} browser The shared browser of the current job run.
 * @returns {Promise<any[]>} The raw cards, each with `coldRent` and `charges` set when its exposé
 *   had them.
 */
async function getListings(url, browser) {
  const extractor = new Extractor({ browser });
  await extractor.execute(url, config.waitForSelector, metaInformation.id);
  const cards = extractor.parseResponseText(config.crawlContainer, config.crawlFields, url) ?? [];

  // One after the other, so the cooperative's site never sees a burst of requests.
  for (const card of cards) {
    const link = toAbsoluteLink(card.link);
    if (link == null) continue;
    const expose = await fetchExpose(link);
    if (expose?.coldRent == null) {
      logger.warn(`Frohe Zukunft: no cold rent for ${link}, keeping the total rent.`);
      continue;
    }
    card.coldRent = expose.coldRent;
    card.charges = expose.charges;
  }
  return cards;
}

/**
 * Add what only the exposé carries: its tables and text blocks as the description, the whole
 * gallery and the construction year. The search card has one picture and no text at all.
 *
 * Where the search run could not read the exposé and kept the total rent, the cold rent read here
 * replaces it.
 *
 * @param {ParsedListing} listing The listing scraped from the search result page.
 * @returns {Promise<ParsedListing>} The enriched listing, or the untouched one when the exposé could
 *   not be loaded.
 */
async function fetchDetails(listing) {
  const expose = await fetchExpose(listing.link);
  if (expose == null) return listing;
  return {
    ...listing,
    description: expose.description ?? listing.description,
    images: expose.images.length > 0 ? expose.images : listing.images,
    buildYear: expose.buildYear ?? listing.buildYear,
    ...(expose.coldRent == null
      ? {}
      : { price: expose.coldRent, chargesIncluded: false, charges: expose.charges ?? undefined }),
  };
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const coldRent = o.coldRent ?? null;
  return {
    // The link alone: the raw card has never carried a `price`, so this is the identity every
    // stored listing already has. A price in here would make each of them look new again.
    id: buildHash(o.link),
    title: o.title,
    link: toAbsoluteLink(o.link),
    address: buildGeocodableAddress(o.address),
    image: o.image,
    size: extractByUnit(o.data, /([\d.]+)\s*m²/),
    rooms: extractByUnit(o.data, /([\d.]+)\s*Zimmer/),
    // The card's figure is the total rent. It only stands in when the exposé could not be read,
    // and then says so, so the affordability check does not add the charges a second time.
    price: coldRent ?? extractByUnit(o.data, /([\d.]+)\s*€/),
    chargesIncluded: coldRent == null,
    charges: o.charges ?? undefined,
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
  crawlContainer: '.products__item',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: '.products__footer a.link[href*="/wohnfinder/"]@href',
    link: '.products__footer a.link[href*="/wohnfinder/"]@href',
    title: '.products__header h3 | trim',
    // Only the first <p> is the address; a garage/parking listing has none of the following
    // siblings, an apartment has a second one for the floor ("5. Etage") that must not be folded
    // into the address text.
    address: '.products__main .wysiwyg p:first-child | trim',
    image: '.picture__link .picture__media img@src',
    data: '.picture__link .data__list.data__infos .data__item .data__text | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  getListings,
  normalize,
  fetchDetails,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'Frohe Zukunft Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'froheZukunft',
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
