import { getForegroundAppId, getOsView } from './instances';

/** True when fullscreen app chrome should hide auxiliary shell affordances. */
export function shouldSuppressDesktopChrome(): boolean {
  return getOsView() === 'app' && Boolean(getForegroundAppId());
}
