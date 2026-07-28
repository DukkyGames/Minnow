/**
 * Terminal panel preferences in ~/.minnow/config.json (`terminal` block).
 */

import { TERMINAL_PANEL_MIN_HEIGHT_PX } from '../ui/terminal-layout';

export interface TerminalTabMeta {
  id: string;
  shellProfileId: string;
  title?: string;
  /** Absolute cwd when the PTY tab was opened (MIN-349 tab scope labels). */
  boundCwd?: string;
  chatId?: string | null;
  /** Live PTY session id for reconnect after SPA reload (server must still be running). */
  sessionId?: string | null;
  order: number;
}

export interface TerminalMeta {
  open: boolean;
  heightPx: number;
  /** Open the terminal panel when an agent starts a shell command. */
  autoOpenOnAgentRun: boolean;
  /** Switch to the Agent tab when an agent starts a shell command (panel must be open). */
  autoFollowAgentTab: boolean;
  tabs?: TerminalTabMeta[];
  activeTabId?: string | null;
  /** Default shell for new PTY tabs and execute_command (Windows: includes WSL distros). */
  defaultShellProfileId?: string;
  /** Per-workspace shell profile overrides (normalized absolute path → profile id). */
  workspaceShellProfiles?: Record<string, string>;
}

const DEFAULT_TERMINAL_META: TerminalMeta = {
  open: false,
  heightPx: TERMINAL_PANEL_MIN_HEIGHT_PX,
  autoOpenOnAgentRun: false,
  autoFollowAgentTab: false,
  tabs: [],
  activeTabId: null,
  defaultShellProfileId: undefined,
  workspaceShellProfiles: undefined,
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
    boundCwd: typeof row.boundCwd === 'string' ? row.boundCwd : undefined,
    chatId:
      row.chatId === null || typeof row.chatId === 'string'
        ? (row.chatId as string | null)
        : null,
    sessionId:
      row.sessionId === null || typeof row.sessionId === 'string'
        ? (row.sessionId as string | null)
        : undefined,
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
        ? Math.min(800, Math.max(TERMINAL_PANEL_MIN_HEIGHT_PX, Math.round(row.heightPx)))
        : DEFAULT_TERMINAL_META.heightPx,
    autoOpenOnAgentRun: row.autoOpenOnAgentRun === true,
    autoFollowAgentTab: row.autoFollowAgentTab === true,
    tabs,
    activeTabId:
      typeof row.activeTabId === 'string' || row.activeTabId === null
        ? (row.activeTabId as string | null)
        : null,
    defaultShellProfileId:
      typeof row.defaultShellProfileId === 'string'
        ? row.defaultShellProfileId
        : undefined,
    workspaceShellProfiles:
      row.workspaceShellProfiles &&
      typeof row.workspaceShellProfiles === 'object' &&
      !Array.isArray(row.workspaceShellProfiles)
        ? Object.fromEntries(
            Object.entries(row.workspaceShellProfiles as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === 'string' && typeof entry[1] === 'string',
            ),
          )
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

function mergeTerminalMetaPatch(
  current: TerminalMeta,
  patch: Partial<TerminalMeta>,
): TerminalMeta {
  return {
    open: patch.open ?? current.open,
    heightPx: patch.heightPx ?? current.heightPx,
    autoOpenOnAgentRun: patch.autoOpenOnAgentRun ?? current.autoOpenOnAgentRun,
    autoFollowAgentTab: patch.autoFollowAgentTab ?? current.autoFollowAgentTab,
    tabs: patch.tabs ?? current.tabs ?? [],
    activeTabId:
      patch.activeTabId !== undefined ? patch.activeTabId : current.activeTabId,
    defaultShellProfileId:
      patch.defaultShellProfileId ?? current.defaultShellProfileId,
    workspaceShellProfiles:
      patch.workspaceShellProfiles ?? current.workspaceShellProfiles,
  };
}

/** Persist terminal prefs via PUT /api/config/meta. */
export async function saveTerminalMeta(patch: Partial<TerminalMeta>): Promise<void> {
  const current = await loadTerminalMeta();
  const next = mergeTerminalMetaPatch(current, patch);
  cached = next;
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: next }),
  });
}

/**
 * Best-effort terminal persist for pagehide/unload (keepalive fetch).
 * Uses the in-memory cache; call after merging live tab state into the patch.
 */
export function saveTerminalMetaKeepalive(patch: Partial<TerminalMeta>): void {
  const current = getTerminalMetaCached();
  const next = mergeTerminalMetaPatch(current, patch);
  cached = next;
  try {
    void fetch('/api/config/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminal: next }),
      keepalive: true,
    });
  } catch {
    /* unload */
  }
}

export function getTerminalMetaCached(): TerminalMeta {
  return cached ?? { ...DEFAULT_TERMINAL_META, tabs: [] };
}

/** Reset cache (tests). */
export function resetTerminalMetaCache(): void {
  cached = null;
}
