/**
 * Terminal panel preferences in ~/.speedchat/config.json (`terminal` block).
 */

export interface TerminalMeta {
  open: boolean;
  heightPx: number;
  autoOpenOnAgentRun: boolean;
}

const DEFAULT_TERMINAL_META: TerminalMeta = {
  open: false,
  heightPx: 240,
  autoOpenOnAgentRun: true,
};

let cached: TerminalMeta | null = null;

function normalizeTerminalMeta(raw: unknown): TerminalMeta {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TERMINAL_META };
  const row = raw as Record<string, unknown>;
  return {
    open: row.open === true,
    heightPx:
      typeof row.heightPx === 'number' && Number.isFinite(row.heightPx)
        ? Math.min(800, Math.max(120, Math.round(row.heightPx)))
        : DEFAULT_TERMINAL_META.heightPx,
    autoOpenOnAgentRun: row.autoOpenOnAgentRun !== false,
  };
}

/** Read terminal prefs from config API (falls back to defaults). */
export async function loadTerminalMeta(): Promise<TerminalMeta> {
  if (cached) return cached;
  try {
    const res = await fetch('/api/config/meta', { cache: 'no-store' });
    if (!res.ok) {
      cached = { ...DEFAULT_TERMINAL_META };
      return cached;
    }
    const meta = (await res.json()) as { terminal?: unknown };
    cached = normalizeTerminalMeta(meta.terminal);
    return cached;
  } catch {
    cached = { ...DEFAULT_TERMINAL_META };
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
  };
  cached = next;
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: next }),
  });
}

export function getTerminalMetaCached(): TerminalMeta {
  return cached ?? { ...DEFAULT_TERMINAL_META };
}

/** Reset cache (tests). */
export function resetTerminalMetaCache(): void {
  cached = null;
}
