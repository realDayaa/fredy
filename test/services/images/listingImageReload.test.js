/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../lib/utils.js', () => ({ getProviders: vi.fn() }));
vi.mock('../../../lib/services/storage/listingsStorage.js', () => ({ updateListingImageUrl: vi.fn() }));
vi.mock('../../../lib/services/images/listingImageCache.js', () => ({ refreshListingImage: vi.fn() }));
vi.mock('../../../lib/services/logger.js', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getProviders } from '../../../lib/utils.js';
import { updateListingImageUrl } from '../../../lib/services/storage/listingsStorage.js';
import { refreshListingImage } from '../../../lib/services/images/listingImageCache.js';
import { reloadListingImageFromSource } from '../../../lib/services/images/listingImageReload.js';

beforeEach(() => {
  vi.clearAllMocks();
  refreshListingImage.mockResolvedValue(true);
});

describe('reloadListingImageFromSource', () => {
  it('uses a rediscovered URL when the provider supplies one, and records it', async () => {
    getProviders.mockResolvedValue([
      {
        metaInformation: { id: 'froheZukunft' },
        config: { rediscoverImage: vi.fn(async () => 'https://fresh.example/photo.jpg') },
      },
    ]);

    const listing = {
      id: 'l1',
      provider: 'froheZukunft',
      link: 'https://example.com/l1',
      image_url: 'https://dead.example/old.jpg',
    };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(true);
    expect(updateListingImageUrl).toHaveBeenCalledWith('l1', 'https://fresh.example/photo.jpg');
    expect(refreshListingImage).toHaveBeenCalledWith('l1', 'https://fresh.example/photo.jpg');
  });

  it('falls back to the stored image url when the provider has no rediscoverImage hook', async () => {
    getProviders.mockResolvedValue([{ metaInformation: { id: 'immoscout' }, config: {} }]);

    const listing = {
      id: 'l1',
      provider: 'immoscout',
      link: 'https://example.com/l1',
      image_url: 'https://stable.example/photo.jpg',
    };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(true);
    expect(updateListingImageUrl).not.toHaveBeenCalled();
    expect(refreshListingImage).toHaveBeenCalledWith('l1', 'https://stable.example/photo.jpg');
  });

  it('falls back to the stored image url when rediscoverImage finds nothing', async () => {
    getProviders.mockResolvedValue([
      { metaInformation: { id: 'froheZukunft' }, config: { rediscoverImage: vi.fn(async () => null) } },
    ]);

    const listing = {
      id: 'l1',
      provider: 'froheZukunft',
      link: 'https://example.com/l1',
      image_url: 'https://dead.example/old.jpg',
    };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(true);
    expect(updateListingImageUrl).not.toHaveBeenCalled();
    expect(refreshListingImage).toHaveBeenCalledWith('l1', 'https://dead.example/old.jpg');
  });

  it('does not bother updating the stored url when the rediscovered one is unchanged', async () => {
    getProviders.mockResolvedValue([
      {
        metaInformation: { id: 'froheZukunft' },
        config: { rediscoverImage: vi.fn(async () => 'https://same.example/photo.jpg') },
      },
    ]);

    const listing = {
      id: 'l1',
      provider: 'froheZukunft',
      link: 'https://example.com/l1',
      image_url: 'https://same.example/photo.jpg',
    };
    await reloadListingImageFromSource(listing);

    expect(updateListingImageUrl).not.toHaveBeenCalled();
  });

  it('returns false without calling refreshListingImage when there is no URL at all', async () => {
    getProviders.mockResolvedValue([]);

    const listing = { id: 'l1', provider: 'froheZukunft', link: 'https://example.com/l1', image_url: null };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(false);
    expect(refreshListingImage).not.toHaveBeenCalled();
  });

  it('falls back to the stored url when the provider cannot be found at all', async () => {
    getProviders.mockResolvedValue([]);

    const listing = {
      id: 'l1',
      provider: 'unknownProvider',
      link: null,
      image_url: 'https://stable.example/photo.jpg',
    };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(true);
    expect(refreshListingImage).toHaveBeenCalledWith('l1', 'https://stable.example/photo.jpg');
  });

  it('falls back to the stored url when rediscoverImage itself throws', async () => {
    getProviders.mockResolvedValue([
      {
        metaInformation: { id: 'froheZukunft' },
        config: {
          rediscoverImage: vi.fn(async () => {
            throw new Error('boom');
          }),
        },
      },
    ]);

    const listing = {
      id: 'l1',
      provider: 'froheZukunft',
      link: 'https://example.com/l1',
      image_url: 'https://stable.example/photo.jpg',
    };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(true);
    expect(refreshListingImage).toHaveBeenCalledWith('l1', 'https://stable.example/photo.jpg');
  });

  it('falls back to the stored url when getProviders itself rejects', async () => {
    getProviders.mockRejectedValue(new Error('registry unavailable'));

    const listing = {
      id: 'l1',
      provider: 'froheZukunft',
      link: 'https://example.com/l1',
      image_url: 'https://stable.example/photo.jpg',
    };
    const result = await reloadListingImageFromSource(listing);

    expect(result).toBe(true);
    expect(refreshListingImage).toHaveBeenCalledWith('l1', 'https://stable.example/photo.jpg');
  });

  it('does nothing for a falsy listing', async () => {
    const result = await reloadListingImageFromSource(null);

    expect(result).toBe(false);
    expect(getProviders).not.toHaveBeenCalled();
  });
});
