/**
 * Shared reader for `config.json`.
 *
 * Seventeen call sites used to fetch this 25.7 KB file with `cache: 'no-store'`, each parsing
 * the whole thing to read one boolean. A chat switch issued 9–12 of them; because the renderer
 * is served over plain HTTP/1.1, Chromium's six-socket cap turned that into 342 ms of queueing
 * that everything else — tool calls, generation streams, git status — waited behind (MIN-794).
 */

const CONFIG_URL = '/api/config/file?key=config.json';

/** Long enough to collapse one interaction's fan-out, short enough that an external write lands. */
const CONFIG_CACHE_TTL_MS = 1500;

export type ConfigFileJson = Record<string, unknown>;

let cachedAt = 0;
let cachedValue: ConfigFileJson | null = null;
let inflight: Promise<ConfigFileJson | null> | null = null;

/** Drop the cache so the next read goes to the server (call after any write). */
export function invalidateConfigFileCache(): void {
  cachedAt = 0;
  cachedValue = null;
  inflight = null;
}

async function fetchConfigFile(): Promise<ConfigFileJson | null> {
  try {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const parsed = (await res.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as ConfigFileJson;
  } catch {
    return null;
  }
}

/**
 * Read `config.json`, sharing one request across concurrent callers.
 * Pass `fresh` for read-modify-write flows, which must not merge onto a stale copy.
 * Returns null when the file cannot be read or parsed — callers apply their own default.
 */
export async function readConfigFile(
  options?: { fresh?: boolean },
): Promise<ConfigFileJson | null> {
  if (options?.fresh) {
    invalidateConfigFileCache();
  } else if (cachedValue && Date.now() - cachedAt < CONFIG_CACHE_TTL_MS) {
    return cachedValue;
  }
  if (inflight) return inflight;
  const work = fetchConfigFile().then((value) => {
    inflight = null;
    if (value) {
      cachedValue = value;
      cachedAt = Date.now();
    }
    return value;
  });
  inflight = work;
  return work;
}

/** Read one boolean out of `config.json` without every caller re-parsing the file. */
export async function readConfigFlag(
  path: readonly string[],
  fallback: boolean,
): Promise<boolean> {
  const config = await readConfigFile();
  if (!config) return fallback;
  let node: unknown = config;
  for (const key of path) {
    if (!node || typeof node !== 'object') return fallback;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'boolean' ? node : fallback;
}

/** PUT the whole file back and drop the cache so the next read sees the new value. */
export async function writeConfigFile(config: ConfigFileJson): Promise<boolean> {
  try {
    const put = await fetch(CONFIG_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return put.ok;
  } catch {
    return false;
  } finally {
    invalidateConfigFileCache();
  }
}

/** Test helper: forget everything the cache holds. */
export function resetConfigFileCacheForTests(): void {
  invalidateConfigFileCache();
}
