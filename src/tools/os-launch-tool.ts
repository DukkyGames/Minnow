/**
 * Browser tool: foreground a MinnowOS app via the OS hash router.
 */

import { isAppId } from '../os/app-registry';
import { launchApp as defaultLaunchApp } from '../os/router';
import type { AppId } from '../os/types';

const APP_ID_ARG = 'app_id';

/** Launch a MinnowOS app and return JSON { ok, appId, hash }. */
export function toolLaunchMinnowApp(
  args: Record<string, unknown>,
  launchApp: (appId: AppId, options?: { seed?: string }) => void = defaultLaunchApp,
): string {
  const rawAppId = args[APP_ID_ARG];
  if (typeof rawAppId !== 'string' || !rawAppId.trim()) {
    return 'Error: "app_id" is required';
  }

  const appId = rawAppId.trim();
  if (!isAppId(appId)) {
    return `Error: invalid app_id "${appId}" (expected code, chat, research, experts, bench, or settings)`;
  }

  const options: { seed?: string } = {};
  if (typeof args.seed === 'string' && args.seed.trim()) {
    options.seed = args.seed.trim();
  }

  launchApp(appId, Object.keys(options).length > 0 ? options : undefined);

  const hash = `#/app/${appId}`;
  return JSON.stringify({ ok: true, appId, hash });
}
