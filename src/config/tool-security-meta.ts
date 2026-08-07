/**
 * Tool security prefs from config.json → toolSecurity (filesystem + shell sandbox).
 */

export type FilesystemAccessMode = 'workspace' | 'full';

/** Agent shell sandbox mode (MIN-553 Phase 3). */
export type ShellSandboxMode = 'off' | 'prefer' | 'require';

export interface ToolSecurityMeta {
  filesystemAccess: FilesystemAccessMode;
  shellSandbox: ShellSandboxMode;
  /** Prefer-mode "Always allow" unsandboxed fallback when the OS sandbox is unavailable. */
  allowUnsandboxedShell: boolean;
}

const DEFAULT_TOOL_SECURITY: ToolSecurityMeta = {
  filesystemAccess: 'workspace',
  shellSandbox: 'off',
  allowUnsandboxedShell: false,
};

let cached: ToolSecurityMeta | null = null;

/** True after the first load attempt finished (success or fallback). */
let metaLoaded = false;

/** Deduplicate overlapping loadToolSecurityMeta calls. */
let loadPromise: Promise<ToolSecurityMeta> | null = null;

function normalizeShellSandbox(value: unknown): ShellSandboxMode {
  if (value === 'off' || value === 'prefer' || value === 'require') return value;
  return 'off';
}

/** Coerce unknown API payload into a valid toolSecurity block. */
export function normalizeToolSecurityMeta(raw: unknown): ToolSecurityMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TOOL_SECURITY };
  }
  const row = raw as Record<string, unknown>;
  const fa = row.filesystemAccess;
  return {
    filesystemAccess: fa === 'full' || fa === 'workspace' ? fa : 'workspace',
    shellSandbox: normalizeShellSandbox(row.shellSandbox),
    allowUnsandboxedShell: row.allowUnsandboxedShell === true,
  };
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
    shellSandbox: patch.shellSandbox ?? current.shellSandbox,
    allowUnsandboxedShell:
      patch.allowUnsandboxedShell !== undefined
        ? patch.allowUnsandboxedShell
        : current.allowUnsandboxedShell,
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
