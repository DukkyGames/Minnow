/**
 * Scan assistant bubbles for ```reef-widget fences and mount sandboxed iframes.
 */

import { createReefWidgetIframe } from './widget-iframe.ts';
import { registerReefWidgetHost } from './widget-bridge.ts';
import { createReefWidgetValidatingStatus } from './widget-error-ui.ts';
import {
  applyReefWidgetPendingUi,
  inferReefWidgetBuildPhase,
} from './widget-pending-ui.ts';

const REEF_WIDGET_LANG = 'reef-widget';

/** Options for mounting; use per-bubble streaming, not global app-state. */
export interface MountReefWidgetBlocksOptions {
  /** True while this bubble's markdown is still streaming (debounced updates). */
  bubbleStreaming?: boolean;
  /**
   * Chat mode when the bubble was rendered (history). Mounting is mode-agnostic;
   * only Reef mode (or reef-widget sub-agent) should author new fences.
   */
  modeId?: string;
}

/** True when the code block looks like a complete fence (not an open stream tail). */
function isClosedReefFence(code: HTMLElement): boolean {
  const text = code.textContent ?? '';
  if (!text.trim()) return false;
  const parentPre = code.closest('pre');
  if (!parentPre) return false;
  if (parentPre.querySelector('.stream-cursor')) return false;
  return true;
}

/**
 * Replace matching `<pre data-lang="reef-widget">` nodes with iframe hosts.
 * All chat modes display mounted widgets; only Reef (or reef-widget sub-agent) creates fences.
 * When `bubbleStreaming`, shows pending UI instead of code and defers iframe mount until final.
 */
export function mountReefWidgetBlocks(
  bubble: HTMLElement,
  opts: MountReefWidgetBlocksOptions = {},
): void {
  const pres = bubble.querySelectorAll<HTMLPreElement>(
    `pre[data-lang="${REEF_WIDGET_LANG}"]`,
  );

  if (opts.bubbleStreaming === true) {
    pres.forEach((pre) => {
      if (pre.dataset.reefMounted === 'true') return;
      const code = pre.querySelector('code');
      if (!code) return;
      const body = code.textContent ?? '';
      const phase = inferReefWidgetBuildPhase(body);
      applyReefWidgetPendingUi(pre, phase);
    });
    return;
  }

  pres.forEach((pre) => {
    if (pre.dataset.reefMounted === 'true') return;

    const code = pre.querySelector('code');
    if (!code || !isClosedReefFence(code)) return;

    const widgetHtml = code.textContent ?? '';
    pre.dataset.reefMounted = 'true';

    const host = document.createElement('div');
    host.className = 'reef-widget-host reef-widget-host--validating';
    host.dataset.reefMounted = 'true';

    const { iframe, widgetId, setSrcdoc } = createReefWidgetIframe({ widgetHtml });
    host.dataset.widgetId = widgetId;
    host.appendChild(createReefWidgetValidatingStatus());
    iframe.style.visibility = 'hidden';
    host.appendChild(iframe);

    registerReefWidgetHost(widgetId, host, iframe, setSrcdoc, widgetHtml);
    pre.replaceWith(host);
  });
}
