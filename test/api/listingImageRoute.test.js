/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  userCanAccessListing: vi.fn(() => true),
  getListingById: vi.fn(() => ({ id: 'listing-1', job_id: 'job-1', image_url: 'https://example.com/photo.jpg' })),
  queryListings: vi.fn(),
  getListingsForMap: vi.fn(),
  getPriceHistory: vi.fn(),
  setListingNotes: vi.fn(),
  setListingAddress: vi.fn(),
  setListingStatus: vi.fn(),
  deleteListingsByJobId: vi.fn(),
  deleteListingsById: vi.fn(),
  restoreListingsById: vi.fn(),
  filterListingIdsForUser: vi.fn(),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({ toggleWatch: vi.fn(), ensureWatch: vi.fn() }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({
  getJob: vi.fn(() => ({ id: 'job-1', userId: 'owner-1' })),
}));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({ demoMode: false })),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/geocoding/distanceService.js', () => ({ updateDistancesForListing: vi.fn() }));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../../lib/services/images/listingImageCache.js', () => ({
  getCachedListingImage: vi.fn(() => null),
}));
vi.mock('../../lib/services/images/listingImageReload.js', () => ({
  reloadListingImageFromSource: vi.fn(async () => true),
}));

import * as listingStorage from '../../lib/services/storage/listingsStorage.js';
import { getCachedListingImage } from '../../lib/services/images/listingImageCache.js';
import { reloadListingImageFromSource } from '../../lib/services/images/listingImageReload.js';
import { isAdmin } from '../../lib/api/security.js';
import listingsPlugin from '../../lib/api/routes/listingsRouter.js';

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.session = { currentUser: 'user-1' };
    request.currentUser = { id: 'user-1' };
  });
  await app.register(listingsPlugin);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  listingStorage.userCanAccessListing.mockReturnValue(true);
  listingStorage.getListingById.mockReturnValue({
    id: 'listing-1',
    job_id: 'job-1',
    image_url: 'https://example.com/photo.jpg',
  });
  getCachedListingImage.mockReturnValue(null);
  reloadListingImageFromSource.mockResolvedValue(true);
  isAdmin.mockReturnValue(false);
});

describe('GET /:listingId/image', () => {
  it('serves the cached image bytes directly when one exists', async () => {
    getCachedListingImage.mockReturnValue({ data: Buffer.from([1, 2, 3]), mimeType: 'image/png' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/listing-1/image' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('redirects to the live image_url when nothing is cached yet', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/listing-1/image' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/photo.jpg');
  });

  it('404s when there is neither a cached image nor an image url', async () => {
    listingStorage.getListingById.mockReturnValue({ id: 'listing-1', job_id: 'job-1', image_url: null });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/listing-1/image' });

    expect(res.statusCode).toBe(404);
  });

  it('refuses access to a listing the user cannot see', async () => {
    listingStorage.userCanAccessListing.mockReturnValue(false);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/listing-1/image' });

    expect(res.statusCode).toBe(403);
    expect(getCachedListingImage).not.toHaveBeenCalled();
  });
});

describe('POST /:listingId/image/refresh', () => {
  it('downloads a fresh image and replaces the cache', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/listing-1/image/refresh' });

    expect(res.statusCode).toBe(200);
    expect(reloadListingImageFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'listing-1', image_url: 'https://example.com/photo.jpg' }),
    );
  });

  it('returns 502 when the refresh download fails', async () => {
    reloadListingImageFromSource.mockResolvedValue(false);

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/listing-1/image/refresh' });

    expect(res.statusCode).toBe(502);
  });

  it('404s when the listing has neither an image url nor a link to refresh from', async () => {
    listingStorage.getListingById.mockReturnValue({ id: 'listing-1', job_id: 'job-1', image_url: null, link: null });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/listing-1/image/refresh' });

    expect(res.statusCode).toBe(404);
    expect(reloadListingImageFromSource).not.toHaveBeenCalled();
  });

  it('still tries when the image url is dead but a link is available to rediscover from', async () => {
    listingStorage.getListingById.mockReturnValue({
      id: 'listing-1',
      job_id: 'job-1',
      image_url: null,
      link: 'https://example.com/listing/1',
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/listing-1/image/refresh' });

    expect(res.statusCode).toBe(200);
    expect(reloadListingImageFromSource).toHaveBeenCalled();
  });

  it('refuses access to a listing the user cannot see', async () => {
    listingStorage.userCanAccessListing.mockReturnValue(false);

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/listing-1/image/refresh' });

    expect(res.statusCode).toBe(403);
  });
});
