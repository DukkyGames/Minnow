import { getPresentationMode } from './app-registry';
import type { AppId, AppInstance, LaunchOptions, PresentationMode } from './types';

/** Settings launched from Code uses fullscreen instead of a floating window. */
export function resolvePresentationMode(
  appId: AppId,
  launchOptions?: LaunchOptions,
): PresentationMode {
  if (appId === 'settings' && launchOptions?.returnToApp === 'code') {
    return 'fullscreen';
  }
  return getPresentationMode(appId);
}

/** Effective presentation for a running instance (honors per-launch overrides). */
export function resolveInstancePresentation(inst: AppInstance): PresentationMode {
  return resolvePresentationMode(inst.appId, inst.launchOptions);
}
