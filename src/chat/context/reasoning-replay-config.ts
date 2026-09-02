const CONFIG_URL = '/api/config/file?key=config.json';

export const DEFAULT_REPLAY_PRIOR_REASONING = false;

/** Read the flag from config.json (false on any read/parse failure). */
export async function fetchReplayPriorReasoningEnabled(): Promise<boolean> {
  try {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_REPLAY_PRIOR_REASONING;
    const config = (await res.json()) as {
      features?: { replayPriorReasoning?: boolean };
    };
    return typeof config.features?.replayPriorReasoning === 'boolean'
      ? config.features.replayPriorReasoning
      : DEFAULT_REPLAY_PRIOR_REASONING;
  } catch {
    return DEFAULT_REPLAY_PRIOR_REASONING;
  }
}

export async function saveReplayPriorReasoningEnabled(enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch(CONFIG_URL);
    if (!res.ok) return false;
    const config = (await res.json()) as { features?: Record<string, boolean> };
    const features =
      config.features && typeof config.features === 'object' ? { ...config.features } : {};
    features.replayPriorReasoning = enabled;
    config.features = features;
    const put = await fetch(CONFIG_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return put.ok;
  } catch {
    return false;
  }
}
