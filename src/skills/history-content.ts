/**
 * Parse and strip persisted `[skill: id]` footers on user history rows.
 */

import { apiMessageContentToText } from '../api/message-content';

const SKILL_TAG_RE = /\n?\[skill:\s*([a-z0-9][a-z0-9-]*)\s*\]\s*$/i;

/**
 * History `content` is typed as a string, but leaked VLM rows may store
 * `ContentPart[]`. Callers must not invoke string methods on that.
 */
function historyUserText(content: unknown): string {
  return apiMessageContentToText(content);
}

/** Remove the audit footer so the composer shows editable user text only. */
export function stripSkillTagFromHistory(content: unknown): string {
  return historyUserText(content).replace(SKILL_TAG_RE, '').trimEnd();
}

/** Read skill id and display text from a persisted user message. */
export function parseSkillTagFromHistory(content: unknown): {
  skillId: string | null;
  displayText: string;
} {
  const text = historyUserText(content);
  const match = text.match(SKILL_TAG_RE);
  if (!match) {
    return { skillId: null, displayText: text };
  }
  const skillId = match[1];
  const displayText = text.replace(SKILL_TAG_RE, '').trimEnd();
  return { skillId, displayText };
}
