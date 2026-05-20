/**
 * Node loader for tsx tests: stub .css and @xterm packages that break under node --test.
 */

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

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
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
