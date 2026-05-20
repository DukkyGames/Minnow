/**
 * Node loader for tsx tests: stub .css and @xterm packages that break under node --test.
 */

import { register } from 'node:module';

const LOADER_URL = new URL('./test-loader.mjs', import.meta.url).href;

/** Apply hooks in node:test worker threads (Node 20+). */
if (!globalThis.__MINNOW_TEST_LOADER_REGISTERED) {
  globalThis.__MINNOW_TEST_LOADER_REGISTERED = true;
  register(LOADER_URL, import.meta.url);
}

/** True when Node is loading a stylesheet side-effect import in tests. */
function isCssModuleUrl(url) {
  const path = url.split('?')[0].split('#')[0];
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

const EMPTY_MODULE_URL = 'data:text/javascript,export default {}';

function dataUrlForSource(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

/** Intercept xterm/css before tsx hits unknown file extensions. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, url: EMPTY_MODULE_URL };
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
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default {};',
    };
  }
  if (url.includes('@xterm/xterm')) {
    return { format: 'module', shortCircuit: true, source: XTERM_STUB };
  }
  if (url.includes('@xterm/addon-fit')) {
    return { format: 'module', shortCircuit: true, source: FIT_STUB };
  }
  if (url.includes('@xterm/addon-web-links')) {
    return { format: 'module', shortCircuit: true, source: WEB_LINKS_STUB };
  }
  return nextLoad(url);
}
