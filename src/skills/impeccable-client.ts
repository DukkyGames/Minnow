/**
 * Client-side Impeccable sub-command parsing and reference injection for /impeccable sends.
 */

import commandMetadata from './impeccable/scripts/command-metadata.json';

export const IMPECCABLE_SKILL_ID = 'impeccable';

const IMPECCABLE_COMMANDS = new Set(Object.keys(commandMetadata as Record<string, unknown>));

/** Harness references injected alongside the primary slash command. */
export const HARNESS_PREREQUISITE_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  craft: ['shape'],
};

const COMMAND_WORD_RE = /^([a-z][a-z0-9-]*)\b/i;

export interface ParsedImpeccableSubcommand {
  command: string | null;
  target: string;
}

/**
 * Parse text after `/impeccable` (from parseSlashCommand userText).
 * First word must be a known Impeccable command; remainder is the target hint.
 */
export function parseImpeccableSubcommand(userText: string): ParsedImpeccableSubcommand {
  let rest = userText.trim();
  if (!rest) {
    return { command: null, target: '' };
  }

  const lower = rest.toLowerCase();
  if (lower.startsWith('/impeccable')) {
    rest = rest.slice('/impeccable'.length).trim();
  } else if (lower.startsWith('impeccable ')) {
    rest = rest.slice('impeccable'.length).trim();
  }

  if (!rest) {
    return { command: null, target: '' };
  }

  const match = rest.match(COMMAND_WORD_RE);
  if (!match) {
    return { command: null, target: rest };
  }

  const candidate = match[1].toLowerCase();
  if (!IMPECCABLE_COMMANDS.has(candidate)) {
    return { command: null, target: rest };
  }

  const target = rest.slice(match[0].length).trim();
  return { command: candidate, target };
}

interface ImpeccableReferenceResponse {
  content?: string;
}

/** Load vendored reference markdown for a sub-command from the tool server. */
export async function fetchImpeccableReference(command: string): Promise<string | null> {
  const normalized = command.trim().toLowerCase();
  if (!normalized || !IMPECCABLE_COMMANDS.has(normalized)) {
    return null;
  }

  try {
    const res = await fetch(
      `/api/skills/impeccable/reference/${encodeURIComponent(normalized)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as ImpeccableReferenceResponse;
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    return content || null;
  } catch {
    return null;
  }
}

function formatActiveCommandSection(command: string, content: string): string {
  return `---
## Active Impeccable command: ${command}
(follow this workflow; do not run \`npx impeccable ${command}\` or \`run_impeccable\` for this command)
${content}`;
}

function formatPrerequisiteSection(command: string, content: string): string {
  return `---
## Prerequisite workflow: ${command}
(required by the active command above; follow in chat — do not call \`run_impeccable\` or \`npx impeccable ${command}\`)
${content}`;
}

/** Commands to load for a slash send: primary first, then prerequisites (deduped). */
export function commandsForImpeccableAugment(primaryCommand: string): string[] {
  const primary = primaryCommand.trim().toLowerCase();
  const prereqs = HARNESS_PREREQUISITE_COMMANDS[primary] ?? [];
  const ordered: string[] = [primary];
  for (const prereq of prereqs) {
    const cmd = prereq.trim().toLowerCase();
    if (cmd && cmd !== primary && !ordered.includes(cmd)) {
      ordered.push(cmd);
    }
  }
  return ordered;
}

/** Append active-command reference workflow to the skill body when a sub-command is present. */
export async function augmentImpeccableSkillBody(
  skillBody: string,
  userText: string,
): Promise<string> {
  const { command } = parseImpeccableSubcommand(userText);
  if (!command) {
    return skillBody;
  }

  const sections: string[] = [];
  for (const cmd of commandsForImpeccableAugment(command)) {
    const content = await fetchImpeccableReference(cmd);
    if (!content) {
      if (cmd === command) {
        return skillBody;
      }
      continue;
    }
    sections.push(
      cmd === command
        ? formatActiveCommandSection(cmd, content)
        : formatPrerequisiteSection(cmd, content),
    );
  }

  if (sections.length === 0) {
    return skillBody;
  }

  return `${skillBody.trim()}\n${sections.join('\n')}`;
}
