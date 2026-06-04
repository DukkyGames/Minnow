/**
 * Parse expert metadata from markdown front matter (flat YAML keys).
 */

import { parsePromptMarkdown } from '../prompts/parse-front-matter';
import {
  EXPERT_ACCENT_VALUES,
  type ExpertAccent,
  type ExpertMeta,
} from './types';

function parseExpertAccent(value: unknown): ExpertAccent | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return EXPERT_ACCENT_VALUES.includes(normalized as ExpertAccent)
    ? (normalized as ExpertAccent)
    : undefined;
}

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseExtendedRecord(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const record: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
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

function optionalString(ext: Record<string, unknown>, key: string): string | undefined {
  const value = ext[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

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
  return {
    id: frontMatter.id,
    label: frontMatter.label,
    kind: 'expert',
    description: frontMatter.description,
    icon: optionalString(ext, 'icon'),
    accent: parseExpertAccent(ext.accent),
    tagline: optionalString(ext, 'tagline'),
    greeting: optionalString(ext, 'greeting'),
  };
}
