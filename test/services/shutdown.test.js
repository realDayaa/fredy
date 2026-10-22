/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const { closeAllBrowsersMock } = vi.hoisted(() => ({ closeAllBrowsersMock: vi.fn() }));

vi.mock('../../lib/services/extractor/puppeteerExtractor.js', () => ({
  closeAllBrowsers: closeAllBrowsersMock,
}));

describe('shutdown', () => {
  /** @type {typeof import('../../lib/services/shutdown.js')} */
  let shutdownModule;

  beforeEach(async () => {
    vi.resetModules();
    closeAllBrowsersMock.mockReset();
    closeAllBrowsersMock.mockResolvedValue(undefined);
    shutdownModule = await import('../../lib/services/shutdown.js');
  });

  it('closes the browsers only once, however often it is called', async () => {
    await Promise.all([shutdownModule.shutdown('SIGTERM'), shutdownModule.shutdown('SIGINT')]);
    await shutdownModule.shutdown('SIGTERM');

    expect(closeAllBrowsersMock).toHaveBeenCalledTimes(1);
  });

  it('still resolves when closing the browsers fails, so the process can exit', async () => {
    closeAllBrowsersMock.mockRejectedValue(new Error('boom'));

    await expect(shutdownModule.shutdown('SIGTERM')).resolves.toBeUndefined();
  });
});
