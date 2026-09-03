import type { ModeId } from './types';

/** Surface-only or first-run modes omitted from Settings search. */
const SETTINGS_SEARCH_EXCLUDED_MODES = new Set<ModeId>(['onboarding']);

/** True when a mode should be indexed under Settings → search (modes / prompts). */
export function isModeVisibleInSettingsSearch(modeId: ModeId): boolean {
  if (SETTINGS_SEARCH_EXCLUDED_MODES.has(modeId)) return false;
  return true;
}
