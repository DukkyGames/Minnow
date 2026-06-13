/** MinnowOS app identifiers — one per launcher tile. */
export type AppId = 'code' | 'chat' | 'research' | 'experts' | 'bench' | 'settings';

/** Shell surface: desktop launcher vs a foreground app. */
export type OsView = 'desktop' | 'app';

/** Persisted desktop appearance (localStorage `minnow.os.*`). */
export interface DesktopPrefs {
  /** `dock` = bottom launcher bar; `grid` = app tile grid below hero. */
  desktopLayout: 'dock' | 'grid';
  wallpaper: 'flat' | 'gradient' | 'underwater';
  previewStyle: 'card' | 'tile';
}

import type { ModeId } from '../chat/modes/types';

/** One running app instance (may share an appId with other closed/reopened windows). */
export interface AppInstance {
  id: string;
  appId: AppId;
  /** Optional concierge seed text passed when launching chat/research. */
  seed?: string;
  /** Full launch payload from concierge or router (consumed once by app-host). */
  launchOptions?: LaunchOptions;
  unread: number;
  /** Latest background notification snippet for dock previews. */
  msg: string;
}

/** Options when launching or foregrounding an app from the shell or router. */
export interface LaunchOptions {
  seed?: string;
  /** Settings section slug when opening from legacy `#/settings/…` redirects. */
  settingsSection?: string;
  /** Code app: composer mode to activate. */
  modeId?: ModeId;
  /** Code app: absolute workspace path from the recent-workspace list. */
  workspacePath?: string;
  /** Research: start a run immediately when a seed is present. */
  autoRun?: boolean;
}

/** Parsed hash route consumed by the OS shell and page bridge. */
export interface OsRoute {
  view: OsView;
  appId?: AppId;
  settingsSection?: string;
}
