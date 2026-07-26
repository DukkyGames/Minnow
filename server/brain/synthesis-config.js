/**
 * Synthesis settings from ~/.minnow/config.json → synthesis block.
 */

import {
  readActiveChatModelBinding,
  useJsonSessionsStore,
} from '../config/sessions-repo.js';
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
 * Active chat menubar binding from sessions (decodes composite model keys).
 * SQLite hot path uses indexed activeId + chat row lookup; decode stays here.
 * @param {string} activeProviderId
 * @returns {Promise<{ providerId: string; modelId: string }>}
 */
async function resolveActiveChatBinding(activeProviderId) {
  /** @type {{ providerId: string, modelId: string }} */
  let chatBinding = { providerId: '', modelId: '' };

  if (!useJsonSessionsStore()) {
    // Narrow SELECT: session_meta.activeId → chats.provider_id/model_id.
    const binding = readActiveChatModelBinding();
    if (binding) {
      chatBinding = {
        providerId: typeof binding.providerId === 'string' ? binding.providerId.trim() : '',
        modelId: typeof binding.modelId === 'string' ? binding.modelId.trim() : '',
      };
    }
  } else {
    // JSON rollback: whole-blob resource read.
    const sessions = await readResource('sessions');
    const activeId = typeof sessions?.activeId === 'string' ? sessions.activeId : '';
    const chats = Array.isArray(sessions?.chats) ? sessions.chats : [];
    const activeChat = chats.find(
      (chat) => chat && typeof chat === 'object' && chat.id === activeId,
    );
    if (activeChat) {
      chatBinding = {
        providerId:
          typeof activeChat.providerId === 'string' ? activeChat.providerId.trim() : '',
        modelId: typeof activeChat.modelId === 'string' ? activeChat.modelId.trim() : '',
      };
    }
  }

  let { providerId, modelId } = chatBinding;
  if (!providerId && !modelId) {
    return { providerId: '', modelId: '' };
  }

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

/** Default synthesis configuration (brain writes pages freely unless confirmation is required). */
export const DEFAULT_SYNTHESIS_CONFIG = {
  enabled: true,
  requireConfirmation: false,
  confidenceThreshold: 0.6,
  /** At or above this confidence a fact is written straight to the wiki; below it, queued as a proposal. */
  autoWriteConfidence: 0.85,
  maxProposalsPerTurn: 3,
  throttleMessagePairs: 4,
  skillMinRounds: 2,
  skillMinToolCalls: 2,
  /** Distinct sessions that must hit the same problem class before a skill is proposed (1 = legacy one-shot). */
  skillMinOccurrences: 2,
  /** How long an unproposed skill observation stays eligible to count toward recurrence. */
  skillObservationRetentionDays: 45,
  utilityProviderId: '',
  utilityModelId: '',
  maxPendingProposals: 100,
  rejectedRetentionDays: 30,
};

/**
 * Load merged synthesis config from config.json.
 *
 * Legacy migration: older installs were *seeded* with `requireConfirmation: true`
 * (the default disagreed with the seed and the validator, so nobody chose it).
 * A config carrying that seed but no `autoWriteConfidence` predates the
 * confidence split, so it is read as `false` and routed by confidence instead.
 * This is an in-memory reinterpretation only — the next settings save pins both
 * keys explicitly, and an install that opts back in afterwards keeps `true`.
 *
 * @returns {Promise<typeof DEFAULT_SYNTHESIS_CONFIG>}
 */
export async function loadSynthesisConfig() {
  const config = (await readConfigJson('config.json')) ?? {};
  const raw =
    config.synthesis && typeof config.synthesis === 'object'
      ? config.synthesis
      : {};

  const merged = {
    ...DEFAULT_SYNTHESIS_CONFIG,
    ...raw,
  };

  if (raw.autoWriteConfidence === undefined && raw.requireConfirmation === true) {
    merged.requireConfirmation = false;
  }

  return merged;
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
 * Priority: explicit override → synthesis overrides → titles model → active chat menubar → active provider.
 * @param {typeof DEFAULT_SYNTHESIS_CONFIG} synthesisCfg
 * @param {{ providerId?: string, modelId?: string }} [explicit]
 * @returns {Promise<{ providerId: string, model: string } | null>}
 */
export async function resolveSynthesisModel(synthesisCfg, explicit = {}) {
  if (explicit?.providerId && explicit?.modelId) {
    return { providerId: explicit.providerId, model: explicit.modelId };
  }
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
