import type { AppId } from './types';

/** Synthetic id for the Desktop home surface (not an AppId). */
export const APP_SWITCHER_DESKTOP_ID = 'desktop' as const;

export type AppSwitcherItemId = typeof APP_SWITCHER_DESKTOP_ID | AppId;
