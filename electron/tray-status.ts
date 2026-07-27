/**
 * Tray status snapshot types shared across main, preload, and renderer.
 */

export interface TrayStatusSnapshot {
  agentCount: number;
  localModelCount: number;
  localModelNames: string[];
}

export type TrayRendererCommand =
  | { type: 'new_chat' }
  | { type: 'open_settings' }
  | { type: 'unload_local_models' };

export const EMPTY_TRAY_STATUS: TrayStatusSnapshot = {
  agentCount: 0,
  localModelCount: 0,
  localModelNames: [],
};

/** Build disabled menu labels for agent/model rows. */
export function formatTrayAgentLabel(count: number): string {
  return `Agents running: ${Math.max(0, count)}`;
}

export function formatTrayModelsLabel(count: number, names: string[]): string {
  const base = `Local models loaded: ${Math.max(0, count)}`;
  if (!names.length) return base;
  const preview = names.slice(0, 3).join(', ');
  const suffix = names.length > 3 ? `, +${names.length - 3} more` : '';
  return `${base} — ${preview}${suffix}`;
}
