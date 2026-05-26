/**
 * Serializes tool approval modals so only one dialog is active at a time.
 */

import { showToolApprovalModal } from '../ui/tool-approval-modal';
import type { ToolApprovalModalResult } from '../ui/tool-approval-modal';
import type { ToolApprovalRequest } from './tool-approval-types';

export type { ToolApprovalRequest } from './tool-approval-types';

export type ToolApprovalDecision = ToolApprovalModalResult;

/** Optional executor metadata (sub-agent label for the modal). */
export interface ToolApprovalContext {
  chatId?: string;
  toolCallId?: string;
  subAgentType?: string;
  workAgentId?: string | null;
  /** Active composer mode (General always prompts before tool execution). */
  modeId?: string;
}

interface Queued {
  request: ToolApprovalRequest;
  resolve: (decision: ToolApprovalDecision) => void;
}

const queue: Queued[] = [];
let draining = false;

/**
 * Queues a modal request. Resolves when the user chooses an action or closes the dialog.
 */
export function enqueueToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
  return new Promise((resolve) => {
    queue.push({ request, resolve });
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  const next = queue.shift();
  if (!next) return;
  draining = true;
  try {
    const decision = await showToolApprovalModal(next.request);
    next.resolve(decision);
  } catch {
    next.resolve('cancel');
  } finally {
    draining = false;
    if (queue.length > 0) {
      void drainQueue();
    }
  }
}
