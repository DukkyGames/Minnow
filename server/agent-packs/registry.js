/**
 * Agent pack registry snapshot + pack agent source index for prompt resolution.
 */

import fs from 'node:fs/promises';
import { getMinnowHome } from '../config/home.js';
import { getAgentPacksRoot } from './paths.js';
import { scanAgentPacks, loadAgentPacksState, isPackEnabled } from './scan.js';
import { workAgentsFromPackManifest } from './pack-agents.js';

/** @type {Map<string, object> | null} */
let packAgentSources = null;

/** @type {import('./types.js').ScannedAgentPack[] | null} */
let cachedPackList = null;

/**
 * @param {string} projectRoot
 * @param {ReadonlySet<string>} builtinAgentIds
 */
export async function refreshAgentPackCache(projectRoot, builtinAgentIds) {
  cachedPackList = await scanAgentPacks(projectRoot, builtinAgentIds);
  packAgentSources = new Map();

  for (const pack of cachedPackList) {
    if (!pack.valid || !pack.enabled || !pack.manifest) continue;
    const { sources } = workAgentsFromPackManifest(pack.manifest, pack.packRoot);
    for (const [id, src] of sources) {
      packAgentSources.set(id, src);
    }
  }

  return cachedPackList;
}

/**
 * @returns {import('./types.js').ScannedAgentPack[]}
 */
export function getCachedAgentPackList() {
  return cachedPackList ?? [];
}

/**
 * @param {string} agentId
 */
export function getPackAgentSource(agentId) {
  return packAgentSources?.get(agentId) ?? null;
}

/**
 * Enabled pack work agents for registry merge.
 * @param {string} projectRoot
 * @param {ReadonlySet<string>} builtinAgentIds
 */
export async function loadPackWorkAgents(projectRoot, builtinAgentIds) {
  const packs = await refreshAgentPackCache(projectRoot, builtinAgentIds);
  /** @type {object[]} */
  const agents = [];

  for (const pack of packs) {
    if (!pack.valid || !pack.enabled || !pack.manifest) continue;
    const { agents: packAgents } = workAgentsFromPackManifest(
      pack.manifest,
      pack.packRoot,
    );
    agents.push(...packAgents);
  }

  return { packs, agents };
}

/**
 * @param {string} packId
 * @param {boolean} enabled
 */
export async function setPackEnabled(packId, enabled) {
  const { getAgentPacksStatePath, assertValidPackId } = await import('./paths.js');
  assertValidPackId(packId);
  const state = await loadAgentPacksState();
  state[packId] = { ...(state[packId] ?? {}), enabled: !!enabled };
  const filePath = getAgentPacksStatePath();
  await fs.mkdir(getMinnowHome(), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state[packId];
}

/**
 * Ensure agent-packs directory exists (called from layout bootstrap).
 */
export async function ensureAgentPacksLayout() {
  const root = getAgentPacksRoot();
  await fs.mkdir(root, { recursive: true });
  const templateDir = `${root}/_template`;
  try {
    await fs.access(templateDir);
  } catch {
    await scaffoldTemplatePack(templateDir);
  }
}

async function scaffoldTemplatePack(templateDir) {
  await fs.mkdir(templateDir, { recursive: true });
  const manifest = {
    id: '_template',
    label: 'Agent pack template (authoring only)',
    version: '0.0.0',
    description: 'Copy this folder to a new id under agent-packs/ (without leading underscore).',
    enabled: false,
    agents: [
      {
        key: 'example',
        label: 'Example agent',
        description: 'Replace with your pack agent.',
        prompts: {
          full: 'prompts/example.full.md',
          lite: 'prompts/example.lite.md',
        },
        allowedTools: ['read_file', 'find_files', 'list_directory'],
        defaultForModes: ['research'],
        contextStrategy: { policy: 'inherit', maxInputTokens: null },
      },
    ],
    defaults: { providerId: null, modelId: null },
  };
  await fs.writeFile(
    `${templateDir}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    `${templateDir}/prompts/example.full.md`,
    'You are an example work agent from an agent pack.\n',
    'utf8',
  );
  await fs.writeFile(
    `${templateDir}/prompts/example.lite.md`,
    'Example pack agent (lite).\n',
    'utf8',
  );
  await fs.writeFile(
    `${templateDir}/README.md`,
    '# Agent pack template\n\nCopy this directory to `~/.minnow/agent-packs/<your-pack-id>/` and edit `manifest.json`. Folders starting with `_` are ignored by the scanner.\n',
    'utf8',
  );
}
