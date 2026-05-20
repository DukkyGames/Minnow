/**
 * Parse SKILL.md YAML front matter and markdown body (no extra dependencies).
 */

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const BLOCK_SCALAR_MARKERS = new Set(['>', '>-', '|-', '|']);

/** @param {string} line */
function parseYamlLine(line) {
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

/**
 * Parse YAML front matter; supports folded block scalars (e.g. description: >-).
 * @param {string} yamlBlock
 * @returns {Record<string, string>}
 */
export function parseYamlFrontmatterBlock(yamlBlock) {
  /** @type {Record<string, string>} */
  const meta = {};
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
      /** @type {string[]} */
      const blockLines = [];
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

/**
 * @param {string} raw
 * @returns {{ meta: Record<string, string>, body: string }}
 */
export function parseSkillFrontmatter(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
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

/** Title-case a skill id for default label. */
export function defaultSkillLabel(name) {
  return name
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
