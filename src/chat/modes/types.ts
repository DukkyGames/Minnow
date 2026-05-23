/**
 * Operating mode types (Build / Plan / Orchestrate / Research / Reef).
 */

/** Stable ids — do not rename without migration. */
export type ModeId =
  | 'build'
  | 'plan'
  | 'orchestrate'
  | 'research'
  | 'reef'
  | 'debug';

export const DEFAULT_MODE_ID: ModeId = 'build';

export const MODE_IDS: readonly ModeId[] = [
  'build',
  'plan',
  'orchestrate',
  'research',
  'reef',
  'debug',
] as const;

/** Type guard for persisted mode ids. */
export function isModeId(value: string): value is ModeId {
  return (MODE_IDS as readonly string[]).includes(value);
}

/** Normalize persisted or unknown values to a valid ModeId. */
export function normalizeModeId(value: string | null | undefined): ModeId {
  // Legacy bug-tracker mode — bugs live on the global #/bugs screen only.
  if (value === 'debug') return DEFAULT_MODE_ID;
  if (value && isModeId(value)) return value;
  return DEFAULT_MODE_ID;
}

export type ToolPolicyAction = 'allow' | 'deny' | 'ask';

/** Wildcard keys match tool function names from definitions.ts (same as tool id). */
export interface ModeToolPolicy {
  /** Default for tools not listed in `tools`. */
  default: ToolPolicyAction;
  /** Per-tool overrides, e.g. execute_command: deny */
  tools?: Record<string, ToolPolicyAction>;
}

export interface ModeDefinition {
  id: ModeId;
  label: string;
  description: string;
  /** Prompt file id (usually same as ModeId). */
  promptId: ModeId;
  toolPolicy: ModeToolPolicy;
}
