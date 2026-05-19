/**
 * Parse Work Agent metadata from agent.full.md front matter.
 */

import { parsePromptMarkdown } from '../chat/prompts/parse-front-matter';
import type { WorkAgentDefinition } from './work-agent-types';

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((v) => String(v).trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function parseNullableString(value: unknown): string | null {
  if (value === null || value === 'null' || value === '') return null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** Re-parse extended YAML keys not in PromptFrontMatter. */
function parseExtendedRecord(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const record: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.endsWith(':') && !trimmed.includes(': ')) {
      const key = trimmed.slice(0, -1).trim();
      const values: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trimStart().startsWith('- ')) {
        values.push(lines[j].trimStart().slice(2).trim());
        j += 1;
      }
      if (values.length) record[key] = values;
      i = j - 1;
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value: unknown = trimmed.slice(colon + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null') value = null;
    record[key] = value;
  }
  return record;
}

/**
 * Build WorkAgentDefinition from agent markdown; null if invalid.
 */
export function parseWorkAgentMetaFromMarkdown(
  raw: string,
  relativePath: string,
): WorkAgentDefinition | null {
  let frontMatter;
  try {
    ({ frontMatter } = parsePromptMarkdown(raw, relativePath));
  } catch {
    return null;
  }

  if (frontMatter.kind !== 'work-agent') return null;

  const ext = parseExtendedRecord(raw);

  const defaultForModes =
    asStringList(ext.defaultForModes) ?? asStringList(ext.default_for_modes);

  const allowedTools =
    asStringList(ext.allowedTools) ?? asStringList(ext.allowed_tools) ?? null;

  const disabled =
    ext.disabled === true || ext.disabled === 'true'
      ? true
      : ext.disabled === false || ext.disabled === 'false'
        ? false
        : undefined;

  return {
    id: frontMatter.id,
    label: frontMatter.label,
    description: frontMatter.description ?? '',
    kind: 'work-agent',
    version: String(frontMatter.version),
    providerId: parseNullableString(ext.providerId),
    modelId: parseNullableString(ext.modelId),
    allowedTools,
    defaultForModes,
    disabled,
  };
}
