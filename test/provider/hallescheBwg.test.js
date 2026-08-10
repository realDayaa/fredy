/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/hallescheBwg.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

// hallebwg.de currently has zero vacant units, so a live capture of /wohnen never contains a
// single `.card` to assert against - TYPO3 omits the whole "Unsere Angebote" frame rather than
// rendering it empty. The offline fixture (test/testFixtures/hallescheBwg.html) therefore splices
// two representative listings into an otherwise-real capture of the page, using the exact markup
// verified against WG Eisenbahn (wgeisenbahn.de) - both sites run the same TYPO3 property-list
// extension, confirmed by their identical `.row.immobilien .card` structure. This test only runs
// meaningfully in offline mode; live mode will legitimately fail with "Listings is empty!" until
// the cooperative has an actual vacancy again.
describe('#hallescheBwg testsuite()', () => {
  let browser;

  beforeAll(async () => {
    browser = await launchBrowser(providerConfig.hallescheBwg.url);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  });

  it(
    'should test hallescheBwg provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'hallescheBwg',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      const runConfig = provider.createConfig(providerConfig.hallescheBwg, [], []);

      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, browser);
      const liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('hallescheBwg');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        expect(notify.title).toBeTypeOf('string');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toContain('https://www.hallebwg.de');
        expect(notify.address).not.toBe('');
        expect(notify.price).toContain('€');
        expect(notify.size).toContain('m²');
      });
    },
    TEST_TIMEOUT,
  );
});
