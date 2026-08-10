/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/livingHalle.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

describe('#feature extraction helpers()', () => {
  it('extracts the postal code and city, stopping at Wohnfläche', () => {
    expect(
      provider.extractAddress('ImmoNr: WM-G.-A.-Str. 6-WE 4 Wohnung Miete 06108 Halle Wohnfläche: ca. 39 m²'),
    ).toBe('06108 Halle');
  });

  it('extracts the postal code and city for a commercial listing with no Wohnfläche', () => {
    expect(provider.extractAddress('ImmoNr: GE-Kl. Ulli 24b Gastgewerbe Miete 06108 Halle Anzahl Zimmer: 1')).toBe(
      '06108 Halle',
    );
  });

  it('keeps a multi-word city like "Halle (Saale)"', () => {
    expect(provider.extractAddress('Miete 06112 Halle (Saale) Wohnfläche: ca. 37 m² Anzahl Zimmer: 1')).toBe(
      '06112 Halle (Saale)',
    );
  });

  it('reads the living space, treating the German decimal comma correctly', () => {
    expect(provider.extractSize('Wohnfläche: ca. 39 m² Anzahl Zimmer: 2')).toBe(39);
  });

  it('returns null size when Wohnfläche is absent', () => {
    expect(provider.extractSize('Anzahl Zimmer: 1')).toBeNull();
  });

  it('reads a fractional room count', () => {
    expect(provider.extractRooms('Anzahl Zimmer: 5,5 Anzahl Schlafzimmer: 3')).toBe(5.5);
  });

  it('prefers Kaltmiete over Warmmiete when both are present', () => {
    expect(provider.extractPrice('Warmmiete: 620,00 € Kaltmiete: 500,00 €')).toBe(500);
  });

  it('falls back to Warmmiete when Kaltmiete is missing', () => {
    expect(provider.extractPrice('Warmmiete: 890,00 €')).toBe(890);
  });
});

describe('#livingHalle testsuite()', () => {
  let browser;

  beforeAll(async () => {
    browser = await launchBrowser(providerConfig.livingHalle.url);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  });

  it(
    'should test livingHalle provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'livingHalle',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      const runConfig = provider.createConfig(providerConfig.livingHalle, [], []);

      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, browser);
      const liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('livingHalle');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        expect(notify.title).toBeTypeOf('string');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toContain('https://www.living-halle.de');
        expect(notify.address).not.toBe('');
        // Commercial listings on this portal (Gastronomie/Einzelhandel/Büro) carry no Wohnfläche.
        if (notify.size != null) expect(notify.size).toContain('m²');
        if (notify.price != null) expect(notify.price).toContain('€');
      });
    },
    TEST_TIMEOUT,
  );
});
