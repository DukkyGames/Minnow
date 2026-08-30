/**
 * Load V2 Builder/Tester system prompts (P2-F).
 *
 * Files live under `prompts/{builder,tester}/`. The runner never imports them
 * — this module loads a file and P2-F passes the string as `systemPrompt`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts');

/**
 * Drop YAML frontmatter so the model sees instructions, not the authoring header.
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripPromptFrontmatter(raw) {
  const text = String(raw ?? '');
  if (!text.startsWith('---')) return text.trim();
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text.trim();
  return text.slice(end + 4).replace(/^\s*\r?\n/, '').trim();
}

/**
 * @param {'builder' | 'tester'} role
 * @param {'full' | 'lite'} [variant]
 * @returns {Promise<string>}
 */
export async function loadRolePrompt(role, variant = 'full') {
  if (role !== 'builder' && role !== 'tester') {
    throw new Error(`loadRolePrompt: ${String(role)} is not an agent role`);
  }
  const file = variant === 'lite' ? 'agent.lite.md' : 'agent.full.md';
  const raw = await fs.readFile(path.join(PROMPTS_DIR, role, file), 'utf8');
  return stripPromptFrontmatter(raw);
}

/**
 * Substitute `{{cwd}}` (and any other `{{name}}`) in a loaded prompt.
 *
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function interpolatePrompt(template, vars) {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : '',
  );
}
