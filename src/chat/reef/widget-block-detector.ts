/**
 * Scan assistant bubbles for ```reef-widget fences and mount sandboxed iframes.
 */

import { streaming } from '../../app-state.ts';
import { getActiveChat } from '../../state/sessions.ts';
import { createReefWidgetIframe } from './widget-iframe.ts';
import { registerReefWidgetHost } from './widget-bridge.ts';

const REEF_WIDGET_LANG = 'reef-widget';

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
 * Skips when not in reef mode, already mounted, or assistant is still streaming.
 */
export function mountReefWidgetBlocks(bubble: HTMLElement): void {
  if (getActiveChat().modeId !== 'reef') return;
  if (streaming) return;

  const pres = bubble.querySelectorAll<HTMLPreElement>(
    `pre[data-lang="${REEF_WIDGET_LANG}"]`,
  );

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
