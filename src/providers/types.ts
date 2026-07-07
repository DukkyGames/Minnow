/**
 * Provider registry types (public API — no secrets on the wire).
 */

import type { ProviderPricing } from '../usage/types';

export type ApiKind = 'lm-studio-v0' | 'openai-v1' | 'anthropic-v1';
export type AuthStyle = 'bearer' | 'api-key' | 'x-api-key';
export type ProviderId = string;

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
