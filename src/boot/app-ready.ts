/** Max wait before revealing the shell even if a stylesheet never loads. */
const APP_READY_STYLE_TIMEOUT_MS = 4_000;

/**
 * Sentinel custom property declared on `:root` by `styles/tokens.css`. The inline
 * critical CSS in `index.html` only *consumes* tokens (with fallbacks) and declares
 * none, so resolving this proves the bundled stylesheet is applied.
 */
export const APP_CSS_READY_PROPERTY = '--mn-app-css-ready';

/**
 * Own deadline for the CSS-applied probe. Bounded so a probe that can never
 * succeed costs a frame budget rather than the full outer timeout.
 */
export const APP_SHELL_STYLED_TIMEOUT_MS = 500;

/** True for app bundle stylesheets (not highlight.js, fonts CDN, etc.). */
function isBundledStylesheetLink(link: HTMLLinkElement): boolean {
  const href = link.getAttribute('href');
  if (!href || href.startsWith('data:')) return false;
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return false;
    if (url.pathname.includes('/node_modules/')) return false;
    if (import.meta.env.PROD && !url.pathname.includes('/assets/')) return false;
    return true;
  } catch {
    return false;
  }
}

/** Stylesheet already applied (including cache hits before load listeners run). */
function isStylesheetLinkReady(link: HTMLLinkElement): boolean {
  if (link.sheet) return true;
  const href = link.href;
  if (!href) return true;
  try {
    return Array.from(document.styleSheets).some((sheet) => sheet.href === href);
  } catch {
    return false;
  }
}

/** Wait until after the next layout/paint (double rAF). */
export function waitForStablePaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Wait for production bundle `<link rel="stylesheet">` tags.
 * Dev app CSS is injected as `<style data-vite-dev-id>` (see `whenViteInjectedStylesReady`).
 */
export function whenAppStylesReady(): Promise<void> {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).filter(isBundledStylesheetLink);

  if (links.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (isStylesheetLinkReady(link)) {
            resolve();
            return;
          }
          const finish = () => resolve();
          link.addEventListener('load', finish, { once: true });
          link.addEventListener('error', finish, { once: true });
          queueMicrotask(() => {
            if (isStylesheetLinkReady(link)) finish();
          });
        }),
    ),
  ).then(() => undefined);
}

/** True when Vite dev has injected module CSS into `<style data-vite-dev-id>`. */
function hasViteInjectedModuleStyles(): boolean {
  const styles = document.querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id]');
  if (styles.length === 0) return false;
  return Array.from(styles).every((el) => (el.textContent?.length ?? 0) > 0);
}

/** Dev-only: wait for Vite HMR `<style data-vite-dev-id>` tags (not `<link>` bundles). */
export function whenViteInjectedStylesReady(): Promise<void> {
  if (!import.meta.env.DEV) {
    return Promise.resolve();
  }
  if (hasViteInjectedModuleStyles()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (hasViteInjectedModuleStyles()) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });
  });
}

/** True once bundled app CSS has been applied (see `APP_CSS_READY_PROPERTY`). */
export function isAppShellStyled(): boolean {
  if (typeof getComputedStyle !== 'function') return true;
  const root = document.documentElement;
  if (!root) return false;
  return getComputedStyle(root).getPropertyValue(APP_CSS_READY_PROPERTY).trim() === '1';
}

/** Poll until app CSS is active, giving up after `timeoutMs` so boot never stalls on it. */
export function whenAppShellStyled(
  timeoutMs: number = APP_SHELL_STYLED_TIMEOUT_MS,
): Promise<void> {
  if (isAppShellStyled()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (isAppShellStyled() || Date.now() >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Dismiss the inline loading shell (see index.html `#app-loader`). */
export function markAppReady(): void {
  const loader = document.getElementById('app-loader');
  if (loader) {
    loader.setAttribute('aria-busy', 'false');
    loader.setAttribute('aria-hidden', 'true');
  }
  document.documentElement.classList.add('app-ready');
}

/** Hide the loader once bundled CSS is ready; always unblock after a safety timeout. */
export function scheduleMarkAppReady(): void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeoutId);
    markAppReady();
  };

  const timeoutId = window.setTimeout(finish, APP_READY_STYLE_TIMEOUT_MS);

  void Promise.all([whenAppStylesReady(), whenViteInjectedStylesReady()])
    .then(() => whenAppShellStyled())
    .then(() => waitForStablePaint())
    .then(finish)
    .catch(finish);
}
