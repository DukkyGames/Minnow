/**
 * Terminal panel preferences in ~/.minnow/config.json (`terminal` block).
 */

export interface TerminalTabMeta {
  id: string;
  shellProfileId: string;
  title?: string;
  chatId?: string | null;
  order: number;
}

export interface TerminalMeta {
  open: boolean;
  heightPx: number;
  autoOpenOnAgentRun: boolean;
  tabs?: TerminalTabMeta[];
  activeTabId?: string | null;
  defaultShellProfileId?: string;
}

const DEFAULT_TERMINAL_META: TerminalMeta = {
  open: false,
  heightPx: 240,
  autoOpenOnAgentRun: false,
  tabs: [],
  activeTabId: null,
  defaultShellProfileId: undefined,
};

let cached: TerminalMeta | null = null;

function normalizeTab(raw: unknown, index: number): TerminalTabMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const shellProfileId =
    typeof row.shellProfileId === 'string' ? row.shellProfileId : '';
  if (!id || !shellProfileId) return null;
  return {
    id,
    shellProfileId,
    title: typeof row.title === 'string' ? row.title : undefined,
    chatId:
      row.chatId === null || typeof row.chatId === 'string'
        ? (row.chatId as string | null)
        : null,
    order: typeof row.order === 'number' ? row.order : index,
  };
}

function normalizeTerminalMeta(raw: unknown): TerminalMeta {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TERMINAL_META, tabs: [] };
  const row = raw as Record<string, unknown>;
  const tabsRaw = Array.isArray(row.tabs) ? row.tabs : [];
  const tabs = tabsRaw
    .map((t, i) => normalizeTab(t, i))
    .filter((t): t is TerminalTabMeta => t != null)
    .sort((a, b) => a.order - b.order);

  return {
    open: row.open === true,
    heightPx:
      typeof row.heightPx === 'number' && Number.isFinite(row.heightPx)
        ? Math.min(800, Math.max(120, Math.round(row.heightPx)))
        : DEFAULT_TERMINAL_META.heightPx,
    autoOpenOnAgentRun: row.autoOpenOnAgentRun === true,
    tabs,
    activeTabId:
      typeof row.activeTabId === 'string' || row.activeTabId === null
        ? (row.activeTabId as string | null)
        : null,
    defaultShellProfileId:
      typeof row.defaultShellProfileId === 'string'
        ? row.defaultShellProfileId
        : undefined,
  };
}

/** Read terminal prefs from config API (falls back to defaults). */
export async function loadTerminalMeta(): Promise<TerminalMeta> {
  if (cached) return cached;
  try {
    const res = await fetch('/api/config/meta', { cache: 'no-store' });
    if (!res.ok) {
      cached = { ...DEFAULT_TERMINAL_META, tabs: [] };
      return cached;
    }
    const meta = (await res.json()) as { terminal?: unknown };
    cached = normalizeTerminalMeta(meta.terminal);
    return cached;
  } catch {
    cached = { ...DEFAULT_TERMINAL_META, tabs: [] };
    return cached;
  }
}

/** Persist terminal prefs via PUT /api/config/meta. */
export async function saveTerminalMeta(patch: Partial<TerminalMeta>): Promise<void> {
  const current = await loadTerminalMeta();
  const next: TerminalMeta = {
    open: patch.open ?? current.open,
    heightPx: patch.heightPx ?? current.heightPx,
    autoOpenOnAgentRun: patch.autoOpenOnAgentRun ?? current.autoOpenOnAgentRun,
    tabs: patch.tabs ?? current.tabs ?? [],
    activeTabId:
      patch.activeTabId !== undefined ? patch.activeTabId : current.activeTabId,
    defaultShellProfileId:
      patch.defaultShellProfileId ?? current.defaultShellProfileId,
  };
  cached = next;
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: next }),
  });
}

export function getTerminalMetaCached(): TerminalMeta {
  return cached ?? { ...DEFAULT_TERMINAL_META, tabs: [] };
}

/** Reset cache (tests). */
export function resetTerminalMetaCache(): void {
  cached = null;
}
