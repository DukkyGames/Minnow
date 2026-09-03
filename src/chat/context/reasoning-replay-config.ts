import {
  readConfigFile,
  readConfigFlag,
  writeConfigFile,
} from '../../config/config-file-cache';

export const DEFAULT_REPLAY_PRIOR_REASONING = false;

/** Read the flag from config.json (false on any read/parse failure). */
export async function fetchReplayPriorReasoningEnabled(): Promise<boolean> {
  return readConfigFlag(['features', 'replayPriorReasoning'], DEFAULT_REPLAY_PRIOR_REASONING);
}

export async function saveReplayPriorReasoningEnabled(enabled: boolean): Promise<boolean> {
  const config = await readConfigFile({ fresh: true });
  if (!config) return false;
  const prev = config.features;
  const features = prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
  features.replayPriorReasoning = enabled;
  config.features = features;
  return writeConfigFile(config);
}
