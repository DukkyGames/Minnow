/**
 * Workspace context documents: global config + per-chat tri-state injection.
 */

import {
  mergeThinkingTriState,
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../../agents/thinking-types';
import { getWorkspacePath } from '../../state/workspace';
import { sessionState } from '../../state/sessions';
import { resolveChatToolWorkspaceRoot } from '../../state/chat-worktree';
import type { Chat } from '../../types';
import {
  CONTEXT_DOCUMENT_PRESETS,
  defaultEnabledPresetIds,
  getContextDocumentPreset,
} from './catalog';

export const DEFAULT_CONTEXT_DOCUMENTS_MAX_TOTAL_CHARS = 48_000;

export interface ContextDocumentsConfig {
  maxTotalChars: number;
  enabledPresets: string[];
  customPaths: string[];
}

export type ContextDocumentsInjectionTriState = ThinkingTriState;

function normalizeConfigSlice(raw: unknown): ContextDocumentsConfig {
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const maxRaw = obj.maxTotalChars;
  const maxTotalChars =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.floor(maxRaw)
      : DEFAULT_CONTEXT_DOCUMENTS_MAX_TOTAL_CHARS;

  const presetsRaw = obj.enabledPresets;
  const enabledPresets = Array.isArray(presetsRaw)
    ? presetsRaw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : defaultEnabledPresetIds();

  const customRaw = obj.customPaths;
  const customPaths = Array.isArray(customRaw)
    ? customRaw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];

  return {
    maxTotalChars,
    enabledPresets: [...new Set(enabledPresets)],
    customPaths: [...new Set(customPaths.map((p) => p.trim()))],
  };
}

/** Load contextDocuments + features.contextDocumentsInjectionDefault from config.json. */
export async function loadContextDocumentsSettings(): Promise<{
  injectionDefault: boolean;
  documents: ContextDocumentsConfig;
}> {
  try {
    const res = await fetch('/api/config/file?key=config.json', { cache: 'no-store' });
    if (!res.ok) {
      return { injectionDefault: true, documents: normalizeConfigSlice(null) };
    }
    const config = (await res.json()) as {
      features?: { contextDocumentsInjectionDefault?: boolean };
      contextDocuments?: unknown;
    };
    const injectionDefault =
      typeof config.features?.contextDocumentsInjectionDefault === 'boolean'
        ? config.features.contextDocumentsInjectionDefault
        : true;
    return {
      injectionDefault,
      documents: normalizeConfigSlice(config.contextDocuments),
    };
  } catch {
    return { injectionDefault: true, documents: normalizeConfigSlice(null) };
  }
}

export async function fetchContextDocumentsInjectionDefault(): Promise<boolean> {
  const { injectionDefault } = await loadContextDocumentsSettings();
  return injectionDefault;
}

export async function saveContextDocumentsInjectionDefault(enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return false;
    const config = (await res.json()) as {
      features?: Record<string, boolean>;
      contextDocuments?: ContextDocumentsConfig;
    };
    const features =
      config.features && typeof config.features === 'object'
        ? { ...config.features }
        : {};
    features.contextDocumentsInjectionDefault = enabled;
    config.features = features;
    const put = await fetch('/api/config/file?key=config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return put.ok;
  } catch {
    return false;
  }
}

export async function saveContextDocumentsConfig(
  documents: ContextDocumentsConfig,
): Promise<boolean> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return false;
    const config = (await res.json()) as { contextDocuments?: ContextDocumentsConfig };
    config.contextDocuments = {
      maxTotalChars: documents.maxTotalChars,
      enabledPresets: [...documents.enabledPresets],
      customPaths: [...documents.customPaths],
    };
    const put = await fetch('/api/config/file?key=config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return put.ok;
  } catch {
    return false;
  }
}

/** Reject absolute paths and `..` segments (workspace-relative only). */
export function isValidContextDocumentPath(path: string): boolean {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.startsWith('/')) return false;
  if (/^[a-zA-Z]:\//.test(trimmed)) return false;
  const parts = trimmed.split('/').filter(Boolean);
  return !parts.some((p) => p === '..');
}

export function resolveContextDocumentsInjectionTriState(
  chat: Chat,
): ContextDocumentsInjectionTriState {
  return normalizeThinkingTriState(chat.contextDocumentsInjection, 'inherit');
}

export function resolveContextDocumentsInjectionEnabled(
  chat: Chat,
  globalDefault: boolean,
): boolean {
  const base = globalDefault ? 'on' : 'off';
  const tri = resolveContextDocumentsInjectionTriState(chat);
  return mergeThinkingTriState(base, tri) === 'on';
}

/** Union of preset paths and custom paths (de-duped, stable order). */
export function resolveEnabledDocumentPaths(documents: ContextDocumentsConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const pushPath = (path: string) => {
    const norm = path.trim().replace(/\\/g, '/');
    if (!norm || !isValidContextDocumentPath(norm)) return;
    const key = norm.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(norm);
  };

  for (const presetId of documents.enabledPresets) {
    const preset = getContextDocumentPreset(presetId);
    if (!preset) continue;
    for (const p of preset.paths) {
      pushPath(p);
    }
  }

  for (const custom of documents.customPaths) {
    pushPath(custom);
  }

  return out;
}

/** True when at least one preset or custom path is configured. */
export function hasConfiguredContextDocumentPaths(documents: ContextDocumentsConfig): boolean {
  return resolveEnabledDocumentPaths(documents).length > 0;
}

/** Whether compose should fetch workspace context documents for this send. */
export async function shouldInjectContextDocuments(chat: Chat): Promise<boolean> {
  const { injectionDefault, documents } = await loadContextDocumentsSettings();
  if (!resolveContextDocumentsInjectionEnabled(chat, injectionDefault)) {
    return false;
  }
  if (!hasConfiguredContextDocumentPaths(documents)) {
    return false;
  }
  const worktreeCwd = resolveChatToolWorkspaceRoot(chat, sessionState?.groups);
  const cwd = worktreeCwd?.trim() || getWorkspacePath().trim();
  if (!cwd) return false;
  return true;
}

/** Paths from enabled presets only (for validation / dedupe UI). */
export function presetPathsSet(): Set<string> {
  const set = new Set<string>();
  for (const preset of CONTEXT_DOCUMENT_PRESETS) {
    for (const p of preset.paths) {
      set.add(p.trim().replace(/\\/g, '/').toLowerCase());
    }
  }
  return set;
}

export function dedupeCustomPathsAgainstPresets(customPaths: string[]): string[] {
  const presetKeys = presetPathsSet();
  return customPaths.filter((p) => {
    const norm = p.trim().replace(/\\/g, '/').toLowerCase();
    return norm && !presetKeys.has(norm);
  });
}
