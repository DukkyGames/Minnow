/**
 * Design Mode preferences from config.json → `design` block (MIN-365).
 * Keyed per preview instance (`workspace-preview`, `design`, future Studio frames) so each
 * surface remembers its own enabled/tool/viewport/dark-mode state independently.
 * Shape/load/save mirrors src/config/browser-meta.ts.
 */

export type DesignToolId = 'select' | 'draw' | 'comment' | 'inspect';
export type DesignViewportPreset = 'mobile' | 'tablet' | 'desktop';

const DESIGN_TOOL_IDS: readonly DesignToolId[] = ['select', 'draw', 'comment', 'inspect'];
const DESIGN_VIEWPORT_PRESETS: readonly DesignViewportPreset[] = ['mobile', 'tablet', 'desktop'];

export interface DesignInstanceMeta {
  enabled: boolean;
  /** Currently armed tool id, or null when no tool is armed (pointer pass-through). */
  tool: DesignToolId | null;
  viewportPreset: DesignViewportPreset;
  darkModeEmulation: boolean;
}

export interface DesignMeta {
  instances: Record<string, DesignInstanceMeta>;
  /** Before/after diff card history (MIN-370 P1): max pairs kept per chat, oldest evicted first. */
  diffHistoryLimit: number;
}

export const DEFAULT_DESIGN_INSTANCE_META: DesignInstanceMeta = {
  enabled: false,
  tool: null,
  viewportPreset: 'desktop',
  darkModeEmulation: false,
};

export const DEFAULT_DIFF_HISTORY_LIMIT = 5;

export const DEFAULT_DESIGN_META: DesignMeta = { instances: {}, diffHistoryLimit: DEFAULT_DIFF_HISTORY_LIMIT };

function normalizeInstanceMeta(raw: unknown): DesignInstanceMeta {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DESIGN_INSTANCE_META };
  const row = raw as Record<string, unknown>;
  const tool =
    typeof row.tool === 'string' && (DESIGN_TOOL_IDS as string[]).includes(row.tool)
      ? (row.tool as DesignToolId)
      : null;
  const viewportPreset =
    typeof row.viewportPreset === 'string' &&
    (DESIGN_VIEWPORT_PRESETS as string[]).includes(row.viewportPreset)
      ? (row.viewportPreset as DesignViewportPreset)
      : DEFAULT_DESIGN_INSTANCE_META.viewportPreset;
  return {
    enabled: row.enabled === true,
    tool,
    viewportPreset,
    darkModeEmulation: row.darkModeEmulation === true,
  };
}

/** Coerce API payload into a design config block. */
export function normalizeDesignMeta(raw: unknown): DesignMeta {
  if (!raw || typeof raw !== 'object') return { instances: {}, diffHistoryLimit: DEFAULT_DIFF_HISTORY_LIMIT };
  const row = raw as Record<string, unknown>;
  const instancesRaw = row.instances;
  const instances: Record<string, DesignInstanceMeta> = {};
  if (instancesRaw && typeof instancesRaw === 'object') {
    for (const [id, value] of Object.entries(instancesRaw as Record<string, unknown>)) {
      if (typeof id !== 'string' || !id.trim()) continue;
      instances[id] = normalizeInstanceMeta(value);
    }
  }
  const diffHistoryLimit =
    typeof row.diffHistoryLimit === 'number' && Number.isFinite(row.diffHistoryLimit) && row.diffHistoryLimit > 0
      ? Math.floor(row.diffHistoryLimit)
      : DEFAULT_DIFF_HISTORY_LIMIT;
  return { instances, diffHistoryLimit };
}

let cached: DesignMeta | null = null;
let metaLoaded = false;
let loadPromise: Promise<DesignMeta> | null = null;

/** Load design prefs from GET /api/config/meta. */
export async function loadDesignMeta(): Promise<DesignMeta> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<DesignMeta> => {
    try {
      const res = await fetch('/api/config/meta', { cache: 'no-store' });
      if (!res.ok) {
        cached = normalizeDesignMeta(null);
        return cached;
      }
      const meta = (await res.json()) as { design?: unknown };
      cached = normalizeDesignMeta(meta.design);
      return cached;
    } catch {
      cached = normalizeDesignMeta(null);
      return cached;
    } finally {
      metaLoaded = true;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/** Persist the full design block via PUT /api/config/meta. */
export async function saveDesignMeta(patch: Partial<DesignMeta>): Promise<void> {
  const current = await loadDesignMeta();
  const next: DesignMeta = {
    instances: patch.instances ?? { ...current.instances },
    diffHistoryLimit: patch.diffHistoryLimit ?? current.diffHistoryLimit,
  };
  cached = next;
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design: next }),
  });
}

/** Cached value for synchronous reads (call loadDesignMeta during init). */
export function getDesignMetaCached(): DesignMeta {
  return cached ?? normalizeDesignMeta(null);
}

export function isDesignMetaLoaded(): boolean {
  return metaLoaded;
}

export function invalidateDesignMetaCache(): void {
  cached = null;
  metaLoaded = false;
  loadPromise = null;
}

/** Read one instance's meta (cached-first, falls back to defaults). */
export function getDesignInstanceMetaCached(instanceId: string): DesignInstanceMeta {
  const meta = getDesignMetaCached();
  return meta.instances[instanceId] ?? { ...DEFAULT_DESIGN_INSTANCE_META };
}

/** Load one instance's meta, fetching the full block if not yet cached. */
export async function loadDesignInstanceMeta(instanceId: string): Promise<DesignInstanceMeta> {
  const meta = await loadDesignMeta();
  return meta.instances[instanceId] ?? { ...DEFAULT_DESIGN_INSTANCE_META };
}

/** Persist a patch for a single instance, merging with any existing instance state. */
export async function saveDesignInstanceMeta(
  instanceId: string,
  patch: Partial<DesignInstanceMeta>,
): Promise<void> {
  const current = await loadDesignMeta();
  const currentInstance = current.instances[instanceId] ?? { ...DEFAULT_DESIGN_INSTANCE_META };
  const nextInstance: DesignInstanceMeta = { ...currentInstance, ...patch };
  await saveDesignMeta({
    instances: { ...current.instances, [instanceId]: nextInstance },
  });
}

/** Reset cache (tests). */
export function resetDesignMetaCacheForTests(): void {
  invalidateDesignMetaCache();
}
