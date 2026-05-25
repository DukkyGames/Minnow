/**
 * Parse routing metadata from expert front matter (flat YAML keys).
 */

import { parsePromptMarkdown } from '../prompts/parse-front-matter';
import {
  EXPERT_ACCENT_VALUES,
  type ExpertAccent,
  type ExpertMeta,
  type ExpertTriggers,
} from './types';

function parseExpertAccent(value: unknown): ExpertAccent | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return EXPERT_ACCENT_VALUES.includes(normalized as ExpertAccent)
    ? (normalized as ExpertAccent)
    : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  return list.length ? list : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/** Strip YAML single/double quotes from scalar values (matches parse-front-matter). */
function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Re-parse front matter record for expert-only keys not in PromptFrontMatter. */
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
    let value = trimmed.slice(colon + 1).trim();
    if (value === 'true') record[key] = true;
    else if (value === 'false') record[key] = false;
    else if (/^\d+$/.test(value)) record[key] = Number.parseInt(value, 10);
    else record[key] = unquoteYamlScalar(value);
  }
  return record;
}

/**
 * Build ExpertMeta from expert markdown; returns null if invalid or not kind expert.
 */
export function parseExpertMetaFromMarkdown(
  raw: string,
  relativePath: string,
): ExpertMeta | null {
  let frontMatter;
  try {
    ({ frontMatter } = parsePromptMarkdown(raw, relativePath));
  } catch {
    return null;
  }

  if (frontMatter.kind !== 'expert') return null;

  const ext = parseExtendedRecord(raw);
  const keywords =
    asStringList(ext.keywords) ??
    asStringList(ext.triggerKeywords) ??
    (frontMatter.expertTriggers
      ? frontMatter.expertTriggers.map((k) => k.toLowerCase())
      : undefined);

  const triggers: ExpertTriggers = {
    keywords,
    negativeKeywords: asStringList(ext.negativeKeywords),
    regex: Array.isArray(ext.regex)
      ? ext.regex.map(String)
      : Array.isArray(ext.triggerRegex)
        ? ext.triggerRegex.map(String)
        : undefined,
  };

  const hasTriggers =
    (triggers.keywords?.length ?? 0) > 0 ||
    (triggers.regex?.length ?? 0) > 0 ||
    (triggers.negativeKeywords?.length ?? 0) > 0;

  return {
    id: frontMatter.id,
    label: frontMatter.label,
    kind: 'expert',
    version: String(frontMatter.version),
    description: frontMatter.description,
    priority:
      typeof ext.priority === 'number'
        ? ext.priority
        : Number.parseInt(String(ext.priority ?? '0'), 10) || 0,
    triggers: hasTriggers ? triggers : undefined,
    classifierHint:
      typeof ext.classifierHint === 'string' ? ext.classifierHint : undefined,
    default: parseBoolean(ext.default) ?? false,
    icon: typeof ext.icon === 'string' && ext.icon.trim() ? ext.icon.trim() : undefined,
    accent: parseExpertAccent(ext.accent),
  };
}
