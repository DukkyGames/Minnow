/**
 * Work Agent registry types (Step 08).
 */

/** Shipped or user-defined Work Agent definition. */
export interface WorkAgentDefinition {
  id: string;
  label: string;
  description: string;
  /** Prompt kind for S04 loader; files under work-agents/<id>/ */
  kind: 'work-agent';
  version: string;
  /** S03 provider id; null = session/global default provider */
  providerId: string | null;
  /** Model id on that provider; null = chat.modelId */
  modelId: string | null;
  /** Optional tool allowlist; null = use global enabled tools */
  allowedTools: string[] | null;
  /** Mode ids that default-select this agent when workAgentAuto is on */
  defaultForModes?: string[];
  /** If true, listed in UI but not auto-selected */
  disabled?: boolean;
}

/** User overrides stored under ~/.speedchat/work-agents.json */
export interface WorkAgentUserOverride {
  providerId?: string | null;
  modelId?: string | null;
  /** Full prompt body override (replaces file content for active profile) */
  promptOverride?: string | null;
  disabled?: boolean;
}

export interface WorkAgentRegistrySnapshot {
  agents: WorkAgentDefinition[];
  /** Merged at load time */
  overrides: Record<string, WorkAgentUserOverride>;
}

/** Resolved provider + model for one send turn. */
export interface WorkAgentBinding {
  agentId: string;
  providerId: string;
  modelId: string;
  baseUrl: string;
  headers: Record<string, string>;
}

/** Thrown when provider/model binding cannot be resolved. */
export class WorkAgentConfigError extends Error {
  readonly code = 'WORK_AGENT_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'WorkAgentConfigError';
  }
}
