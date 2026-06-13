/**
 * Synthesis settings from ~/.minnow/config.json → synthesis block.
 */

import { readConfigJson } from '../config/store.js';
import { getActiveProviderId } from '../providers/store.js';

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
 * Resolve provider + model for synthesis LLM calls.
 * Priority: synthesis overrides → titles (utility) → active provider (no model).
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

  if (titleProvider && titleModel) {
    return { providerId: titleProvider, model: titleModel };
  }

  const activeProvider = await getActiveProviderId();
  if (activeProvider && synModel) {
    return { providerId: synProvider || activeProvider, model: synModel };
  }

  return null;
}
