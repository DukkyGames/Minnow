/** Max wait before revealing the shell even if a stylesheet never loads. */
const APP_READY_STYLE_TIMEOUT_MS = 4_000;

/** True for Vite bundle stylesheets (not third-party font CDNs). */
function isBundledStylesheetLink(link: HTMLLinkElement): boolean {
  const href = link.getAttribute('href');
  if (!href || href.startsWith('data:')) return false;
  try {
    return new URL(href, location.href).origin === location.origin;
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

/**
 * Wait for the Vite production CSS bundle (`<link rel="stylesheet">`).
 * Dev uses injected `<style data-vite-dev-id>` tags from imports instead.
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
        }),
    ),
  ).then(() => undefined);
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
  // Dev: CSS is injected as <style> tags when imports run; do not wait on font CDN links.
  if (import.meta.env.DEV) {
    requestAnimationFrame(() => markAppReady());
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeoutId);
    markAppReady();
  };

  const timeoutId = window.setTimeout(finish, APP_READY_STYLE_TIMEOUT_MS);

  void whenAppStylesReady()
    .then(() => {
      requestAnimationFrame(finish);
    })
    .catch(finish);
}
