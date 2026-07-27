/**
 * Node loader hooks for server-side dev TS imports (CSS + xterm stubs).
 */

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
