/**
 * Build sandboxed iframe srcdoc for a reef widget fence body.
 */

import { buildThemeCssBlock, readThemeVarsFromHost } from './theme-forward.ts';
import { injectWidgetIdIntoPrelude, PRELUDE_SCRIPT } from './widget-prelude.ts';

/** CDN hosts allowed in widget CSP (matches reef.full.md). */
const REEF_CSP_HOSTS =
  'https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com';

const REEF_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${REEF_CSP_HOSTS}`,
  "style-src 'unsafe-inline'",
  `connect-src ${REEF_CSP_HOSTS}`,
].join('; ');

/** esm.sh import map pins (reef.full.md). */
const REEF_IMPORT_MAP = {
  imports: {
    react: 'https://esm.sh/react@19?dev',
    'react-dom/client': 'https://esm.sh/react-dom@19/client?dev',
    recharts: 'https://esm.sh/recharts@2?deps=react@19,react-dom@19',
    lodash: 'https://esm.sh/lodash-es@4',
    mathjs: 'https://esm.sh/mathjs@14',
  },
} as const;

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
  const widgetHtml = options.widgetHtml.trim();

  const importMapJson = JSON.stringify(REEF_IMPORT_MAP).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${REEF_CSP}">
<style>
${themeCss}
html, body { margin: 0; padding: 8px; box-sizing: border-box; min-height: ${minH}px; background: var(--bg, transparent); color: var(--text, inherit); font-family: var(--font-ui, system-ui, sans-serif); }
*, *::before, *::after { box-sizing: border-box; }
</style>
<script type="importmap">${importMapJson}</script>
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

  const setSrcdoc = (widgetHtml: string): void => {
    iframe.srcdoc = buildReefWidgetSrcdoc({
      ...options,
      widgetId,
      widgetHtml,
    });
  };

  setSrcdoc(options.widgetHtml);
  return { iframe, widgetId, setSrcdoc };
}

/** Expose import map JSON for tests. */
export function getReefImportMapJsonForTests(): string {
  return JSON.stringify(REEF_IMPORT_MAP);
}
