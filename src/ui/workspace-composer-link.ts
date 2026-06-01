/**
 * File-tree → composer: project path in message text, or image attachment chip.
 */

import { isImageFilePath } from '../attachments/image-path';
import {
  addWorkspaceReference,
  insertWorkspacePathInComposer,
} from '../attachments/workspace-ref';
import { applyOrchestratePlanFromWorkspacePath } from './orchestrate-plan-selector';

/** Drop / Add to chat entry point (Orchestrate plans update the plan selector). */
export function attachWorkspacePathToComposer(workspacePath: string): void {
  const path = workspacePath.trim();
  if (!path) return;
  if (applyOrchestratePlanFromWorkspacePath(path)) return;
  if (isImageFilePath(path)) {
    addWorkspaceReference(path);
    return;
  }
  insertWorkspacePathInComposer(path);
}
