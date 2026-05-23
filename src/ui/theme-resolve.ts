/**
 * Theme preference resolution (re-exports from src/theme.ts for tests and legacy imports).
 */

export {
  THEME_STORAGE_KEY,
  getFollowSystem,
  getStoredFamily,
  getStoredTheme,
  getThemePreference,
  resolveTheme,
  type LegacyThemePreference as ThemePreference,
} from '../theme';
