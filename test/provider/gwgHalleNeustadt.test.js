/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/gwgHalleNeustadt.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

describe('#buildAddress()', () => {
  it('drops the trailing middle-dot separator from the street', () => {
    expect(provider.buildAddress({ street: 'Azaleenstraße 35 ·', postalCode: '06122', city: 'Halle (Saale)' })).toBe(
      'Azaleenstraße 35, 06122 Halle (Saale)',
    );
  });

  it('returns null when every part is missing', () => {
    expect(provider.buildAddress({ street: null, postalCode: null, city: null })).toBeNull();
  });

  it('falls back to whatever parts are present', () => {
    expect(provider.buildAddress({ street: null, postalCode: '06122', city: 'Halle (Saale)' })).toBe(
      '06122 Halle (Saale)',
    );
  });
});

describe('#gwgHalleNeustadt testsuite()', () => {
  let browser;

  beforeAll(async () => {
    browser = await launchBrowser(providerConfig.gwgHalleNeustadt.url);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  });

  it(
    'should test gwgHalleNeustadt provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'gwgHalleNeustadt',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      const runConfig = provider.createConfig(providerConfig.gwgHalleNeustadt, [], []);

      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, browser);
      const liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('gwgHalleNeustadt');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        expect(notify.title).toBeTypeOf('string');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toContain('https://www.gwg-halle.de');
        expect(notify.address).not.toBe('');
        expect(notify.price).toContain('€');
        expect(notify.size).toContain('m²');
      });
    },
    TEST_TIMEOUT,
  );
});
