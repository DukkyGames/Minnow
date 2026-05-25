/**
 * Agent pack manifest types (drop-in ~/.minnow/agent-packs/<id>/).
 */

import type { ContextEnforcementPolicy } from '../chat/context-budget';

/** Context fitting hint stored on pack agents; enforcement deferred to feature #3. */
export interface PackContextStrategy {
  maxInputTokens?: number | null;
  policy?: 'inherit' | ContextEnforcementPolicy;
}

/** One agent entry inside manifest.json agents[]. */
export interface PackAgentEntry {
  key: string;
  label: string;
  description?: string;
  prompts: { full: string; lite?: string };
  providerId?: string | null;
  modelId?: string | null;
  allowedTools?: string[] | null;
  defaultForModes?: string[];
  disabled?: boolean;
  contextStrategy?: PackContextStrategy;
}

/** Top-level agent pack manifest (manifest.json). */
export interface AgentPackManifest {
  id: string;
  label: string;
  version: string;
  description?: string;
  minMinnowVersion?: string;
  enabled?: boolean;
  defaults?: {
    providerId?: string | null;
    modelId?: string | null;
    allowedTools?: string[] | null;
  };
  agents: PackAgentEntry[];
}

/** Runtime metadata for a pack-sourced work agent (prompt paths on disk). */
export interface PackAgentSource {
  packId: string;
  agentKey: string;
  packRoot: string;
  promptPaths: { full: string; lite?: string };
  contextStrategy?: PackContextStrategy;
}

/** Scanned pack row returned by GET /api/agent-packs. */
export interface AgentPackListItem {
  id: string;
  label: string;
  version: string;
  description?: string;
  enabled: boolean;
  valid: boolean;
  errors: string[];
  agents: Array<{
    id: string;
    key: string;
    label: string;
    description?: string;
  }>;
  packRoot: string;
}
