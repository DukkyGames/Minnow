/**
 * Lazy tsx registration plus CSS/@xterm stubs for dev-only TS imports on the server.
 */

import { register } from 'node:module';

/** @type {boolean} */
let devImportsReady = false;

const LOADER_URL = new URL('./dev-import-loader.mjs', import.meta.url).href;

async function ensureDevImports() {
  if (devImportsReady) return;
  const { register: registerTsx } = await import('tsx/esm/api');
  register(LOADER_URL, import.meta.url);
  registerTsx();
  devImportsReady = true;
}

/**
 * @template T
 * @param {string} specifier Path relative to this file
 * @returns {Promise<T>}
 */
export async function importTsModule(specifier) {
  await ensureDevImports();
  const url = specifier.startsWith('file:') ? specifier : new URL(specifier, import.meta.url).href;
  return /** @type {Promise<T>} */ (import(url));
}
