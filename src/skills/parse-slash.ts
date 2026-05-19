/**
 * Detect /skill-id in composer text (first match only).
 */

const SLASH_SKILL_RE = /(?:^|\s)\/([a-z0-9][a-z0-9-]*)\b/;

export interface ParsedSlashCommand {
  skillId: string | null;
  userText: string;
}

/**
 * Extract the first slash skill token and remaining user text.
 * Example: `/git-commit fix bug` → skillId git-commit, userText `fix bug`.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand {
  const trimmed = text.trim();
  if (!trimmed) {
    return { skillId: null, userText: '' };
  }

  const match = trimmed.match(SLASH_SKILL_RE);
  if (!match || match.index == null) {
    return { skillId: null, userText: trimmed };
  }

  const skillId = match[1];
  const leadingWs = match[0].startsWith(' ') ? 1 : 0;
  const removeStart = match.index + leadingWs;
  const removeEnd = removeStart + match[0].length - leadingWs;

  const userText = `${trimmed.slice(0, removeStart)}${trimmed.slice(removeEnd)}`
    .replace(/\s+/g, ' ')
    .trim();

  return { skillId, userText };
}

/** Append audit footer for persisted history when a skill was used. */
export function formatHistoryWithSkillTag(userText: string, skillId: string): string {
  const tag = `[skill: ${skillId}]`;
  const base = userText.trim();
  return base ? `${base}\n\n${tag}` : tag;
}
