/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from './logger.js';
import { closeAllBrowsers } from './extractor/puppeteerExtractor.js';

/**
 * The signals that end Fredy: SIGTERM from `docker stop` (tini forwards it), SIGINT from Ctrl+C,
 * SIGHUP from a closed terminal, and SIGUSR2, which nodemon sends before every restart in
 * development. The first three are the ones Puppeteer would otherwise handle itself, which
 * `launchBrowser` switches off.
 */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGUSR2'];

/** @type {Promise<void> | null} */
let shutdownPromise = null;

/**
 * Close every open browser before the process goes away.
 *
 * Without this, node died on the first SIGTERM and the Chromium processes, which live in their own
 * process group and never see the signal, were SIGKILLed with the container. Safe to call more than
 * once; every caller gets the same run.
 *
 * @param {string} signal - Only used for the log line.
 * @returns {Promise<void>}
 */
export function shutdown(signal) {
  if (!shutdownPromise) {
    logger.info(`Received ${signal}, closing open browsers before exiting.`);
    shutdownPromise = closeAllBrowsers().catch((err) => {
      logger.error('Closing the browsers on shutdown failed', err);
    });
  }
  return shutdownPromise;
}

/**
 * Exit through {@link shutdown} on every signal in {@link SHUTDOWN_SIGNALS}.
 *
 * `once`, so a second Ctrl+C falls through to node's default handling and ends the process at once.
 *
 * @returns {void}
 */
export function registerShutdownHandlers() {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      shutdown(signal).finally(() => process.exit(0));
    });
  }
}
