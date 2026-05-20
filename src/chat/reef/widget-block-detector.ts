/**
 * Scan assistant bubbles for ```reef-widget fences and mount sandboxed iframes.
 */

import { getActiveChat } from '../../state/sessions.ts';
import { createReefWidgetIframe } from './widget-iframe.ts';
import { registerReefWidgetHost } from './widget-bridge.ts';
import {
  applyReefWidgetPendingUi,
  inferReefWidgetBuildPhase,
} from './widget-pending-ui.ts';

const REEF_WIDGET_LANG = 'reef-widget';

/** Options for mounting; use per-bubble streaming, not global app-state. */
export interface MountReefWidgetBlocksOptions {
  /** True while this bubble's markdown is still streaming (debounced updates). */
  bubbleStreaming?: boolean;
  /** Chat mode for this bubble; avoids re-reading global session during history render. */
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
 * Skips when not in reef mode or already mounted. When `bubbleStreaming`, shows
 * pending UI instead of code and defers iframe mount until the final render.
 */
export function mountReefWidgetBlocks(
  bubble: HTMLElement,
  opts: MountReefWidgetBlocksOptions = {},
): void {
  const effectiveModeId = opts.modeId ?? getActiveChat().modeId;
  if (effectiveModeId !== 'reef') return;

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
    host.className = 'reef-widget-host';
    host.dataset.reefMounted = 'true';

    const { iframe, widgetId, setSrcdoc } = createReefWidgetIframe({ widgetHtml });
    host.dataset.widgetId = widgetId;
    host.appendChild(iframe);

    registerReefWidgetHost(widgetId, host, iframe, setSrcdoc, widgetHtml);
    pre.replaceWith(host);
  });
}
