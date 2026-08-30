/**
 * Inspector "Loaded with" rows for an mlx-lm serve.
 *
 * mlx-lm has no llamaSettings. Show the snapshot path, quant, pinned mlx-lm
 * version, port, and context from config.json — not spawn tunables.
 */

import type { MlxServeSettings } from './api-client';

export type LoadedWithRow = { label: string; value: string };

/**
 * Rows for the Inference panel. Empty when there is no mlx snapshot at all.
 */
export function mlxLoadedWithRows(
  settings: MlxServeSettings | null | undefined,
  fallback?: { quant?: string | null; contextLength?: number | null },
): LoadedWithRow[] {
  if (!settings && !fallback) return [];
  const quant = settings?.quant || fallback?.quant || null;
  const context = settings?.contextLength ?? fallback?.contextLength ?? null;
  return [
    { label: 'Snapshot', value: settings?.snapshotPath || '—' },
    { label: 'Quant', value: quant || '—' },
    { label: 'mlx-lm', value: settings?.mlxLmVersion || '—' },
    { label: 'Port', value: settings?.port != null ? String(settings.port) : '—' },
    { label: 'Context', value: context != null ? String(context) : '—' },
  ];
}
