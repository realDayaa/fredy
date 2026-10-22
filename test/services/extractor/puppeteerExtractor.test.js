/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the CloakBrowser launcher so no real Chromium binary is needed and we can
// assert which options get forwarded to it.
const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock('cloakbrowser/puppeteer', () => ({
  launch: launchMock,
}));

const { launchBrowser, closeBrowser } = await import('../../../lib/services/extractor/puppeteerExtractor.js');

/**
 * Builds a browser test double around a fake Chromium child process.
 *
 * @param {object} [options]
 * @param {boolean} [options.closeFails] let `close()` reject, as it does once the CDP connection died
 * @param {boolean} [options.alive] whether the child process is still running when `close()` returned
 * @returns {{browser: object, childProcess: object, close: import('vitest').Mock}}
 */
function createBrowser({ closeFails = false, alive = true } = {}) {
  const childProcess = {
    pid: 4711,
    exitCode: alive ? null : 0,
    signalCode: null,
    kill: vi.fn(() => true),
  };
  const close = vi.fn(async () => {
    if (closeFails) throw new Error('Connection closed');
  });
  return { browser: { close, process: () => childProcess }, childProcess, close };
}

describe('launchBrowser proxy forwarding', () => {
  beforeEach(() => {
    launchMock.mockReset();
    launchMock.mockResolvedValue({ close: async () => {} });
  });

  it('forwards proxyUrl to CloakBrowser as the proxy option', async () => {
    await launchBrowser('https://www.immowelt.de/', { proxyUrl: 'http://user:pass@host:8080' });

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0][0]).toMatchObject({ proxy: 'http://user:pass@host:8080' });
  });

  it("switches off Puppeteer's signal handlers so they cannot kill Chromium before shutdown closes it", async () => {
    await launchBrowser('https://www.immowelt.de/', {});

    expect(launchMock.mock.calls[0][0].launchOptions).toEqual({
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  });

  it('does not set a proxy when no proxyUrl is given', async () => {
    await launchBrowser('https://www.immowelt.de/', {});

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0][0].proxy).toBeUndefined();
  });
});

describe('launchBrowser fingerprint platform', () => {
  const originalPlatform = process.platform;

  /** @param {string} platform the value `process.platform` should report */
  function pretendPlatform(platform) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  beforeEach(() => {
    launchMock.mockReset();
    launchMock.mockResolvedValue({ close: async () => {} });
  });

  afterEach(() => {
    pretendPlatform(originalPlatform);
  });

  it('poses as Linux on a Linux host instead of the Windows default', async () => {
    pretendPlatform('linux');

    await launchBrowser('https://www.immowelt.de/', {});

    expect(launchMock.mock.calls[0][0].args).toContain('--fingerprint-platform=linux');
  });

  it("leaves CloakBrowser's own platform choice alone elsewhere", async () => {
    pretendPlatform('darwin');

    await launchBrowser('https://www.immowelt.de/', {});

    expect(launchMock.mock.calls[0][0].args.some((arg) => arg.startsWith('--fingerprint-platform'))).toBe(false);
  });
});

describe('closeBrowser', () => {
  /** @type {import('vitest').MockInstance} */
  let killSpy;

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('does nothing when there is no browser', async () => {
    await expect(closeBrowser(null)).resolves.toBeUndefined();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('closes the browser and does not signal a process that already exited', async () => {
    const { browser, childProcess, close } = createBrowser({ alive: false });

    await closeBrowser(browser);

    expect(close).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
    expect(childProcess.kill).not.toHaveBeenCalled();
  });

  it('kills the process group when close() rejected and Chromium is still running', async () => {
    const { browser, childProcess } = createBrowser({ closeFails: true });

    await closeBrowser(browser);

    // negative pid = the detached process group, so the helper processes go down with the browser
    expect(killSpy).toHaveBeenCalledWith(-4711, 'SIGKILL');
    expect(childProcess.kill).not.toHaveBeenCalled();
  });

  it('falls back to killing the single process when there is no process group', async () => {
    const { browser, childProcess } = createBrowser({ closeFails: true });
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });

    await closeBrowser(browser);

    expect(childProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('swallows a kill that fails because the process is already gone', async () => {
    const { browser, childProcess } = createBrowser({ closeFails: true });
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });
    childProcess.kill.mockImplementation(() => {
      throw new Error('ESRCH');
    });

    await expect(closeBrowser(browser)).resolves.toBeUndefined();
  });

  it('still closes the browser when reading its process handle throws', async () => {
    // CloakBrowser re-validates the license on every call made through the returned browser.
    // Once the plan's concurrent session limit is hit, `.process()` itself throws - that must
    // not stop close()/the kill fallback from running, or the session leaks and the limit never
    // recovers.
    const close = vi.fn(async () => {});
    const browser = {
      close,
      process: () => {
        throw new Error('CloakBrowser Pro: session limit reached for your plan.');
      },
    };

    await expect(closeBrowser(browser)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
  });
});

describe('closeAllBrowsers', () => {
  // The shutdown flag lives at module scope and never resets, so every test gets a fresh module.
  /** @type {typeof import('../../../lib/services/extractor/puppeteerExtractor.js')} */
  let extractor;
  /** @type {import('vitest').MockInstance} */
  let killSpy;

  beforeEach(async () => {
    vi.resetModules();
    launchMock.mockReset();
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    extractor = await import('../../../lib/services/extractor/puppeteerExtractor.js');
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('closes every launched browser that was not closed yet', async () => {
    const first = createBrowser({ alive: false });
    const second = createBrowser({ alive: false });
    launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    await extractor.launchBrowser('https://www.immowelt.de/', {});
    await extractor.launchBrowser('https://www.immowelt.de/', {});
    await extractor.closeBrowser(first.browser);

    await extractor.closeAllBrowsers();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('refuses to launch a browser once the shutdown began', async () => {
    await extractor.closeAllBrowsers();

    await expect(extractor.launchBrowser('https://www.immowelt.de/', {})).rejects.toThrow(/shutting down/);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('closes a browser whose launch only finished after the shutdown began', async () => {
    const { browser, close } = createBrowser({ alive: false });
    let finishLaunch;
    launchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLaunch = () => resolve(browser);
      }),
    );
    const launching = extractor.launchBrowser('https://www.immowelt.de/', {});

    await extractor.closeAllBrowsers();
    finishLaunch();

    await expect(launching).rejects.toThrow(/shutting down/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('kills the process group of a browser whose close() does not finish in time', async () => {
    const { browser, close } = createBrowser();
    close.mockImplementation(() => new Promise(() => {}));
    launchMock.mockResolvedValueOnce(browser);
    await extractor.launchBrowser('https://www.immowelt.de/', {});

    await extractor.closeAllBrowsers(10);

    expect(killSpy).toHaveBeenCalledWith(-4711, 'SIGKILL');
  });
});
