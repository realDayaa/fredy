/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/froheZukunft.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

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

describe('#rediscoverImage()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the current image url off the live detail page', async () => {
    const html = `
      <div class="posts__picture picture">
        <div class="picture__media">
          <img src="https://www.frohe-zukunft.de/wp-content/uploads/mia-import/newhash/5528484.jpg" alt="" class="media__img">
        </div>
      </div>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => html })),
    );

    const result = await provider.config.rediscoverImage({
      link: 'https://www.frohe-zukunft.de/wohnfinder/some-listing/',
    });

    expect(result).toBe('https://www.frohe-zukunft.de/wp-content/uploads/mia-import/newhash/5528484.jpg');
  });

  it('returns null without a link', async () => {
    expect(await provider.config.rediscoverImage({ link: null })).toBeNull();
    expect(await provider.config.rediscoverImage(null)).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );

    expect(await provider.config.rediscoverImage({ link: 'https://www.frohe-zukunft.de/wohnfinder/gone/' })).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    expect(await provider.config.rediscoverImage({ link: 'https://www.frohe-zukunft.de/wohnfinder/x/' })).toBeNull();
  });

  it('returns null when the page has no picture__media img at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '<html><body>no photo here</body></html>' })),
    );

    expect(await provider.config.rediscoverImage({ link: 'https://www.frohe-zukunft.de/wohnfinder/x/' })).toBeNull();
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
    },
    TEST_TIMEOUT,
  );
});
