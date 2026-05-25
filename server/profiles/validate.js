/**
 * Validate Minnow setup profile bundles (schemaVersion 1).
 */

import { validatePromptConfig } from '../prompt-configs/validate.js';
import { ALL_TOOL_IDS } from '../config/tool-ids.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const PERMISSION_MODES = new Set(['off', 'ask', 'full']);
const MAX_BUNDLE_BYTES = 512 * 1024;

/**
 * @param {unknown} body
 * @returns {{ ok: true, bundle: object } | { ok: false, error: string }}
 */
export function validateProfileBundle(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Profile must be an object' };
  }

  const raw = /** @type {Record<string, unknown>} */ (body);
  const size = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (size > MAX_BUNDLE_BYTES) {
    return { ok: false, error: 'Profile bundle exceeds 512 KB limit' };
  }

  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    return { ok: false, error: 'Invalid profile id' };
  }
  if (raw.id.includes('..') || raw.id.startsWith('_')) {
    return { ok: false, error: 'Invalid profile id' };
  }
  if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 120) {
    return { ok: false, error: 'Invalid label' };
  }
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== '1') {
    return { ok: false, error: 'Unsupported schemaVersion' };
  }

  if (!raw.prompt || typeof raw.prompt !== 'object' || Array.isArray(raw.prompt)) {
    return { ok: false, error: 'prompt section required' };
  }
  const prompt = /** @type {Record<string, unknown>} */ (raw.prompt);
  if (
    prompt.promptProfile !== 'full' &&
    prompt.promptProfile !== 'lite' &&
    prompt.promptProfile !== 'custom'
  ) {
    return { ok: false, error: 'Invalid prompt.promptProfile' };
  }

  const source = prompt.source ?? 'embedded';
  if (
    source !== 'embedded' &&
    source !== 'prompt-config' &&
    source !== 'full' &&
    source !== 'lite'
  ) {
    return { ok: false, error: 'Invalid prompt.source' };
  }

  if (source === 'embedded' && prompt.parts && typeof prompt.parts === 'object') {
    const pseudoConfig = {
      id: raw.id,
      label: raw.label,
      profile: 'custom',
      parts: prompt.parts,
    };
    const partCheck = validatePromptConfig(pseudoConfig);
    if (!partCheck.ok) {
      return { ok: false, error: partCheck.error };
    }
  }

  if (!raw.agents || typeof raw.agents !== 'object' || Array.isArray(raw.agents)) {
    return { ok: false, error: 'agents section required' };
  }
  if (!raw.tools || typeof raw.tools !== 'object' || Array.isArray(raw.tools)) {
    return { ok: false, error: 'tools section required' };
  }

  const tools = /** @type {Record<string, unknown>} */ (raw.tools);
  if (tools.permissions && typeof tools.permissions === 'object') {
    const perms = /** @type {Record<string, unknown>} */ (tools.permissions);
    for (const [toolId, mode] of Object.entries(perms)) {
      if (!ALL_TOOL_IDS.includes(toolId)) {
        return { ok: false, error: `Unknown tool id in bundle: ${toolId}` };
      }
      if (typeof mode !== 'string' || !PERMISSION_MODES.has(mode)) {
        return { ok: false, error: `Invalid permission for ${toolId}` };
      }
    }
  }

  if (tools.keys && typeof tools.keys === 'object') {
    const keys = /** @type {Record<string, unknown>} */ (tools.keys);
    for (const key of Object.keys(keys)) {
      if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('apikey')) {
        const val = keys[key];
        if (typeof val === 'string' && val.trim()) {
          return { ok: false, error: 'API keys cannot be stored in profile bundles' };
        }
      }
    }
  }

  const bundle = {
    id: raw.id,
    label: raw.label.trim(),
    schemaVersion: 1,
    meta:
      raw.meta && typeof raw.meta === 'object'
        ? { .../** @type {object} */ (raw.meta) }
        : {},
    prompt: {
      promptProfile: prompt.promptProfile,
      activePromptConfigId:
        prompt.activePromptConfigId === null || typeof prompt.activePromptConfigId === 'string'
          ? prompt.activePromptConfigId
          : null,
      activeInfoPresetId:
        typeof prompt.activeInfoPresetId === 'string'
          ? prompt.activeInfoPresetId
          : 'general-assistant',
      planGranularity:
        prompt.planGranularity === 'large' ||
        prompt.planGranularity === 'small' ||
        prompt.planGranularity === 'medium'
          ? prompt.planGranularity
          : 'medium',
      source,
      ...(prompt.parts && typeof prompt.parts === 'object' ? { parts: prompt.parts } : {}),
    },
    agents: /** @type {object} */ (raw.agents),
    tools: /** @type {object} */ (raw.tools),
    ...(raw.rules && typeof raw.rules === 'object' ? { rules: raw.rules } : {}),
    ...(raw.skills && typeof raw.skills === 'object' ? { skills: raw.skills } : {}),
  };

  return { ok: true, bundle };
}
