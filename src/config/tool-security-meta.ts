/**
 * Filesystem scope for server-side tools (`config.json` → `toolSecurity`).
 */

export type FilesystemAccessMode = 'workspace' | 'full';

export interface ToolSecurityMeta {
  filesystemAccess: FilesystemAccessMode;
}

const DEFAULT_TOOL_SECURITY: ToolSecurityMeta = {
  filesystemAccess: 'workspace',
};

let cached: ToolSecurityMeta | null = null;

/** True after the first load attempt finished (success or fallback). */
let metaLoaded = false;

/** Deduplicate overlapping loadToolSecurityMeta calls. */
let loadPromise: Promise<ToolSecurityMeta> | null = null;

/** Coerce unknown API payload into a valid toolSecurity block. */
export function normalizeToolSecurityMeta(raw: unknown): ToolSecurityMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TOOL_SECURITY };
  }
  const row = raw as Record<string, unknown>;
  const fa = row.filesystemAccess;
  if (fa === 'full' || fa === 'workspace') {
    return { filesystemAccess: fa };
  }
  return { ...DEFAULT_TOOL_SECURITY };
}

/** Load tool security prefs from config API (defaults when missing). */
export async function loadToolSecurityMeta(): Promise<ToolSecurityMeta> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<ToolSecurityMeta> => {
    try {
      const res = await fetch('/api/config/meta', { cache: 'no-store' });
      if (!res.ok) {
        cached = { ...DEFAULT_TOOL_SECURITY };
        return cached;
      }
      const meta = (await res.json()) as { toolSecurity?: unknown };
      cached = normalizeToolSecurityMeta(meta.toolSecurity);
      return cached;
    } catch {
      cached = { ...DEFAULT_TOOL_SECURITY };
      return cached;
    } finally {
      metaLoaded = true;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/** Persist tool security via PUT /api/config/meta (partial merge). */
export async function saveToolSecurityMeta(patch: Partial<ToolSecurityMeta>): Promise<void> {
  const current = await loadToolSecurityMeta();
  const next: ToolSecurityMeta = {
    filesystemAccess: patch.filesystemAccess ?? current.filesystemAccess,
  };
  cached = next;
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolSecurity: next }),
  });
}

/** Cached value for synchronous gates (call loadToolSecurityMeta during init). */
export function getToolSecurityMetaCached(): ToolSecurityMeta {
  return cached ?? { ...DEFAULT_TOOL_SECURITY };
}

/** Whether tool security has been fetched at least once this session. */
export function isToolSecurityMetaLoaded(): boolean {
  return metaLoaded;
}

/** Reset cache (tests). */
export function resetToolSecurityMetaCache(): void {
  cached = null;
  metaLoaded = false;
  loadPromise = null;
}
