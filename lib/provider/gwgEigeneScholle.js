/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.gwgeigenescholle.de';

/**
 * The room/size/price figures carry a label or unit ("3-Raum", "67,81qm", "Miete: 644,19€"), so
 * the first number-looking substring is pulled out before handing it to `extractNumber`.
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
  const link = toAbsoluteLink(o.link);
  const title = o.title;

  return {
    id: buildHash(o.link, o.price),
    title,
    link,
    // No separate address field is exposed on the list page; the title (e.g. "individuelle
    // 3-Raum-Wohnung im Dachgeschoss") carries no street either, so the city is the best anchor
    // available for geocoding without fetching the detail page.
    address: title ? `${title}, Halle (Saale)` : 'Halle (Saale)',
    image: toAbsoluteLink(o.image),
    size: firstNumber(o.size),
    rooms: firstNumber(o.rooms),
    price: firstNumber(o.price),
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
  crawlContainer: '.uk-grid.tm-grid-expand.uk-grid-collapse.uk-margin-medium',
  sortByDateParam: null,
  waitForSelector: 'body',
  crawlFields: {
    id: 'a.el-content.uk-button@href',
    link: 'a.el-content.uk-button@href',
    title: 'h2.uk-h3 | trim',
    image: 'img.el-image@src',
    rooms: '.el-item:nth-child(1) .el-content | trim',
    size: '.el-item:nth-child(2) .el-content | trim',
    price: '.el-item:nth-child(3) .el-content | trim',
  },
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image'],
  normalize,
  activeTester: checkIfListingIsActive,
};

export const metaInformation = {
  countries: ['de'],
  name: 'GWG Eigene Scholle Halle',
  baseUrl: `${BASE_URL}/`,
  id: 'gwgEigeneScholle',
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
