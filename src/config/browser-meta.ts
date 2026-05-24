/**
 * Browser CDP settings from config.json → `browser` (navigation allowlist, CDP URL).
 */

export interface BrowserMeta {
  enabled: boolean;
  defaultUrl: string;
  allowNavigate: boolean;
  allowedOriginPatterns: string[];
  screenshotDir: string;
}

export const DEFAULT_BROWSER_META: BrowserMeta = {
  enabled: true,
  defaultUrl: 'http://127.0.0.1:9222',
  allowNavigate: true,
  allowedOriginPatterns: [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://localhost:*',
  ],
  screenshotDir: 'screenshots',
};

let cached: BrowserMeta | null = null;
let metaLoaded = false;
let loadPromise: Promise<BrowserMeta> | null = null;

/** Coerce API payload into a browser config block. */
export function normalizeBrowserMeta(raw: unknown): BrowserMeta {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_BROWSER_META,
      allowedOriginPatterns: [...DEFAULT_BROWSER_META.allowedOriginPatterns],
    };
  }
  const row = raw as Record<string, unknown>;
  const base: BrowserMeta = {
    ...DEFAULT_BROWSER_META,
    allowedOriginPatterns: [...DEFAULT_BROWSER_META.allowedOriginPatterns],
  };
  if (typeof row.enabled === 'boolean') base.enabled = row.enabled;
  if (typeof row.defaultUrl === 'string' && row.defaultUrl.trim()) {
    base.defaultUrl = row.defaultUrl.trim();
  }
  if (typeof row.allowNavigate === 'boolean') base.allowNavigate = row.allowNavigate;
  if (Array.isArray(row.allowedOriginPatterns)) {
    base.allowedOriginPatterns = row.allowedOriginPatterns.filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0,
    );
  }
  if (typeof row.screenshotDir === 'string' && row.screenshotDir.trim()) {
    base.screenshotDir = row.screenshotDir.trim();
  }
  return base;
}

/** Load browser prefs from GET /api/config/meta. */
export async function loadBrowserMeta(): Promise<BrowserMeta> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<BrowserMeta> => {
    try {
      const res = await fetch('/api/config/meta', { cache: 'no-store' });
      if (!res.ok) {
        cached = normalizeBrowserMeta(null);
        return cached;
      }
      const meta = (await res.json()) as { browser?: unknown };
      cached = normalizeBrowserMeta(meta.browser);
      return cached;
    } catch {
      cached = normalizeBrowserMeta(null);
      return cached;
    } finally {
      metaLoaded = true;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/** Persist partial browser block via PUT /api/config/meta. */
export async function saveBrowserMeta(patch: Partial<BrowserMeta>): Promise<void> {
  const current = await loadBrowserMeta();
  const next: BrowserMeta = {
    enabled: patch.enabled ?? current.enabled,
    defaultUrl: patch.defaultUrl ?? current.defaultUrl,
    allowNavigate: patch.allowNavigate ?? current.allowNavigate,
    allowedOriginPatterns:
      patch.allowedOriginPatterns ?? [...current.allowedOriginPatterns],
    screenshotDir: patch.screenshotDir ?? current.screenshotDir,
  };
  cached = next;
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser: next }),
  });
}

/** Cached value for settings UI (call loadBrowserMeta during init). */
export function getBrowserMetaCached(): BrowserMeta {
  return cached ?? normalizeBrowserMeta(null);
}

export function isBrowserMetaLoaded(): boolean {
  return metaLoaded;
}

export function invalidateBrowserMetaCache(): void {
  cached = null;
  metaLoaded = false;
  loadPromise = null;
}

export interface BrowserAllowlistCheckResult {
  allowed: boolean;
  allowNavigate: boolean;
  suggestedPattern: string;
  origin: string;
}

/** Ask the server whether a URL may be navigated to (authoritative allowlist check). */
export async function checkBrowserNavigationAllowed(
  url: string,
): Promise<BrowserAllowlistCheckResult | null> {
  try {
    const res = await fetch(
      `/api/browser/allowlist/check?url=${encodeURIComponent(url)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as BrowserAllowlistCheckResult;
  } catch {
    return null;
  }
}

/** Grant once or persist pattern after user approval in the UI. */
export async function approveBrowserNavigation(
  url: string,
  mode: 'once' | 'persist',
): Promise<boolean> {
  try {
    const res = await fetch('/api/browser/allowlist/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode }),
    });
    if (!res.ok) return false;
    if (mode === 'persist') {
      invalidateBrowserMetaCache();
      await loadBrowserMeta();
    }
    return true;
  } catch {
    return false;
  }
}
