/**
 * Reef mode: inline widget iframes in assistant bubbles.
 */

import { mountReefWidgetBlocks } from './widget-block-detector.ts';
import { initReefBridge, unmountReefWidgetsInChat } from './widget-bridge.ts';

export { initReefBridge, unmountReefWidgetsInChat };

/** Scan one assistant bubble for reef-widget fences and mount iframes. */
export function mountReefWidgets(bubble: HTMLElement): void {
  mountReefWidgetBlocks(bubble);
}
