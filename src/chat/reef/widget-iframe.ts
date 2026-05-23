/**
 * Build sandboxed iframe srcdoc for a reef widget fence body.
 */

import { REEF_WIDGET_BASELINE_CSS } from './widget-baseline-styles.ts';
import { buildThemeCssBlock, readThemeVarsFromHost } from './theme-forward.ts';
import { REEF_JSX_CSS_VAR_GUARD_NOTE } from './widget-jsx-guard.ts';
import { injectWidgetIdIntoPrelude, PRELUDE_SCRIPT } from './widget-prelude.ts';

/** CDN hosts allowed in widget CSP (matches reef.full.md). */
const REEF_CSP_HOSTS =
  'https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com';

const REEF_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' blob: ${REEF_CSP_HOSTS}`,
  "style-src 'unsafe-inline'",
  `connect-src ${REEF_CSP_HOSTS}`,
].join('; ');

/** esm.sh import map pins (reef.full.md). */
const REEF_IMPORT_MAP = {
  imports: {
    react: 'https://esm.sh/react@19',
    'react-dom/client': 'https://esm.sh/react-dom@19/client',
    recharts: 'https://esm.sh/recharts@2?deps=react@19,react-dom@19',
    lodash: 'https://esm.sh/lodash-es@4',
    mathjs: 'https://esm.sh/mathjs@14',
  },
} as const;

/** Bare-specifier → CDN URL map for blob-URL modules (no import map in blob: scope). */
const JSX_SPECIFIER_MAP: Record<string, string> = {
  react: 'https://esm.sh/react@19',
  'react/jsx-runtime': 'https://esm.sh/react@19/jsx-runtime',
  'react-dom': 'https://esm.sh/react-dom@19',
  'react-dom/client': 'https://esm.sh/react-dom@19/client',
  recharts: 'https://esm.sh/recharts@2?deps=react@19,react-dom@19',
  lodash: 'https://esm.sh/lodash-es@4',
  mathjs: 'https://esm.sh/mathjs@14',
};

const BABEL_CDN_URL =
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js';

/**
 * True when the widget HTML contains JSX patterns inside a <script type="module"> block.
 * Detects className= (JSX prop) or uppercase JSX component names (<Component).
 */
function widgetHasJsx(html: string): boolean {
  const scriptRe =
    /<script(?:\s[^>]*)?\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1];
    if (/className\s*=|<[A-Z][A-Za-z0-9]*[\s/>]/.test(body)) return true;
  }
  return false;
}

