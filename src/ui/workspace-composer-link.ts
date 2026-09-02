import { isImageFilePath } from '../attachments/image-path';
import {
  addWorkspaceFileReference,
  addWorkspaceReference,
} from '../attachments/workspace-ref';
import { applyOrchestratePlanFromWorkspacePath } from './orchestrate-plan-selector';

/** Drop / Add to chat entry point (Orchestrate plans update the plan selector). */
export function attachWorkspacePathToComposer(
  workspacePath: string,
  _inputOverride?: HTMLTextAreaElement | null,
): void {
  const path = workspacePath.trim();
  if (!path) return;
  if (applyOrchestratePlanFromWorkspacePath(path)) return;
  if (isImageFilePath(path)) {
    addWorkspaceReference(path);
    return;
  }
  addWorkspaceFileReference(path);
}
