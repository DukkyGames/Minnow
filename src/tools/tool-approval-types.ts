/**
 * Shared types for the tool approval queue and modal.
 *
 * Kept in a dedicated module so `approval-queue.ts` can import the modal without a circular dependency
 * (the queue calls `showToolApprovalModal`, which needs these request fields).
 */

import type { ToolAgentKey } from './tool-settings-types';

/** Workspace context shown in the approval dialog. */
export type ToolApprovalWorkspace =
  | { label: string; path: string }
  | { hint: string };

/** Payload passed from the permission gate through the queue to the modal. */
export interface ToolApprovalRequest {
  /** Resolved tool id (same as the catalog / API function name). */
  toolName: string;
  title: string;
  description?: string;
  argsJson: string;
  workspace?: ToolApprovalWorkspace;
  /** Shown when paths leave the workspace under workspace FS mode. */
  pathWarning?: string;
  subAgentType?: string;
  workAgentId?: string | null;
  /** Resolved agent key for sticky always-allow scope. */
  agentKey?: ToolAgentKey;
  /** Whether "Always allow" writes global default or per-agent override. */
  alwaysAllowScope?: 'global' | 'agent';
  /** When a pattern would have auto-approved but path guard still prompts. */
  matchedPatternLabel?: string;
}
