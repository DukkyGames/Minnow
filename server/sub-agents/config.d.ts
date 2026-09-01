/** Shipped default provider before inherit fix — empty when model is also unset. */
export const LEGACY_SUB_AGENT_DEFAULT_PROVIDER: 'lm-studio-local';

export function migrateLegacySubAgentProviderId(
  providerId: string | undefined,
  modelId: string | undefined,
): string;

export function mergeSubAgentFile(
  defaults: Record<string, unknown>,
  user: Record<string, unknown> | null | undefined,
): Record<string, unknown>;

export function resetSubAgentServerConfigCache(): void;

export function loadSubAgentFile(): Promise<Record<string, unknown>>;

export function getSubAgentTypeRow(typeId: string): Promise<Record<string, unknown> | null>;
