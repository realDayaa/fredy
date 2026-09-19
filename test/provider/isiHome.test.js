/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/isiHome.js';
import { buildHash } from '../../lib/utils.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

describe('#isihome testsuite()', () => {
  runConfig = provider.createConfig(providerConfig.isihome, [], []);
  it('should test isihome provider', async () => {
    const Fredy = await mockFredy();
    const mockedJob = {
      id: 'isihome',
      notificationAdapter: null,
      spatialFilter: null,
      specFilter: null,
    };

    return await new Promise((resolve, reject) => {
      const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, undefined);

      fredy.execute().then((listing) => {
        if (listing == null || listing.length === 0) {
          reject('Listings is empty!');
          return;
        }

        expect(listing).toBeInstanceOf(Array);
        const notificationObj = get();
        expect(notificationObj).toBeTypeOf('object');
        expect(notificationObj.serviceName).toBe('isihome');
        notificationObj.payload.forEach((notify) => {
          /** check the actual structure **/
          expect(notify.id).toBeTypeOf('string');
          expect(notify.price).toBeTypeOf('string');
          expect(notify.title).toBeTypeOf('string');
          expect(notify.link).toBeTypeOf('string');
          expect(notify.address).toBeTypeOf('string');
          // Every card in the fixture carries price, size and rooms. The payload is formatted, hence
          // the units, and a decimal point rather than the card's comma shows the figure was parsed.
          expect(notify.price).toMatch(/^\d+(\.\d+)? €$/);
          expect(notify.size).toMatch(/^\d+(\.\d+)? m²$/);
          expect(notify.rooms).toMatch(/^\d+(\.\d+)? rooms$/);
          /** check the values if possible **/
          if (notify.size != null && notify.size.trim().toLowerCase() !== 'k.a.') {
            expect(notify.size).toContain('m²');
          }
          expect(notify.title).not.toBe('');
          expect(notify.link).toContain('https://isihome.de');
          expect(notify.address).not.toBe('');
        });
        resolve();
      });
    });
  });
});

describe('#isihome normalize', () => {
  const card = {
    id: '37343',
    link: '/immobilien/vermietung/wohnung-etagenwohnung-in-halle-mieten-37343/',
    price: '1.096,00\u202fEUR 1.396,00\u202fEUR',
    size: '106,88\u202fm²',
    rooms: '4,5',
  };

  it('reads price, size and rooms as numbers from their German formatting', () => {
    const listing = provider.config.normalize({ ...card });
    expect(listing.price).toBe(1096);
    expect(listing.size).toBe(106.88);
    expect(listing.rooms).toBe(4.5);
  });

  it('keeps hashing the price text, so listings stored before stay recognised', () => {
    const listing = provider.config.normalize({ ...card });
    expect(listing.id).toBe(buildHash('37343', '1.096,00'));
  });

  it('leaves price, size and rooms null when the card has none', () => {
    const listing = provider.config.normalize({ id: '37343', link: card.link });
    expect(listing).toMatchObject({ price: null, size: null, rooms: null });
    expect(listing.id).toBe(buildHash('37343', '--- €'));
  });
});
