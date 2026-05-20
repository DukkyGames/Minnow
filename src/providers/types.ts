/**
 * Provider registry types (public API — no secrets on the wire).
 */

export type ApiKind = 'lm-studio-v0' | 'openai-v1';
export type ConnectionMode = 'direct' | 'proxy';
export type AuthStyle = 'bearer' | 'api-key' | 'x-api-key';
export type ProviderId = string;

/** Provider metadata returned by GET /api/providers (secrets redacted). */
export interface ProviderPublic {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKind: ApiKind;
  enabled: boolean;
  connectionMode: ConnectionMode;
  authStyle?: AuthStyle;
  modelsPath?: string;
  chatCompletionsPath?: string;
  customHeaders?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  hasApiKey: boolean;
  hasBearer: boolean;
}

export interface ProviderListResponse {
  providers: ProviderPublic[];
  activeProviderId: string;
}

/** Resolved URLs for models + chat for one provider. */
export interface ProviderEndpoints {
  provider: ProviderPublic;
  mode: ConnectionMode;
  modelsUrl: string;
  chatUrl: string;
}
