/**
 * `features.replayPriorReasoning`: send prior-turn reasoning back on plain assistant rows.
 *
 * Tool-call rows already replay their thinking (Anthropic requires the signature to
 * pair with `tool_use`), but a finished prose turn drops it — so a model that reasoned
 * its way to an answer on turn 3 cannot see that reasoning on turn 4. Replaying costs
 * real tokens on every later turn and some providers reject the fields outright, so
 * this is opt-in and defaults to off.
 */

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
