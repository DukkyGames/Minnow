/**
 * Node ESM hooks for Session Engine tsx imports (MIN-360).
 * Stubs .css and @xterm packages without setting MINNOW_TEST
 * (test-loader.mjs sets MINNOW_TEST=1 which would suppress board launches).
 *
 * Must self-register on --import (same pattern as test/test-loader.mjs).
 * Exporting resolve/load alone does not activate customization hooks.
 */

import { register } from 'node:module';

const LOADER_URL = import.meta.url;

/** Apply hooks when preloaded via `node --import ./server/session/engine-tsx-hooks.mjs`. */
if (!globalThis.__MINNOW_ENGINE_TSX_HOOKS_REGISTERED) {
  globalThis.__MINNOW_ENGINE_TSX_HOOKS_REGISTERED = true;
  register(LOADER_URL, LOADER_URL);
}

function isCssSpecifier(specifier) {
  const path = String(specifier).split('?')[0].split('#')[0];
  return path.endsWith('.css');
}

const XTERM_STUB = `
export class Terminal {
  constructor() {}
  open() {}
  loadAddon() {}
  writeln() {}
  write() {}
  dispose() {}
  onData() { return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
}
export default { Terminal };
`;

const FIT_STUB = `export class FitAddon { activate() {} fit() {} dispose() {} }`;
const WEB_LINKS_STUB = `export class WebLinksAddon { activate() {} dispose() {} }`;

function dataUrlForSource(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function cssStubSource(isUrlImport) {
  return isUrlImport ? 'export default "/stub.css";' : 'export default {};';
}

function cssStubUrl(isUrlImport) {
  return dataUrlForSource(cssStubSource(isUrlImport));
}

function isCssModuleUrl(url) {
  const s = String(url);
  if (isCssSpecifier(s)) return true;
  return s.startsWith('data:text/javascript,') && s.includes('?url');
}

export async function resolve(specifier, context, nextResolve) {
  if (isCssSpecifier(specifier)) {
    const isUrlImport = String(specifier).includes('?url');
    return { format: 'module', shortCircuit: true, url: cssStubUrl(isUrlImport) };
  }
  if (specifier === '@xterm/xterm') {
    return { format: 'module', shortCircuit: true, url: dataUrlForSource(XTERM_STUB) };
  }
  if (specifier === '@xterm/addon-fit') {
    return { format: 'module', shortCircuit: true, url: dataUrlForSource(FIT_STUB) };
  }
  if (specifier === '@xterm/addon-web-links') {
    return { format: 'module', shortCircuit: true, url: dataUrlForSource(WEB_LINKS_STUB) };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (isCssModuleUrl(url)) {
    const isUrlImport = String(url).includes('?url');
    return {
      format: 'module',
      shortCircuit: true,
      source: cssStubSource(isUrlImport),
    };
  }
  // Fallback when resolve was skipped (tsx sync path / absolute file URLs).
  if (url.includes('@xterm/xterm')) {
    return { format: 'module', shortCircuit: true, source: XTERM_STUB };
  }
  if (url.includes('@xterm/addon-fit')) {
    return { format: 'module', shortCircuit: true, source: FIT_STUB };
  }
  if (url.includes('@xterm/addon-web-links')) {
    return { format: 'module', shortCircuit: true, source: WEB_LINKS_STUB };
  }
  return nextLoad(url, context);
}

/** Register this loader + tsx once (idempotent; safe if already --import'ed). */
export function registerEngineTsxHooks() {
  const parent = LOADER_URL;
  try {
    register(parent, parent);
  } catch {
    /* duplicate ok */
  }
  try {
    register('tsx/esm', parent);
  } catch {
    /* duplicate ok */
  }
}
