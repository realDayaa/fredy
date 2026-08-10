/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { expect } from 'vitest';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';
import { get } from '../mocks/mockNotification.js';
import * as provider from '../../lib/provider/leuwo.js';

const TEST_TIMEOUT = 120_000;

// LEUWO uses a JSON API (fetch-based, no browser): getListings() scrapes a fresh bearer token off
// the search page HTML, then POSTs it straight to the IVM Professional backend.
describe('#leuwo provider testsuite()', () => {
  const runConfig = provider.createConfig(providerConfig.leuwo, [], []);

  it(
    'should test leuwo provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'leuwo',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };

      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, undefined);
      const liveListings = await fredy.execute();

      if (liveListings == null || liveListings.length === 0) {
        throw new Error('Listings is empty!');
      }

      expect(liveListings).toBeInstanceOf(Array);
      const notificationObj = get();
      expect(notificationObj).toBeTypeOf('object');
      expect(notificationObj.serviceName).toBe('leuwo');
      notificationObj.payload.forEach((notify) => {
        expect(notify.id).toBeTypeOf('string');
        expect(notify.title).toBeTypeOf('string');
        expect(notify.link).toBeTypeOf('string');
        expect(notify.address).toBeTypeOf('string');
        expect(notify.title).not.toBe('');
        expect(notify.link).toContain('https://www.leuwo.de/objektdetail?dID=');
        expect(notify.address).not.toBe('');
        expect(notify.price).toContain('€');
        expect(notify.size).toContain('m²');
      });
    },
    TEST_TIMEOUT,
  );
});
