/**
 * Parse SKILL.md YAML front matter and markdown body (shared contract with server).
 */

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const BLOCK_SCALAR_MARKERS = new Set(['>', '>-', '|-', '|']);

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

/** Parse YAML front matter; supports folded block scalars (e.g. description: >-). */
export function parseYamlFrontmatterBlock(yamlBlock: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = yamlBlock.split('\n');
  let i = 0;

  while (i < lines.length) {
    const parsed = parseYamlLine(lines[i]);
    if (!parsed) {
      i += 1;
      continue;
    }

    const { key, value } = parsed;
    if (BLOCK_SCALAR_MARKERS.has(value)) {
      const blockLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') {
          blockLines.push('');
          i += 1;
          continue;
        }
        if (/^\s+/.test(next)) {
          blockLines.push(next.replace(/^\s{2,}/, ''));
          i += 1;
          continue;
        }
        break;
      }
      const folded = blockLines
        .join(value.startsWith('|') ? '\n' : ' ')
        .replace(/\s+/g, ' ')
        .trim();
      meta[key] = folded;
      continue;
    }

    meta[key] = value;
    i += 1;
  }

  return meta;
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
  const meta = parseYamlFrontmatterBlock(yamlBlock);

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
