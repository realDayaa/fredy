/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { providerConfig, mockFredy } from '../utils.js';
import { afterEach, expect, vi } from 'vitest';
import { readFile } from 'fs/promises';
import * as provider from '../../lib/provider/froheZukunft.js';
import { launchBrowser, closeBrowser } from '../../lib/services/extractor/puppeteerExtractor.js';

const TEST_TIMEOUT = 120_000;

const RECORDED_EXPOSE_URL = new URL('../testFixtures/froheZukunft_detail.html', import.meta.url);

/** The "Mietpreis" row of the recorded exposé; its Gesamtmiete is 391,00 €. */
const RECORDED_COLD_RENT = 247;

/** What the recorded exposé's Gesamtmiete adds to its cold rent: 78 € Betriebskosten, 66 € Heizkosten. */
const RECORDED_CHARGES = 144;

/** A link offline mode answers with the recorded exposé. */
const EXPOSE_LINK = 'https://www.frohe-zukunft.de/wohnfinder/nachnutzer-gesucht-kleine-feine-2-zimmerwohnung/';

/**
 * An exposé holding the given sections, in the page's own markup.
 *
 * @param {Array<{title: string, rows?: [string, string][], text?: string}>} sections
 * @returns {string}
 */
const exposeWith = (sections) =>
  `<main><div class="row row_second">${sections
    .map(
      ({ title, rows, text }) =>
        `<div class="col col_6"><div class="wysiwyg"><h3>${title}</h3>${text ?? ''}</div>${
          rows
            ? `<div class="datatable"><table><thead><tr><th>Bezeichnung</th><th>Wert</th></tr></thead><tbody>${rows
                .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
                .join('')}</tbody></table></div>`
            : ''
        }</div>`,
    )
    .join('')}</div></main>`;

