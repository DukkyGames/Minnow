/**
 * Provider structured-output capabilities (probe results + availability checks).
 */
/** Substrings in model ids that must not use constrained decoding (Harmony / gpt-oss). */
export declare const HARMONY_DENY_MODEL_SUBSTRINGS: readonly ["gpt-oss", "harmony"];
export declare const CAPABILITIES_SCHEMA_VERSION = 1;
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
/** Clear in-memory cache (tests). */
export declare function resetCapabilitiesCache(): void;
/** Seed cache entry (tests). */
export declare function setProviderCapabilitiesForTests(providerId: string, caps: ProviderCapabilities | null): void;
/** Read cached or fetch persisted capabilities for a provider. */
export declare function readProviderCapabilities(providerId: string): Promise<ProviderCapabilities | null>;
export interface StructuredOutputProbeOptions {
    /** Canonical model id; must be loaded on the provider. */
    modelId?: string;
    /** Prefer this id when resolving a loaded model server-side. */
    selectedModelId?: string;
}
/** Run server-side probe and refresh cache. */
export declare function probeProviderCapabilities(providerId: string, options?: StructuredOutputProbeOptions): Promise<ProviderCapabilities>;
/** Whether model id matches Harmony / gpt-oss denylist. */
export declare function isHarmonyDeniedModel(modelId: string): boolean;
/** Human-readable structured-output badge for settings UI. */
export declare function structuredOutputBadge(caps: ProviderCapabilities | null, modelId?: string): 'yes' | 'no' | 'unknown';
/**
 * Whether constrained tool calls may be sent for this provider + model.
 */
export declare function isConstrainedToolCallsAvailable(providerId: string, modelId: string, userEnabled: boolean, capabilities: ProviderCapabilities | null): boolean;
/**
 * Whether the provider may receive `response_format` for the sub-agent final JSON outcome
 * (no tools on that turn). Gated by probe + per-model deny; does not require constrained
 * tool-call user setting.
 */
export declare function isStructuredOutcomeResponseFormatAvailable(modelId: string, capabilities: ProviderCapabilities | null): boolean;
