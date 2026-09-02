import { bumpPromptConfigEpoch } from '../outbound-estimate-epochs';
import type { PromptConfig, PromptConfigListItem } from './types';

const memoryStore = new Map<string, PromptConfig>();

function isServerMode(): boolean {
  return typeof fetch !== 'undefined';
}

async function parseApiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error: unknown }).error);
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** GET /api/prompt-configs */
export async function listPromptConfigs(): Promise<PromptConfigListItem[]> {
  try {
    const res = await fetch('/api/prompt-configs', { cache: 'no-store' });
    if (!res.ok) {
      return [...memoryStore.values()].map((c) => ({ id: c.id, label: c.label }));
    }
    const body = (await res.json()) as { configs?: PromptConfigListItem[] };
    return body.configs ?? [];
  } catch {
    return [...memoryStore.values()].map((c) => ({ id: c.id, label: c.label }));
  }
}

/** GET /api/prompt-configs/:id — returns config or Error string. */
export async function loadPromptConfig(
  id: string,
): Promise<PromptConfig | Error> {
  try {
    const res = await fetch(`/api/prompt-configs/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      const fallback = memoryStore.get(id);
      if (fallback) return fallback;
      return new Error(await parseApiError(res));
    }
    return (await res.json()) as PromptConfig;
  } catch (err) {
    const fallback = memoryStore.get(id);
    if (fallback) return fallback;
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Error: ${message}`);
  }
}

/** PUT /api/prompt-configs/:id */
export async function savePromptConfig(config: PromptConfig): Promise<PromptConfig | Error> {
  try {
    const res = await fetch(`/api/prompt-configs/${encodeURIComponent(config.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      return new Error(await parseApiError(res));
    }
    const body = (await res.json()) as { config?: PromptConfig };
    const saved = body.config ?? config;
    memoryStore.set(saved.id, saved);
    bumpPromptConfigEpoch();
    return saved;
  } catch (err) {
    memoryStore.set(config.id, config);
    bumpPromptConfigEpoch();
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Error: ${message}`);
  }
}

/** DELETE /api/prompt-configs/:id */
export async function deletePromptConfig(id: string): Promise<true | Error> {
  try {
    const res = await fetch(`/api/prompt-configs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      return new Error(await parseApiError(res));
    }
    memoryStore.delete(id);
    return true;
  } catch (err) {
    memoryStore.delete(id);
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Error: ${message}`);
  }
}

/** POST /api/prompt-configs/:id/duplicate */
export async function duplicatePromptConfig(
  id: string,
  newId: string,
  newLabel?: string,
): Promise<PromptConfig | Error> {
  try {
    const res = await fetch(
      `/api/prompt-configs/${encodeURIComponent(id)}/duplicate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newId, newLabel }),
      },
    );
    if (!res.ok) {
      return new Error(await parseApiError(res));
    }
    const body = (await res.json()) as { config?: PromptConfig };
    const saved = body.config;
    if (saved) memoryStore.set(saved.id, saved);
    return saved ?? new Error('Duplicate failed');
  } catch (err) {
    const source = memoryStore.get(id);
    if (!source) {
      return new Error('Error: source configuration not found');
    }
    const copy: PromptConfig = {
      ...source,
      id: newId,
      label: newLabel ?? `${source.label} (copy)`,
      profile: 'custom',
    };
    memoryStore.set(newId, copy);
    return copy;
  }
}

/** Validate minimal shape (client-side guard). */
export function validatePromptConfigShape(config: unknown): config is PromptConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as PromptConfig;
  return (
    typeof c.id === 'string' &&
    typeof c.label === 'string' &&
    c.profile === 'custom' &&
    typeof c.parts === 'object'
  );
}

/** Clear in-memory store (tests). */
export function clearPromptConfigMemoryStore(): void {
  memoryStore.clear();
}
