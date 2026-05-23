/** Max wait before revealing the shell even if a stylesheet never loads. */
const APP_READY_STYLE_TIMEOUT_MS = 12_000;

/**
 * Wait for Vite-emitted `<link rel="stylesheet">` tags (production).
 * Dev injects `<style>` via JS imports before this module runs, so an empty list resolves immediately.
 */
export function whenAppStylesReady(): Promise<void> {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );
  if (links.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (link.sheet) {
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
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeoutId);
    markAppReady();
  };

  const timeoutId = window.setTimeout(finish, APP_READY_STYLE_TIMEOUT_MS);

  void whenAppStylesReady().then(finish).catch(finish);
}
