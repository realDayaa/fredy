/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { expect } from 'vitest';
import { readFile } from 'fs/promises';
import * as provider from '../../lib/provider/froheZukunft.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

/** The "Mietpreis" row of the recorded exposé; its Gesamtmiete is 391,00 €. */
const RECORDED_COLD_RENT = 247;

/**
 * An exposé's "Preise und Kosten" table holding the given rows.
 *
 * @param {[string, string][]} rows Label and value of each row.
 * @returns {string}
 */
const exposeWith = (rows) =>
  `<div class="datatable"><table><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}</tbody></table></div>`;

describe('#parseColdRent()', () => {
  it('reads the cold rent of the recorded exposé, not its total rent', async () => {
    const html = await readFile(new URL('../testFixtures/froheZukunft_detail.html', import.meta.url), 'utf-8');
    expect(provider.parseColdRent(html)).toBe(RECORDED_COLD_RENT);
  });

  it('reads the row by its label, wherever it sits in the table', () => {
    const html = exposeWith([
      ['Gesamtmiete', '1.405,00 €'],
      ['Mietpreis', '1.080,50 €'],
    ]);
    expect(provider.parseColdRent(html)).toBe(1080.5);
  });

  it('returns null when the exposé has no Mietpreis row', () => {
    expect(provider.parseColdRent(exposeWith([['Gesamtmiete', '391,00 €']]))).toBeNull();
  });

  it('returns null when the Mietpreis row is empty', () => {
    expect(provider.parseColdRent(exposeWith([['Mietpreis', ' ']]))).toBeNull();
  });

  it('returns null for no page at all', () => {
    expect(provider.parseColdRent(null)).toBeNull();
  });
});

describe('#buildGeocodableAddress()', () => {
  it('drops a compound district that breaks the Nominatim query', () => {
    expect(provider.buildGeocodableAddress('Emil-Abderhalden-Str. 23, Zentrum / Stadtmitte, 06108')).toBe(
      'Emil-Abderhalden-Str. 23, 06108',
    );
  });

  it('drops a simple single-word district too', () => {
    expect(provider.buildGeocodableAddress('Uranusstr. 41, Trotha, 06118')).toBe('Uranusstr. 41, 06118');
  });

  it('returns the input unchanged when the last segment is not a postal code', () => {
    expect(provider.buildGeocodableAddress('Uranusstr. 41, Trotha')).toBe('Uranusstr. 41, Trotha');
  });

  it('returns the input unchanged when there is only one segment', () => {
    expect(provider.buildGeocodableAddress('Uranusstr. 41')).toBe('Uranusstr. 41');
  });

  it('returns null for null input', () => {
    expect(provider.buildGeocodableAddress(null)).toBeNull();
  });
});

describe('#froheZukunft testsuite()', () => {
  let browser;

  beforeAll(async () => {
    browser = await launchBrowser(providerConfig.froheZukunft.url);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  });

  it(
    'should test froheZukunft provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'froheZukunft',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      const runConfig = provider.createConfig(providerConfig.froheZukunft, [], []);

      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, browser);
      const liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('froheZukunft');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        expect(notify.title).toBeTypeOf('string');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toContain('https://www.frohe-zukunft.de');
        expect(notify.address).not.toBe('');
        // Garage/parking listings have no room or size figures, so only price is guaranteed.
        expect(notify.price).toContain('€');
      });
      if (process.env.TEST_MODE === 'offline') {
        // Every exposé is served the recorded one, so every card has to carry its cold rent.
        liveListings.forEach((listing) => expect(listing.price).toBe(RECORDED_COLD_RENT));
      }
    },
    TEST_TIMEOUT,
  );
});
