/**
 * Detect whether file-backed config (/api/config) is available.
 */

const CONFIG_PING_TIMEOUT_MS = 800;

export type StorageMode = 'server' | 'localStorage';

let storageMode: StorageMode = 'localStorage';
let detectPromise: Promise<StorageMode> | null = null;

/** Current persistence mode (set after detectConfigServer). */
export function getStorageMode(): StorageMode {
  return storageMode;
}

/** Whether reads/writes should use ~/.minnow via the API. */
export function isServerStorageMode(): boolean {
  return storageMode === 'server';
}

/**
 * Ping /api/config/ping; authoritative for Step 02 persistence.
 */
export async function detectConfigServer(): Promise<StorageMode> {
  if (detectPromise) return detectPromise;

  detectPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG_PING_TIMEOUT_MS);

    try {
      const res = await fetch('/api/config/ping', {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean };
        if (data.ok) {
          storageMode = 'server';
          return storageMode;
        }
      }
    } catch {
      /* Vite-only or server down */
    } finally {
      clearTimeout(timer);
    }

    storageMode = 'localStorage';
    return storageMode;
  })();

  return detectPromise;
}

/** Show or hide the settings banner for Vite-only mode. */
export function refreshConfigStorageBanner(): void {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('configStorageBanner');
  if (!banner) return;
  banner.classList.toggle('hidden', storageMode === 'server');
}