describe('#parseExpose()', () => {
  it('reads the recorded exposé: cold rent, charges, construction year and gallery', async () => {
    const expose = provider.parseExpose(await readFile(RECORDED_EXPOSE_URL, 'utf-8'));
    expect(expose.coldRent).toBe(RECORDED_COLD_RENT);
    expect(expose.charges).toBe(RECORDED_CHARGES);
    expect(expose.buildYear).toBe(1974);
    expect(expose.images).toHaveLength(12);
    expect(expose.images[0]).toEqual({
      url: 'https://www.frohe-zukunft.de/wp-content/uploads/mia-import/5960171afef0b025ddbf920140eab605/4768124.jpg',
      caption: 'Grundriss',
      floorPlan: true,
    });
    expect(expose.images[1]).toEqual({
      url: 'https://www.frohe-zukunft.de/wp-content/uploads/mia-import/5960171afef0b025ddbf920140eab605/9125979.jpg',
      caption: 'Wohnzimmer',
    });
  });

  it('writes every section of the recorded exposé into the description', async () => {
    const { description } = provider.parseExpose(await readFile(RECORDED_EXPOSE_URL, 'utf-8'));
    expect(description).toBe(
      [
        'Preise und Kosten',
        'Mietpreis: 247,00 €',
        'Betriebskosten: 78,00 €',
        'Heizkosten: 66,00 €',
        'Gesamtmiete: 391,00 €',
        'Anteile: 1.280,00 €',
        '',
        'Immobiliendetails',
        'Objektnummer: 0315.002.00020',
        'Frei ab: 16.12.2026',
        'Etage: 2',
        'Etagenanzahl: 5',
        'Anzahl Zimmer: 2',
        'Wohnfläche: 41.12 m²',
        'Heizungsart: Fernwärme',
        'Baujahr: 1974',
        'Zustand: renoviert',
        '',
        'Zusätzliche Merkmale',
        'bis 2. OG oder Aufzug, Küche mit Fenster, Dusche',
        '',
        'Ausstattungsbeschreibung',
        'Nachnutzer gesucht! Besichtigungen sind möglich!',
      ].join('\n'),
    );
  });

  it('reads a row by its label, wherever it sits in the table', () => {
    const expose = provider.parseExpose(
      exposeWith([
        {
          title: 'Preise und Kosten',
          rows: [
            ['Gesamtmiete', '1.405,00 €'],
            ['Mietpreis', '1.080,50 €'],
          ],
        },
      ]),
    );
    expect(expose.coldRent).toBe(1080.5);
    expect(expose.charges).toBe(324.5);
  });

  it('has no cold rent and no charges without a Mietpreis row', () => {
    const expose = provider.parseExpose(
      exposeWith([{ title: 'Preise und Kosten', rows: [['Gesamtmiete', '391,00 €']] }]),
    );
    expect(expose.coldRent).toBeNull();
    expect(expose.charges).toBeNull();
  });

  it('leaves out rows without a value', () => {
    const expose = provider.parseExpose(
      exposeWith([
        {
          title: 'Immobiliendetails',
          rows: [
            ['Frei ab', ' '],
            ['Etage', '3'],
          ],
        },
      ]),
    );
    expect(expose.description).toBe('Immobiliendetails\nEtage: 3');
  });

  it('leaves out a Wohnberechtigungsschein that is not needed, so a blacklist on the word keeps the flat', () => {
    const rows = (value) => [
      ['Mietpreis', '421,00 €'],
      ['Wohnberechtigungsschein', value],
    ];
    expect(provider.parseExpose(exposeWith([{ title: 'Preise und Kosten', rows: rows('Nein') }])).description).toBe(
      'Preise und Kosten\nMietpreis: 421,00 €',
    );
    expect(provider.parseExpose(exposeWith([{ title: 'Preise und Kosten', rows: rows('Ja') }])).description).toBe(
      'Preise und Kosten\nMietpreis: 421,00 €\nWohnberechtigungsschein: Ja',
    );
  });

  it('keeps the paragraphs of a text section', () => {
    const expose = provider.parseExpose(
      exposeWith([
        { title: 'Ausstattungsbeschreibung', text: '<p>Frisch renoviert.</p>\n   <p>Mit   Balkon.<br>Ab sofort.</p>' },
      ]),
    );
    expect(expose.description).toBe('Ausstattungsbeschreibung\nFrisch renoviert.\n\nMit Balkon.\nAb sofort.');
  });

  it('has neither description nor pictures for a page without sections', () => {
    const expose = provider.parseExpose('<html><body><main></main></body></html>');
    expect(expose.description).toBeNull();
    expect(expose.images).toEqual([]);
    expect(expose.buildYear).toBeNull();
  });

  it('returns null for no page at all', () => {
    expect(provider.parseExpose(null)).toBeNull();
  });
});

describe('#fetchDetails()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.runIf(process.env.TEST_MODE === 'offline')(
    'adds description, gallery and construction year, and replaces a total rent the search kept',
    async () => {
      const listing = {
        id: 'x',
        link: EXPOSE_LINK,
        title: 'Kleine, feine 2-Zimmerwohnung',
        price: 391,
        chargesIncluded: true,
      };
      const enriched = await provider.config.fetchDetails(listing);
      expect(enriched).toMatchObject({
        id: 'x',
        title: 'Kleine, feine 2-Zimmerwohnung',
        price: RECORDED_COLD_RENT,
        chargesIncluded: false,
        charges: RECORDED_CHARGES,
        buildYear: 1974,
      });
      expect(enriched.description).toMatch(/^Preise und Kosten\nMietpreis: 247,00 €/);
      expect(enriched.images).toHaveLength(12);
    },
  );

  it('hands the listing back untouched when the exposé cannot be loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') });
    const listing = { id: 'x', link: EXPOSE_LINK, title: 'Garage', price: 50 };
    expect(await provider.config.fetchDetails(listing)).toBe(listing);
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
        liveListings.forEach((listing) =>
          expect(listing).toMatchObject({
            price: RECORDED_COLD_RENT,
            chargesIncluded: false,
            charges: RECORDED_CHARGES,
          }),
        );
      }
    },
    TEST_TIMEOUT,
  );
});
