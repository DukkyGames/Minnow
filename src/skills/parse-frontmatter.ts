/**
 * Parse SKILL.md YAML front matter and markdown body (shared contract with server).
 */

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseYamlLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const colon = trimmed.indexOf(':');
  if (colon <= 0) return null;
  const key = trimmed.slice(0, colon).trim();
  let value = trimmed.slice(colon + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export interface ParsedSkillFrontmatter {
  meta: Record<string, string>;
  body: string;
}

/** Parse raw SKILL.md; throws on invalid required fields. */
export function parseSkillFrontmatter(raw: string): ParsedSkillFrontmatter {
  if (!raw.trim()) {
    throw new Error('SKILL.md is empty');
  }

  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    throw new Error('SKILL.md must start with YAML front matter (---)');
  }

  const yamlBlock = match[1];
  const body = match[2] ?? '';
  const meta: Record<string, string> = {};

  for (const line of yamlBlock.split('\n')) {
    const parsed = parseYamlLine(line);
    if (parsed) meta[parsed.key] = parsed.value;
  }

  if (!meta.name?.trim()) {
    throw new Error('SKILL.md front matter requires "name"');
  }
  if (!meta.description?.trim()) {
    throw new Error('SKILL.md front matter requires "description"');
  }

  return { meta, body: body.trimStart() };
}

/** Default picker label from skill id. */
export function defaultSkillLabel(name: string): string {
  return name
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
