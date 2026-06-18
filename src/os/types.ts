/** MinnowOS app identifiers — one per launcher tile. */
export type AppId = 'code' | 'chat' | 'research' | 'experts' | 'bench' | 'compare' | 'models' | 'brain' | 'scheduler' | 'calendar' | 'email' | 'settings';

/** How an app is presented in the MinnowOS shell. */
export type PresentationMode = 'fullscreen' | 'window' | 'desktop' | 'sidePanel';

/** Shell surface: desktop launcher vs a foreground app. */
export type OsView = 'desktop' | 'app';

/** Persisted desktop appearance (localStorage `minnow.os.*`). */
export interface DesktopPrefs {
  /** `dock` = bottom launcher bar; `grid` = app tile grid below hero. */
  desktopLayout: 'dock' | 'grid';
  wallpaper:
    | 'flat'
    | 'gradient'
    | 'underwater'
    | 'minnow'
    | 'aurora'
    | 'starfield'
    | 'grain'
    | 'mesh'
    | 'custom';
  /** IndexedDB asset id when wallpaper is `custom`. */
  wallpaperImageId?: string;
  wallpaperImageFit?: 'cover' | 'contain';
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
  /** Models app section slug when opening from `#/app/models/…` deep links. */
  modelsSection?: string;
  /** Brain app section slug when opening from `#/app/brain/…` deep links. */
  brainSection?: string;
  /** Code app: composer mode to activate. */
  modeId?: ModeId;
  /** Code app: absolute workspace path from the recent-workspace list. */
  workspacePath?: string;
  /** Research: start a run immediately when a seed is present. */
  autoRun?: boolean;
  /** Code app: switch to this chat after launch (notification deep-link). */
  chatId?: string;
  /** Experts hub: initial step when opening on the desktop surface. */
  step?: 'browse' | 'create' | 'edit';
  /** Experts hub: pre-select an expert in the roster. */
  expertId?: string;
  /** Desktop experts: open the full lab panel on entry. */
  openLab?: boolean;
}

/** Parsed hash route consumed by the OS shell and page bridge. */
export interface OsRoute {
  view: OsView;
  appId?: AppId;
  settingsSection?: string;
  modelsSection?: string;
  brainSection?: string;
}
