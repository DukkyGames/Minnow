import { isDeveloperReleased } from '../../os/app-registry';
import type { AppId } from '../../os/types';
import type { ModeId } from './types';

/** Optional app that must be developer-released for its mode to show in Settings. */
const MODE_APP_GATE: Partial<Record<ModeId, AppId>> = {
  email: 'email',
};

/** Surface-only or first-run modes omitted from Settings search. */
const SETTINGS_SEARCH_EXCLUDED_MODES = new Set<ModeId>(['desktop', 'onboarding']);

/** True when a mode should be indexed under Settings → search (modes / prompts). */
export function isModeVisibleInSettingsSearch(modeId: ModeId): boolean {
  if (SETTINGS_SEARCH_EXCLUDED_MODES.has(modeId)) return false;
  const gatedApp = MODE_APP_GATE[modeId];
  if (gatedApp && !isDeveloperReleased(gatedApp)) return false;
  return true;
}
