/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What the stubbed extractor hands back, swapped per test case. */
const extractor = vi.hoisted(() => ({ respond: async () => null }));

// Served from here rather than through the offline fixtures, so these cases read the recorded
// exposé in live mode as well: they are about the parsing, not about the portal being up.
vi.mock('../../lib/services/extractor/puppeteerExtractor.js', () => ({
  default: (url, waitForSelector, options) => extractor.respond(url, options),
  launchBrowser: async () => ({ close: async () => {}, isConnected: () => true }),
  closeBrowser: async () => {},
}));

const provider = await import('../../lib/provider/isiHome.js');

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testFixtures');
const detailHtml = fs.readFileSync(path.join(FIXTURES, 'isihome_detail.html'), 'utf8');

const listing = {
  id: 'hash',
  link: 'https://isihome.de/immobilien/vermietung/wohnung-etagenwohnung-in-halle-mieten-37343/',
  title: 'Moderne 4,5-Raumwohnung mit großem Balkon - WE04',
  price: 1096,
  size: 106.88,
  rooms: 4.5,
};

describe('#isihome fetchDetails', () => {
  beforeEach(() => {
    extractor.respond = async () => detailHtml;
  });

  it('reads the three exposé sections into the description, each under its headline', async () => {
    const { description } = await provider.config.fetchDetails({ ...listing }, null);

    // "Objektbeschreibung" sits inside its text block, "Ausstattung" before it and "Lage" in a
    // wrapper of its own, so the recorded page covers every position the parser tries.
    expect(description).toMatch(/^Objektbeschreibung\nMitten in Halles Südstadt/);
    expect(description).toContain('\n\nAusstattung\nDie großzügig geschnittene 4,5-Zimmer-Wohnung');
    expect(description).toContain('\n\nLage\nDie Wohnung befindet sich in der beliebten südlichen Innenstadt');
  });

  it('keeps the paragraph breaks inside a section', async () => {
    const { description } = await provider.config.fetchDetails({ ...listing }, null);
    expect(description).toContain('zur Verfügung.\n\nDas Tageslichtbad mit Badewanne');
  });

  it('leaves out the data table, the map widget and the contact box', async () => {
    const { description } = await provider.config.fetchDetails({ ...listing }, null);
    expect(description).not.toContain('2192 €');
    expect(description).not.toContain('Google');
    expect(description).not.toContain('Ansprechpartner');
  });

  it('asks the extractor for the listing page under a detail run name', async () => {
    const calls = [];
    extractor.respond = async (url, options) => {
      calls.push({ url, name: options?.name });
      return detailHtml;
    };
    await provider.config.fetchDetails({ ...listing }, null);
    expect(calls).toEqual([{ url: listing.link, name: 'isihome_details' }]);
  });

  it('keeps every other field of the listing', async () => {
    const { description, ...rest } = await provider.config.fetchDetails({ ...listing }, null);
    expect(description).toBeTypeOf('string');
    expect(rest).toEqual(listing);
  });

  it('returns the listing untouched when the page has none of the sections', async () => {
    extractor.respond = async () => '<html><body><h2>Kontakt</h2><div class="ct-code-block">x</div></body></html>';
    expect(await provider.config.fetchDetails({ ...listing }, null)).toEqual(listing);
  });

  it('returns the listing untouched when the page could not be loaded', async () => {
    extractor.respond = async () => null;
    expect(await provider.config.fetchDetails({ ...listing }, null)).toEqual(listing);
  });

  it('never rejects, so one broken page cannot fail the run', async () => {
    extractor.respond = async () => {
      throw new Error('navigation timeout');
    };
    expect(await provider.config.fetchDetails({ ...listing }, null)).toEqual(listing);
  });
});
