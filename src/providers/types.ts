/**
 * Provider registry types (public API — no secrets on the wire).
 */

import type { ProviderPricing } from '../usage/types';

export type ApiKind = 'lm-studio-v0' | 'openai-v1' | 'anthropic-v1';
export type AuthStyle = 'bearer' | 'api-key' | 'x-api-key';
export type ProviderId = string;

/** Stable id for llama.cpp local serve (must match server/providers/store.js). */
export const LLAMA_CPP_LOCAL_PROVIDER_ID = 'llama-cpp-local';

/** Stable id for mlx-lm local serve (must match server/providers/store.js). */
export const MLX_LM_LOCAL_PROVIDER_ID = 'mlx-lm-local';

/** Provider metadata returned by GET /api/providers (secrets redacted). */
export interface ProviderPublic {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKind: ApiKind;
  enabled: boolean;
  authStyle?: AuthStyle;
  modelsPath?: string;
  chatCompletionsPath?: string;
  /** Anthropic Messages path for anthropic-v1 or autoApi gateways. Default `/v1/messages`. */
  messagesPath?: string;
  /** When true on openai-v1 providers, route Claude models to messagesPath automatically. */
  autoApi?: boolean;
  /** Explicit per-model API overrides (highest priority). */
  modelApiOverrides?: Record<string, ApiKind>;
  /** LM Studio v1 load/unload; default true for lm-studio-v0. */
  supportsModelLoadUnload?: boolean;
  modelsLoadPath?: string;
  modelsUnloadPath?: string;
  customHeaders?: Record<string, string>;
  /** Per-provider override for constrained tool calls; undefined uses global default. */
  constrainedToolCalls?: boolean;
  createdAt?: string;
  updatedAt?: string;
  hasApiKey: boolean;
  hasBearer: boolean;
  /** Optional per-model API pricing for usage cost estimates. */
  pricing?: ProviderPricing;
}

export interface ProviderListResponse {
  providers: ProviderPublic[];
  activeProviderId: string;
}

/** Resolved URLs for models (and load/unload) via Minnow server proxy. */
export interface ProviderEndpoints {
  provider: ProviderPublic;
  modelsUrl: string;
  modelsLoadUrl?: string;
  modelsUnloadUrl?: string;
}
