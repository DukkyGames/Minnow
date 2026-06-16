/**
 * Synthesis settings from ~/.minnow/config.json → synthesis block.
 */

import { readConfigJson, writeConfigJson, readResource } from '../config/store.js';
import { normalizeSynthesisConfig } from '../config/validators.js';
import { getActiveProviderId } from '../providers/store.js';

/** Unit separator in menubar model select values (provider + model composite key). */
const MODEL_SELECT_KEY_SEP = '\u001f';

/**
 * Parse composite menubar model value into provider + canonical model id.
 * @param {string} value
 * @returns {{ providerId: string; modelId: string } | null}
 */
function decodeModelSelectKey(value) {
  const trimmed = value.trim();
  const idx = trimmed.indexOf(MODEL_SELECT_KEY_SEP);
  if (idx <= 0 || idx === trimmed.length - 1) {
    return null;
  }
  const providerId = trimmed.slice(0, idx).trim();
  const modelId = trimmed.slice(idx + 1).trim();
  if (!providerId || !modelId) {
    return null;
  }
  return { providerId, modelId };
}

/**
 * Active chat menubar binding from sessions state (decodes composite model keys).
 * @param {string} activeProviderId
 * @returns {Promise<{ providerId: string; modelId: string }>}
 */
async function resolveActiveChatBinding(activeProviderId) {
  const sessions = await readResource('sessions');
  const activeId = typeof sessions?.activeId === 'string' ? sessions.activeId : '';
  const chats = Array.isArray(sessions?.chats) ? sessions.chats : [];
  const activeChat = chats.find(
    (chat) => chat && typeof chat === 'object' && chat.id === activeId,
  );
  if (!activeChat) {
    return { providerId: '', modelId: '' };
  }

  let providerId =
    typeof activeChat.providerId === 'string' ? activeChat.providerId.trim() : '';
  let modelId = typeof activeChat.modelId === 'string' ? activeChat.modelId.trim() : '';

  const decoded = decodeModelSelectKey(modelId);
  if (decoded) {
    return { providerId: decoded.providerId, modelId: decoded.modelId };
  }

  if (modelId && !providerId) {
    providerId = activeProviderId;
  }

  return { providerId, modelId };
}

/** Shown when synthesis/email utility LLM calls cannot resolve a model. */
export const UTILITY_MODEL_UNAVAILABLE_HINT =
  'Select a model in the menubar (or Settings → Models) and try again.';

/** Default synthesis configuration (suggest-and-confirm, not auto-save). */
export const DEFAULT_SYNTHESIS_CONFIG = {
  enabled: true,
  requireConfirmation: true,
  confidenceThreshold: 0.6,
  maxProposalsPerTurn: 3,
  throttleMessagePairs: 4,
  skillMinRounds: 2,
  skillMinToolCalls: 2,
  utilityProviderId: '',
  utilityModelId: '',
  maxPendingProposals: 100,
  rejectedRetentionDays: 30,
};

/**
 * Load merged synthesis config from config.json.
 * @returns {Promise<typeof DEFAULT_SYNTHESIS_CONFIG>}
 */
export async function loadSynthesisConfig() {
  const config = (await readConfigJson('config.json')) ?? {};
  const raw =
    config.synthesis && typeof config.synthesis === 'object'
      ? config.synthesis
      : {};
  return {
    ...DEFAULT_SYNTHESIS_CONFIG,
    ...raw,
  };
}

/**
 * Persist partial synthesis settings into config.json.
 * @param {Partial<typeof DEFAULT_SYNTHESIS_CONFIG>} partial
 * @returns {Promise<typeof DEFAULT_SYNTHESIS_CONFIG>}
 */
export async function saveSynthesisConfig(partial) {
  const config = (await readConfigJson('config.json')) ?? {};
  const existing =
    config.synthesis && typeof config.synthesis === 'object'
      ? { ...DEFAULT_SYNTHESIS_CONFIG, ...config.synthesis }
      : { ...DEFAULT_SYNTHESIS_CONFIG };
  config.synthesis = normalizeSynthesisConfig(partial ?? {}, existing);
  await writeConfigJson('config.json', config);
  return config.synthesis;
}

/**
 * Resolve provider + model for synthesis / email utility LLM calls.
 * Priority: synthesis overrides → titles model → active chat menubar → active provider.
 * @param {typeof DEFAULT_SYNTHESIS_CONFIG} synthesisCfg
 * @returns {Promise<{ providerId: string, model: string } | null>}
 */
export async function resolveSynthesisModel(synthesisCfg) {
  const synProvider =
    typeof synthesisCfg.utilityProviderId === 'string'
      ? synthesisCfg.utilityProviderId.trim()
      : '';
  const synModel =
    typeof synthesisCfg.utilityModelId === 'string'
      ? synthesisCfg.utilityModelId.trim()
      : '';

  if (synProvider && synModel) {
    return { providerId: synProvider, model: synModel };
  }

  const config = (await readConfigJson('config.json')) ?? {};
  const titles =
    config.titles && typeof config.titles === 'object' ? config.titles : {};
  const titleProvider =
    typeof titles.providerId === 'string' ? titles.providerId.trim() : '';
  const titleModel = typeof titles.modelId === 'string' ? titles.modelId.trim() : '';

  const activeProvider = await getActiveProviderId();
  const chatBinding = await resolveActiveChatBinding(activeProvider);

  const model = synModel || titleModel || chatBinding.modelId;
  if (!model) {
    return null;
  }

  const providerId =
    synProvider || titleProvider || chatBinding.providerId || activeProvider;
  if (!providerId) {
    return null;
  }

  return { providerId, model };
}
