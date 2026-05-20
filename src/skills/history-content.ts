/**
 * Parse and strip persisted `[skill: id]` footers on user history rows.
 */

const SKILL_TAG_RE = /\n?\[skill:\s*([a-z0-9][a-z0-9-]*)\s*\]\s*$/i;

/** Remove the audit footer so the composer shows editable user text only. */
export function stripSkillTagFromHistory(content: string): string {
  return content.replace(SKILL_TAG_RE, '').trimEnd();
}

/** Read skill id and display text from a persisted user message. */
export function parseSkillTagFromHistory(content: string): {
  skillId: string | null;
  displayText: string;
} {
  const match = content.match(SKILL_TAG_RE);
  if (!match) {
    return { skillId: null, displayText: content };
  }
  const skillId = match[1];
  const displayText = content.replace(SKILL_TAG_RE, '').trimEnd();
  return { skillId, displayText };
}