/** Change every <script type="module"> to <script type="text/jsx"> so the browser ignores them. */
function markModuleScriptsAsJsx(html: string): string {
  return html.replace(
    /(<script(?:\s[^>]*)?)(\btype\s*=\s*["'])module(["'])/gi,
    '$1$2text/jsx$3',
  );
}

/**
 * Inline script that loads Babel standalone and transforms text/jsx scripts.
 * Runs after DOMContentLoaded so body scripts are available.
 * Import specifiers are rewritten to CDN URLs so blob: modules work without an import map.
 */
function buildJsxRunnerScript(specifierMap: Record<string, string>): string {
  const mapJson = JSON.stringify(specifierMap);
  const guardNoteJson = JSON.stringify(REEF_JSX_CSS_VAR_GUARD_NOTE);
  /* eslint-disable no-useless-escape */
  return `(function(){
var __im=${mapJson};
var __guardNote=${guardNoteJson};
function __res(c){
  return c
    .replace(/\\bfrom\\s+(["'])([\\w@][^"']*)\\1/g,function(m,q,s){return 'from "'+(__im[s]||s)+'"';})
    .replace(/\\bimport\\s+(["'])([\\w@][^"']*)\\1/g,function(m,q,s){return 'import "'+(__im[s]||s)+'"';});
}
function __quoteCssVarsInJsx(src){
  var n=0;
  var out=src.replace(/:\\s*var\\((--[\\w-]+)\\)/g,function(m,t){n++;return ": 'var("+t+")'";});
  if(n>0) console.warn(__guardNote+' ('+n+' fix'+(n===1?'':'es')+')');
  return out;
}
function __run(){
  if(typeof Babel==='undefined'){console.warn('[reef] Babel not loaded; JSX widgets skipped.');return;}
  var ss=document.querySelectorAll('script[type="text/jsx"]');
  for(var i=0;i<ss.length;i++){(function(s){
    try{
      var src=__quoteCssVarsInJsx(s.textContent);
      var out=Babel.transform(src,{presets:[['react',{runtime:'classic'}]]});
      var src=__res(out.code);
      var blob=new Blob([src],{type:'text/javascript'});
      var url=URL.createObjectURL(blob);
      import(url).catch(function(e){console.error('[reef] Widget error:',e);}).finally(function(){URL.revokeObjectURL(url);});
    }catch(e){console.error('[reef] JSX transform error:',e);}
  })(ss[i]);}
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__run,{once:true});}else{__run();}
})();`;
}

let widgetIdCounter = 0;

/** Stable unique id per mounted widget (tests can reset via resetReefWidgetIdCounterForTests). */
export function nextReefWidgetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  widgetIdCounter += 1;
  return `reef-widget-${widgetIdCounter}`;
}

export function resetReefWidgetIdCounterForTests(): void {
  widgetIdCounter = 0;
}

export interface ReefWidgetIframeOptions {
  widgetHtml: string;
  widgetId?: string;
  themeVars?: Record<string, string>;
  minHeightPx?: number;
}

/** Full srcdoc HTML for a reef widget iframe. */
export function buildReefWidgetSrcdoc(options: ReefWidgetIframeOptions): string {
  const widgetId = options.widgetId ?? nextReefWidgetId();
  const themeVars = options.themeVars ?? readThemeVarsFromHost();
  const themeCss = buildThemeCssBlock(themeVars);
  const prelude = injectWidgetIdIntoPrelude(PRELUDE_SCRIPT, widgetId);
  const minH = options.minHeightPx ?? 120;
  const rawWidgetHtml = options.widgetHtml.trim();

  const needsJsx = widgetHasJsx(rawWidgetHtml);
  const widgetHtml = needsJsx ? markModuleScriptsAsJsx(rawWidgetHtml) : rawWidgetHtml;

  const importMapJson = JSON.stringify(REEF_IMPORT_MAP).replace(/</g, '\\u003c');

  /* Babel CDN + runner only injected when JSX is detected. */
  const jsxHeadScripts = needsJsx
    ? `\n<script src="${BABEL_CDN_URL}"></script>\n<script>${buildJsxRunnerScript(JSX_SPECIFIER_MAP)}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${REEF_CSP}">
<style>
${themeCss}
${REEF_WIDGET_BASELINE_CSS}
html, body { margin: 0; padding: 8px; box-sizing: border-box; min-height: ${minH}px; width: 100%; max-width: 100%; overflow-x: hidden; overflow-y: visible; background: var(--bg, transparent); color: var(--text, inherit); font-family: var(--font-ui, system-ui, sans-serif); }
*, *::before, *::after { box-sizing: border-box; }
</style>
<script type="importmap">${importMapJson}</script>${jsxHeadScripts}
</head>
<body>
${widgetHtml}
<script>${prelude.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}

export interface CreateReefWidgetIframeOptions extends ReefWidgetIframeOptions {
  /** Called when theme tokens change on the host. */
  onThemeUpdate?: (srcdoc: string) => void;
}

/** Create iframe element configured for reef widgets. */
export function createReefWidgetIframe(
  options: CreateReefWidgetIframeOptions,
): { iframe: HTMLIFrameElement; widgetId: string; setSrcdoc: (html: string) => void } {
  const widgetId = options.widgetId ?? nextReefWidgetId();
  const iframe = document.createElement('iframe');
  iframe.className = 'reef-widget-iframe';
  iframe.title = 'Reef widget';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.referrerPolicy = 'no-referrer';
  iframe.style.width = '100%';
  iframe.style.minHeight = `${options.minHeightPx ?? 120}px`;
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  /* Host auto-sizes height from content; widgets must not set outer iframe dimensions. */
  iframe.style.overflow = 'hidden';

  const setSrcdoc = (widgetHtml: string): void => {
    iframe.srcdoc = buildReefWidgetSrcdoc({
      ...options,
      widgetId,
      widgetHtml,
    });
  };

  /* Caller must invoke setSrcdoc after the iframe is connected in the document tree. */
  return { iframe, widgetId, setSrcdoc };
}

/** Expose import map JSON for tests. */
export function getReefImportMapJsonForTests(): string {
  return JSON.stringify(REEF_IMPORT_MAP);
}

/** Expose JSX detection for tests. */
export function widgetHasJsxForTests(html: string): boolean {
  return widgetHasJsx(html);
}
