/**
 * Build leading system messages for LM Studio (composed prompt + optional user rules).
 */

import type { ApiMessage } from '../types';

export interface OutboundSystemMessageOptions {
  /** Pre-composed programmatic stack (Step 04). */
  composedSystemPrompt?: string;
  /** Legacy #systemPrompt textarea fallback. */
  legacySysPrompt: string;
  /** Second system message when user rules are enabled (Feature 24). */
  userRulesContent?: string;
}

/** Append one or two system messages before chat history. */
export function pushOutboundSystemMessages(
  messages: ApiMessage[],
  options: OutboundSystemMessageOptions,
): void {
  const systemContent =
    options.composedSystemPrompt?.trim() || options.legacySysPrompt.trim();
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }
  const userRules = options.userRulesContent?.trim();
  if (userRules) {
    messages.push({ role: 'system', content: userRules });
  }
}
