/**
 * Reef mode: inline widget iframes in assistant bubbles.
 */

import {
  mountReefWidgetBlocks,
  type MountReefWidgetBlocksOptions,
} from './widget-block-detector.ts';
import { initReefBridge, unmountReefWidgetsInChat } from './widget-bridge.ts';

export {
  initReefBridge,
  unmountReefWidgetsInChat,
  completeReefWidgetValidation,
  type ReefWidgetValidationResult,
} from './widget-bridge.ts';
export type { MountReefWidgetBlocksOptions };
export { setSkipReefWidgetValidationForTests } from './widget-validation.ts';

/** Scan one assistant bubble for reef-widget fences and mount iframes. */
export function mountReefWidgets(
  bubble: HTMLElement,
  opts?: MountReefWidgetBlocksOptions,
): void {
  mountReefWidgetBlocks(bubble, opts);
}
