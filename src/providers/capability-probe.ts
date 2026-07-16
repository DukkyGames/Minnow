/**
 * Provider structured-output capabilities (probe results + availability checks).
 */

/** Substrings in model ids that must not use constrained decoding (Harmony / gpt-oss). */
export const HARMONY_DENY_MODEL_SUBSTRINGS = ['gpt-oss', 'harmony'] as const;

export const CAPABILITIES_SCHEMA_VERSION = 1;

export interface ModelCapabilityEntry {
  structuredOutput?: boolean;
  denyReason?: string | null;
}

export interface ProviderCapabilities {
  schemaVersion: number;
  probedAt: string;
  providerId: string;
  structuredOutput: boolean;
  structuredOutputWithTools: boolean;
  structuredOutputStreaming?: boolean;
  /** llama.cpp-local: per-request thinking_budget_tokens supported by pinned runtime. */
  supportsThinkingBudget?: boolean;
  probeError?: string | null;
  models?: Record<string, ModelCapabilityEntry>;
}

let capabilitiesCache = new Map<string, ProviderCapabilities>();

/** Clear in-memory cache (tests). */
export function resetCapabilitiesCache(): void {
  capabilitiesCache = new Map();
}

/** Seed cache entry (tests). */
export function setProviderCapabilitiesForTests(
  providerId: string,
  caps: ProviderCapabilities | null,
): void {
  if (caps === null) {
    capabilitiesCache.delete(providerId);
    return;
  }
  capabilitiesCache.set(providerId, caps);
}

function normalizeCapabilities(raw: unknown, providerId: string): ProviderCapabilities | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    schemaVersion:
      typeof row.schemaVersion === 'number' ? row.schemaVersion : CAPABILITIES_SCHEMA_VERSION,
    probedAt: typeof row.probedAt === 'string' ? row.probedAt : '',
    providerId: typeof row.providerId === 'string' ? row.providerId : providerId,
    structuredOutput: row.structuredOutput === true,
    structuredOutputWithTools: row.structuredOutputWithTools === true,
    structuredOutputStreaming: row.structuredOutputStreaming === true,
    supportsThinkingBudget: row.supportsThinkingBudget === true,
    probeError: typeof row.probeError === 'string' ? row.probeError : null,
    models:
      row.models && typeof row.models === 'object'
        ? (row.models as Record<string, ModelCapabilityEntry>)
        : undefined,
  };
}

/** Read cached or fetch persisted capabilities for a provider. */
export async function readProviderCapabilities(
  providerId: string,
): Promise<ProviderCapabilities | null> {
  const cached = capabilitiesCache.get(providerId);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/capabilities`, {
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const parsed = normalizeCapabilities(json, providerId);
    if (parsed) capabilitiesCache.set(providerId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export interface StructuredOutputProbeOptions {
  /** Canonical model id; must be loaded on the provider. */
  modelId?: string;
  /** Prefer this id when resolving a loaded model server-side. */
  selectedModelId?: string;
}

/** Run server-side probe and refresh cache. */
export async function probeProviderCapabilities(
  providerId: string,
  options: StructuredOutputProbeOptions = {},
): Promise<ProviderCapabilities> {
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}/probe-capabilities`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: options.modelId,
        selectedModelId: options.selectedModelId,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    let message = `Probe failed HTTP ${res.status}`;
    try {
      const errJson = JSON.parse(text) as { error?: string };
      if (errJson.error) message = errJson.error;
    } catch {
      if (text.trim()) message = text.slice(0, 300);
    }
    throw new Error(message);
  }
  const json = (await res.json()) as unknown;
  const parsed = normalizeCapabilities(json, providerId);
  if (!parsed) {
    throw new Error('Invalid capabilities response');
  }
  capabilitiesCache.set(providerId, parsed);
  return parsed;
}

/** Whether model id matches Harmony / gpt-oss denylist. */
export function isHarmonyDeniedModel(modelId: string): boolean {
  const lower = modelId.trim().toLowerCase();
  if (!lower) return false;
  return HARMONY_DENY_MODEL_SUBSTRINGS.some((part) => lower.includes(part));
}

/** Human-readable structured-output badge for settings UI. */
export function structuredOutputBadge(
  caps: ProviderCapabilities | null,
  modelId?: string,
): 'yes' | 'no' | 'unknown' {
  if (modelId && isHarmonyDeniedModel(modelId)) return 'no';
  if (!caps) return 'unknown';

  const modelEntry = modelId ? caps.models?.[modelId] : undefined;
  if (modelEntry?.denyReason) return 'no';
  if (modelEntry?.structuredOutput === true) return 'yes';
  if (modelEntry?.structuredOutput === false) return 'no';

  if (caps.structuredOutputWithTools) return 'yes';
  if (caps.structuredOutput) return 'yes';
  if (caps.probeError) return 'no';
  if (caps.probedAt) return 'no';
  return 'unknown';
}

/**
 * Whether constrained tool calls may be sent for this provider + model.
 */
export function isConstrainedToolCallsAvailable(
  providerId: string,
  modelId: string,
  userEnabled: boolean,
  capabilities: ProviderCapabilities | null,
): boolean {
  if (!userEnabled) return false;
  if (isHarmonyDeniedModel(modelId)) return false;
  if (!capabilities) return false;
  if (!capabilities.structuredOutputWithTools && !capabilities.structuredOutput) {
    return false;
  }
  const modelEntry = capabilities.models?.[modelId];
  if (modelEntry?.denyReason) return false;
  if (modelEntry?.structuredOutput === false) return false;
  return capabilities.structuredOutputWithTools === true || capabilities.structuredOutput === true;
}

/**
 * Whether the provider may receive `response_format` for the sub-agent final JSON outcome
 * (no tools on that turn). Gated by probe + per-model deny; does not require constrained
 * tool-call user setting.
 */
export function isStructuredOutcomeResponseFormatAvailable(
  modelId: string,
  capabilities: ProviderCapabilities | null,
): boolean {
  if (!modelId.trim()) return false;
  if (isHarmonyDeniedModel(modelId)) return false;
  if (!capabilities) return false;

  const modelEntry = capabilities.models?.[modelId];
  if (modelEntry?.denyReason) return false;
  if (modelEntry?.structuredOutput === true) return true;
  if (modelEntry?.structuredOutput === false) return false;

  if (!capabilities.structuredOutput && !capabilities.structuredOutputWithTools) {
    return false;
  }
  return true;
}
