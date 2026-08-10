/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/tagWohnen.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

describe('#cleanTitle()', () => {
  it('trims the outer asterisks but keeps the ones separating selling points', () => {
    expect(provider.cleanTitle('* Südpark * in Renovierung * Sparpreis *')).toBe(
      'Südpark * in Renovierung * Sparpreis',
    );
  });

  it('returns null for null input', () => {
    expect(provider.cleanTitle(null)).toBeNull();
  });
});

describe('#extractSpec()', () => {
  const specs = 'Zimmer3Wohnfläche59,09 m2Gesamtmiete474,00 €';

  it('reads the room count', () => {
    expect(provider.extractSpec(specs, 'Zimmer')).toBe(3);
  });

  it('reads the living space with its decimal comma', () => {
    expect(provider.extractSpec(specs, 'Wohnfläche')).toBe(59.09);
  });

  it('reads the total rent', () => {
    expect(provider.extractSpec(specs, 'Gesamtmiete')).toBe(474);
  });

  it('returns null when the label is absent', () => {
    expect(provider.extractSpec('Zimmer3', 'Gesamtmiete')).toBeNull();
  });
});

describe('#tagWohnen testsuite()', () => {
  let browser;

  beforeAll(async () => {
    browser = await launchBrowser(providerConfig.tagWohnen.url);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  });

  it(
    'should test tagWohnen provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'tagWohnen',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      const runConfig = provider.createConfig(providerConfig.tagWohnen, [], []);

      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, browser);
      const liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('tagWohnen');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        expect(notify.title).toBeTypeOf('string');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toContain('https://tag-wohnen.de/immosuche/expose');
        expect(notify.address).not.toBe('');
        expect(notify.price).toContain('€');
        expect(notify.size).toContain('m²');
      });
    },
    TEST_TIMEOUT,
  );
});
