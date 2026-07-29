/**
 * Detect when Minnow runs as an installed PWA instead of an in-browser tab.
 * Installed apps use a separate storage partition from the browser on iOS and
 * some Android launchers, so companion pairing must be completed in-context.
 */

/** True when launched from a home-screen / installed app shell. */
export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  if (navigatorWithStandalone.standalone) return true;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  );
}
