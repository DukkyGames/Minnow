/**
 * Gate the browser-allowlist prompt fragment until a preview browser tool runs.
 */

import type { Message } from '../../types';

/** Tool ids that imply built-in preview browser automation (navigation allowlist rules apply). */
export const BROWSER_PREVIEW_TOOL_IDS = new Set([
  'browser_list',
  'browser_navigate',
  'browser_new_tab',
  'browser_switch_tab',
  'browser_close_tab',
  'browser_snapshot',
  'browser_click',
  'browser_fill',
  'browser_eval',
  'browser_screenshot',
  'request_browser_origin_access',
]);

/** True when chat history includes an assistant tool call to a preview browser tool. */
export function chatHistoryHasBrowserToolUse(history: Message[]): boolean {
  for (const msg of history) {
    if (msg.role !== 'assistant' || !('tool_calls' in msg) || !msg.tool_calls?.length) {
      continue;
    }
    for (const call of msg.tool_calls) {
      const name = call.function?.name?.trim();
      if (name && BROWSER_PREVIEW_TOOL_IDS.has(name)) {
        return true;
      }
    }
  }
  return false;
}
